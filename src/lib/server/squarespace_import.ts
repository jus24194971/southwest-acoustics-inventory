/**
 * Squarespace → inventory importer.
 *
 * Design:
 *   - Idempotent. Re-runs detect existing items via (squarespace_product_id,
 *     squarespace_variant_id) and update mutable fields rather than
 *     creating duplicates.
 *   - Batched. Each call processes up to `maxToProcess` UN-imported
 *     variants and returns hasMore + counts so the client can poll-loop
 *     to completion without blowing the 30s Pages Functions wall-time.
 *   - Tolerant. A single bad product (or photo) is recorded as an error
 *     and the import moves on. The error list is returned with the result.
 *
 * What gets created per Squarespace variant:
 *   - One inventory `item` row with a VIN-style SKU. Category defaults
 *     to MS (Misc / Consumables); Dad re-categorises later from the
 *     item detail page.
 *   - Photos: each SS image is downloaded from the SS CDN, written to
 *     R2 at `items/<item_id>/<source_id>.<ext>`, and recorded in
 *     `item_photo` with the original SS URL preserved.
 *   - An initial `movement` row of kind 'receive' with actor
 *     'squarespace-import' so the audit ledger reflects the bootstrap.
 *
 * What gets updated on re-import:
 *   - title, description (plain + HTML), price_cents, squarespace_synced_at.
 *   - NOT touched: SKU, condition, category, bin, photos. Once an item
 *     is in inventory, Squarespace stops being authoritative for those.
 */

import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { listProducts, type SquarespaceProduct, type SquarespaceVariant } from './squarespace';
import { generateSku, normaliseModelCode } from './sku';

/** Items in this category are the fallback bucket — Dad recategorises
 *  after import via the (still-to-be-built) item detail page. */
const DEFAULT_CATEGORY_CODE = 'MS';

/**
 * Cloudflare Workers / Pages Functions free tier allows ~50 outbound
 * fetch() subrequests per invocation. Budget conservatively so the
 * Squarespace list paginations + our photo downloads stay under it.
 * R2 puts and D1 calls go through bindings — they are NOT subrequests.
 */
const PHOTO_SUBREQUEST_BUDGET = 40;

/**
 * Squarespace returns image URLs with the literal segment "/null/" for
 * products where an image was orphaned on their end. These will always
 * 404 — detect and skip without spending a subrequest on them.
 */
function isUsablePhotoUrl(url: string | undefined): url is string {
	if (!url) return false;
	if (url.includes('/null/')) return false;
	return true;
}

export interface ImportError {
	context: string;
	error: string;
}

export interface BatchResult {
	processedThisCall: number;
	itemsCreated: number;
	itemsUpdated: number;
	photosUploaded: number;
	totalImportedSoFar: number;
	hasMore: boolean;
	errors: ImportError[];
}

/**
 * Process up to `maxToProcess` variants of products that haven't been
 * imported yet. Returns a snapshot of progress; caller re-invokes until
 * `hasMore` is false.
 */
export async function importBatch(
	db: D1Database,
	r2: R2Bucket,
	apiKey: string,
	maxToCreate: number = 5
): Promise<BatchResult> {
	const result: BatchResult = {
		processedThisCall: 0,
		itemsCreated: 0,
		itemsUpdated: 0,
		photosUploaded: 0,
		totalImportedSoFar: 0,
		hasMore: false,
		errors: []
	};

	const defaultCat = await db
		.prepare(`SELECT id FROM category WHERE code = ?`)
		.bind(DEFAULT_CATEGORY_CODE)
		.first<{ id: number }>();
	if (!defaultCat) {
		throw new Error(
			`Default category '${DEFAULT_CATEGORY_CODE}' missing — migration 0001 should have seeded it.`
		);
	}

	// Walk SS pages until we find `maxToCreate` un-imported variants OR
	// exhaust the catalog. Cursor isn't persisted between calls — we
	// rebuild the "already imported" set from D1 each call. Wasteful for
	// huge catalogs but trivially correct.
	//
	// IMPORTANT: only *creates* count toward `maxToCreate`. Updates do
	// no photo fetches, cost nothing in subrequest budget, and would
	// otherwise stall the loop on re-runs (filling the batch with the
	// same N already-imported variants over and over).
	let cursor: string | undefined;
	let exhausted = false;
	let photoFetchesUsed = 0;

	while (result.itemsCreated < maxToCreate && !exhausted) {
		const page = await listProducts(apiKey, { cursor });

		for (const product of page.products) {
			if (result.itemsCreated >= maxToCreate) break;
			for (const variant of product.variants) {
				if (result.itemsCreated >= maxToCreate) break;

				// Cheap lookup — indexed on (product_id, variant_id).
				const existing = await db
					.prepare(
						`SELECT id FROM item WHERE squarespace_product_id = ? AND squarespace_variant_id = ?`
					)
					.bind(product.id, variant.id)
					.first<{ id: number }>();

				try {
					if (existing) {
						await updateExisting(db, existing.id, product, variant);
						result.itemsUpdated++;
						// Do NOT increment itemsCreated — keep looking for
						// real work. Don't increment processedThisCall —
						// it's only used for the UI's "did anything happen
						// this call" check.
					} else {
						// Pre-flight subrequest budget check. Each usable
						// photo URL is one fetch. If creating this item
						// would push us past the budget, stop here — the
						// next invocation gets a fresh 50-fetch allowance.
						const usablePhotos = (product.images ?? []).filter((img) =>
							isUsablePhotoUrl(img.url)
						).length;
						if (photoFetchesUsed + usablePhotos > PHOTO_SUBREQUEST_BUDGET) {
							exhausted = true;
							break;
						}

						const fetched = await createNew(
							db,
							r2,
							product,
							variant,
							defaultCat.id,
							result.errors
						);
						photoFetchesUsed += fetched;
						result.itemsCreated++;
						result.photosUploaded += fetched;
						result.processedThisCall++;
					}
				} catch (err) {
					result.errors.push({
						context: `${product.id} / ${variant.id} (${product.name})`,
						error: err instanceof Error ? err.message : String(err)
					});
				}
			}
		}

		if (page.pagination.hasNextPage && page.pagination.nextPageCursor) {
			cursor = page.pagination.nextPageCursor;
		} else {
			exhausted = true;
		}
	}

	// Total imported count from D1 (authoritative).
	const totalRow = await db
		.prepare(`SELECT COUNT(*) AS n FROM item WHERE squarespace_product_id IS NOT NULL`)
		.first<{ n: number }>();
	result.totalImportedSoFar = totalRow?.n ?? 0;

	// "hasMore" = we hit the create budget or the subrequest budget this
	// call, meaning there are still un-imported variants out there.
	// If we walked the entire catalog (`exhausted`) without filling the
	// create budget, we're truly done.
	result.hasMore = !exhausted;

	return result;
}

async function updateExisting(
	db: D1Database,
	itemId: number,
	product: SquarespaceProduct,
	variant: SquarespaceVariant
): Promise<void> {
	const nowIso = new Date().toISOString();
	const priceCents = parsePriceCents(variant);
	const descriptionText = stripHtml(product.description ?? '');

	await db
		.prepare(
			`UPDATE item
			 SET title = ?, description = ?, description_html = ?, price_cents = ?,
			     squarespace_synced_at = ?, updated_at = ?
			 WHERE id = ?`
		)
		.bind(product.name, descriptionText, product.description ?? '', priceCents, nowIso, nowIso, itemId)
		.run();
}

async function createNew(
	db: D1Database,
	r2: R2Bucket,
	product: SquarespaceProduct,
	variant: SquarespaceVariant,
	defaultCategoryId: number,
	errors: ImportError[]
): Promise<number> {
	const nowIso = new Date().toISOString();
	const currentYear = new Date().getFullYear();
	const priceCents = parsePriceCents(variant);
	const descriptionText = stripHtml(product.description ?? '');

	// SKU model code from the product name. normaliseModelCode pads with
	// X if too short so we never have an empty segment.
	const modelCode = normaliseModelCode(product.name);
	const sku = await generateSku(db, {
		categoryCode: DEFAULT_CATEGORY_CODE,
		brandCode: 'XXX',
		modelCode,
		condition: 'N',
		yearReceived: currentYear
	});

	const insert = await db
		.prepare(
			`INSERT INTO item (
				sku, title, description, description_html,
				category_id, condition, year_received, price_cents,
				squarespace_product_id, squarespace_variant_id, squarespace_sku,
				squarespace_synced_at, created_at, updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			RETURNING id`
		)
		.bind(
			sku,
			product.name,
			descriptionText,
			product.description ?? '',
			defaultCategoryId,
			'N',
			currentYear,
			priceCents,
			product.id,
			variant.id,
			variant.sku ?? null,
			nowIso,
			nowIso,
			nowIso
		)
		.first<{ id: number }>();

	if (!insert) throw new Error('item INSERT returned no row');
	const itemId = insert.id;

	// Initial receive movement so the ledger shows the bootstrap.
	await db
		.prepare(
			`INSERT INTO movement (item_id, kind, note, actor, reference)
			 VALUES (?, 'receive', ?, 'squarespace-import', ?)`
		)
		.bind(itemId, `Imported from Squarespace: ${product.name}`, product.id)
		.run();

	// Photos — best-effort per photo, errors logged but don't fail
	// the whole product import.
	let photoCount = 0;
	for (let i = 0; i < (product.images ?? []).length; i++) {
		const img = product.images[i];
		// Skip Squarespace's known-broken /null/ URLs without spending a
		// subrequest on them. The budget check in importBatch already
		// excludes these from its accounting, so we must skip the same
		// set here for the count to add up.
		if (!isUsablePhotoUrl(img.url)) continue;
		try {
			await importPhoto(db, r2, itemId, img.url, img.id, i, img.altText);
			photoCount++;
		} catch (err) {
			errors.push({
				context: `photo ${img.id} on item ${itemId}`,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	return photoCount;
}

async function importPhoto(
	db: D1Database,
	r2: R2Bucket,
	itemId: number,
	url: string,
	sourceId: string,
	position: number,
	altText: string | undefined
): Promise<void> {
	// Squarespace's static1.squarespace.com host (used for older image
	// references) hot-link-blocks based on User-Agent. Bot-shaped UAs
	// (like our default 'sw-acoustics-inventory/0.0.1') get a 403 even
	// though they'd be fine via the API. Browser-shaped headers pass.
	// The newer images.squarespace-cdn.com host doesn't care, so this
	// is harmless for it too.
	const res = await fetch(url, {
		headers: {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
				'(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
			Referer: 'https://www.squarespace.com/'
		}
	});
	if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);

	const buf = await res.arrayBuffer();
	const contentType = res.headers.get('content-type') ?? 'image/jpeg';
	const ext = extFromContentType(contentType);
	const r2Key = `items/${itemId}/${sourceId}.${ext}`;

	await r2.put(r2Key, buf, {
		httpMetadata: { contentType }
	});

	await db
		.prepare(
			`INSERT INTO item_photo
				(item_id, r2_key, source_url, position, alt_text, bytes, content_type)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(itemId, r2Key, url, position, altText ?? null, buf.byteLength, contentType)
		.run();
}

// ---------- small helpers ----------

function parsePriceCents(variant: SquarespaceVariant): number {
	const raw = variant.pricing?.basePrice?.value;
	if (!raw) return 0;
	const parsed = parseFloat(raw);
	return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

function extFromContentType(ct: string): string {
	const lower = ct.toLowerCase();
	if (lower.includes('png')) return 'png';
	if (lower.includes('webp')) return 'webp';
	if (lower.includes('gif')) return 'gif';
	return 'jpg';
}

// =========================================================================
// Photo backfill
// =========================================================================
//
// During the initial import, photos can be lost three ways:
//   1. The /null/ skip (legitimate — there's nothing to download)
//   2. A subrequest-budget bail mid-product
//   3. A transient SS 4xx (like the static1 hot-link block before we
//      switched to browser-shaped headers)
//
// (1) is permanent and we ignore it. (2) and (3) leave items with fewer
// item_photo rows than the SS product has images. This pass reconciles
// them: walk SS, find items short on photos, fetch the missing URLs,
// insert the matching item_photo rows. Same subrequest budget rules as
// the main importer — call repeatedly until hasMore is false.

export interface BackfillResult {
	itemsScanned: number;
	photosAdded: number;
	hasMore: boolean;
	errors: ImportError[];
}

export async function backfillMissingPhotos(
	db: D1Database,
	r2: R2Bucket,
	apiKey: string,
	maxPhotosToFetch: number = PHOTO_SUBREQUEST_BUDGET
): Promise<BackfillResult> {
	const result: BackfillResult = {
		itemsScanned: 0,
		photosAdded: 0,
		hasMore: false,
		errors: []
	};

	let cursor: string | undefined;
	let exhausted = false;

	while (result.photosAdded < maxPhotosToFetch && !exhausted) {
		const page = await listProducts(apiKey, { cursor });

		for (const product of page.products) {
			if (result.photosAdded >= maxPhotosToFetch) break;

			for (const variant of product.variants) {
				if (result.photosAdded >= maxPhotosToFetch) break;

				const item = await db
					.prepare(
						`SELECT id FROM item WHERE squarespace_product_id = ? AND squarespace_variant_id = ?`
					)
					.bind(product.id, variant.id)
					.first<{ id: number }>();

				// If the item doesn't exist yet, this is the importer's
				// job not ours — silently skip.
				if (!item) continue;
				result.itemsScanned++;

				// Identify which SS image URLs we don't yet have for this item.
				const have = await db
					.prepare(`SELECT source_url FROM item_photo WHERE item_id = ?`)
					.bind(item.id)
					.all<{ source_url: string | null }>();
				const haveUrls = new Set(
					have.results.map((r) => r.source_url).filter((u): u is string => !!u)
				);

				const ssImages = product.images ?? [];
				const missing = ssImages.filter(
					(img) => isUsablePhotoUrl(img.url) && !haveUrls.has(img.url)
				);
				if (missing.length === 0) continue;

				// Pre-flight: would this item push us over budget? Bail so
				// the next call can do it from a fresh budget.
				if (result.photosAdded + missing.length > maxPhotosToFetch) {
					exhausted = true;
					break;
				}

				for (const img of missing) {
					// Use the SS image's index in its native array as the
					// item_photo.position, so display order matches Squarespace.
					const position = ssImages.indexOf(img);
					try {
						await importPhoto(db, r2, item.id, img.url, img.id, position, img.altText);
						result.photosAdded++;
					} catch (err) {
						result.errors.push({
							context: `photo ${img.id} on item ${item.id}`,
							error: err instanceof Error ? err.message : String(err)
						});
					}
				}
			}
			if (exhausted) break;
		}

		if (!exhausted && page.pagination.hasNextPage && page.pagination.nextPageCursor) {
			cursor = page.pagination.nextPageCursor;
		} else if (!exhausted) {
			// Walked the whole catalog — nothing left to reconcile.
			exhausted = true;
		}
	}

	// hasMore = we stopped because of budget, not because we ran out of
	// products. If `exhausted` is true and we didn't trigger it via the
	// budget pre-check, we're truly done.
	result.hasMore = result.photosAdded >= maxPhotosToFetch;

	return result;
}
