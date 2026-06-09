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
import {
	listProducts,
	listInventory,
	getProduct,
	type SquarespaceProduct,
	type SquarespaceVariant
} from './squarespace';
import { generateSku, normaliseModelCode } from './sku';
import { getListingPhotoUrls } from './reverb';
import { getItemImageUrls, type EbayEnvCreds } from './ebay';

/**
 * Resolve the stock_qty we should record for a given Squarespace
 * variant. Rules:
 *   - If SS reports a finite quantity, use it (including 0).
 *   - If SS marks the variant as unlimited or omits stock entirely,
 *     default to 1 — Dad's catalog is physical, so "unlimited" is
 *     almost always a misconfigured SS variant we shouldn't echo.
 */
function stockQtyFromVariant(variant: SquarespaceVariant): number {
	const stock = variant.stock;
	if (!stock || stock.unlimited) return 1;
	return Math.max(0, Math.floor(stock.quantity));
}

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
	const ssQty = stockQtyFromVariant(variant);

	// Read the current qty so we can log a movement only if it changed —
	// avoids spamming the ledger with no-op "synced from SS" entries.
	const current = await db
		.prepare(`SELECT stock_qty FROM item WHERE id = ?`)
		.bind(itemId)
		.first<{ stock_qty: number }>();

	await db
		.prepare(
			`UPDATE item
			 SET title = ?, description = ?, description_html = ?, price_cents = ?,
			     stock_qty = ?,
			     squarespace_synced_at = ?, updated_at = ?
			 WHERE id = ?`
		)
		.bind(
			product.name,
			descriptionText,
			product.description ?? '',
			priceCents,
			ssQty,
			nowIso,
			nowIso,
			itemId
		)
		.run();

	if (current && current.stock_qty !== ssQty) {
		const delta = ssQty - current.stock_qty;
		const dir = delta > 0 ? 'up' : 'down';
		await db
			.prepare(
				`INSERT INTO movement (item_id, kind, quantity, note, actor, reference)
				 VALUES (?, 'adjust', ?, ?, 'squarespace-import', ?)`
			)
			.bind(
				itemId,
				Math.abs(delta),
				`Stock synced from Squarespace: ${current.stock_qty} → ${ssQty} (${dir} ${Math.abs(delta)})`,
				product.id
			)
			.run();
	}
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

	const ssQty = stockQtyFromVariant(variant);

	const insert = await db
		.prepare(
			`INSERT INTO item (
				sku, title, description, description_html,
				category_id, condition, year_received, price_cents,
				stock_qty,
				squarespace_product_id, squarespace_variant_id, squarespace_sku,
				squarespace_synced_at, created_at, updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
			ssQty,
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
	//
	// Accept header is INTENTIONALLY narrowed to JPEG/PNG/GIF (no
	// WebP, no AVIF). SS's image CDN does content negotiation — if
	// we advertise WebP, it serves WebP, and we end up storing a
	// format SS's own upload endpoint won't accept on the way back
	// out. By asking for the classic three formats here we keep R2
	// stocked with formats that round-trip cleanly. (The SS push
	// path also runs Photon transcoding as a safety net for any
	// pre-existing WebPs in R2 — but starving the inflow is the
	// cheaper long-term fix.)
	const res = await fetch(url, {
		headers: {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
				'(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			Accept: 'image/jpeg,image/png,image/gif',
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

/**
 * Pull an item's photos from its linked Squarespace product into R2 +
 * item_photo. The reconcile wizard ONBOARD only links the listing — it
 * doesn't copy images — so a freshly-onboarded item shows no photos locally
 * even though the live product has them. This fetches the product's images
 * and stores any we don't already have.
 *
 * Idempotent (skips images already stored, matched by source URL); no-ops
 * when the item has no Squarespace link or the product is gone. Best-effort
 * and bounded by `max` so it stays inside the Worker subrequest budget
 * (~2 subrequests per photo) — re-run, or use the catalog backfill, to
 * finish a product with more images than `max`. Returns photos added.
 */
export interface PhotoPullResult {
	added: number; // photos newly stored in R2 + item_photo
	found: number; // images the Squarespace product reported
	firstError: string | null; // first per-image download failure, for diagnostics
}

export async function importItemPhotosFromSquarespace(
	db: D1Database,
	r2: R2Bucket,
	apiKey: string,
	itemId: number,
	max = 10
): Promise<PhotoPullResult> {
	const link = await db
		.prepare(
			`SELECT external_id FROM marketplace_listing
			 WHERE item_id = ? AND platform = 'squarespace' AND external_id IS NOT NULL`
		)
		.bind(itemId)
		.first<{ external_id: string }>();
	if (!link?.external_id) return { added: 0, found: 0, firstError: null };

	// Let a Squarespace fetch error PROPAGATE. The auto-sync callers wrap this
	// in try/catch (best-effort), while the per-item "Pull photos" button
	// surfaces the real error so we're never guessing why nothing came down.
	const product = await getProduct(apiKey, link.external_id);
	const images = product.images ?? [];
	if (images.length === 0) return { added: 0, found: 0, firstError: null };

	// Skip images we've already stored (idempotent across re-runs).
	const { results: existing } = await db
		.prepare(`SELECT source_url FROM item_photo WHERE item_id = ?`)
		.bind(itemId)
		.all<{ source_url: string | null }>();
	const have = new Set(existing.map((r) => r.source_url).filter(Boolean) as string[]);

	// Append after any photos already on the item.
	const posRow = await db
		.prepare(`SELECT COALESCE(MAX(position), -1) AS p FROM item_photo WHERE item_id = ?`)
		.bind(itemId)
		.first<{ p: number }>();
	let position = (posRow?.p ?? -1) + 1;

	let added = 0;
	let firstError: string | null = null;
	for (const img of images) {
		if (added >= max) break;
		if (!isUsablePhotoUrl(img.url) || have.has(img.url)) continue;
		try {
			await importPhoto(db, r2, itemId, img.url, img.id, position, img.altText);
			position++;
			added++;
		} catch (e) {
			if (!firstError) {
				firstError = `${(img.url ?? '').slice(0, 90)} → ${e instanceof Error ? e.message : String(e)}`;
			}
		}
	}
	return { added, found: images.length, firstError };
}

export interface PhotoSourceCreds {
	ssKey?: string;
	reverbKey?: string;
	ebayCreds?: EbayEnvCreds;
}

export interface AnySourcePullResult {
	added: number;
	found: number;
	source: string | null; // which platform the photos came from
	firstError: string | null;
	attempts: string[]; // per-source outcome, for diagnostics
}

/**
 * Pull an item's photos from whichever marketplace it's actually linked to —
 * tries Squarespace → Reverb → eBay (richest first), then falls back to the
 * primary images captured during the reconcile scrape. This is the
 * "Pull photos from source" path: items that live ONLY on Reverb/eBay (moved
 * into stock during reconciliation) still get template images.
 *
 * Stops at the first source that successfully imports a photo; if a source
 * errors or comes back empty it moves on to the next. Idempotent (skips
 * images already stored by URL), bounded by `max`, and never throws.
 */
export async function importItemPhotosFromAnySource(
	db: D1Database,
	r2: R2Bucket,
	creds: PhotoSourceCreds,
	itemId: number,
	max = 12
): Promise<AnySourcePullResult> {
	const { results: links } = await db
		.prepare(
			`SELECT platform, external_id, external_variant_id
			 FROM marketplace_listing WHERE item_id = ?`
		)
		.bind(itemId)
		.all<{ platform: string; external_id: string | null; external_variant_id: string | null }>();
	const ssId = links.find((l) => l.platform === 'squarespace')?.external_id ?? null;
	const reverbId = links.find((l) => l.platform === 'reverb')?.external_id ?? null;
	const ebayRow = links.find((l) => l.platform === 'ebay');
	const ebayId = ebayRow?.external_variant_id ?? ebayRow?.external_id ?? null;

	// Ordered candidate sources — each lazily fetches its public image URLs.
	const sources: { name: string; get: () => Promise<string[]> }[] = [];
	if (creds.ssKey && ssId) {
		const ssKey = creds.ssKey;
		sources.push({
			name: 'Squarespace',
			get: async () => {
				const p = await getProduct(ssKey, ssId);
				return (p.images ?? []).map((im) => im.url).filter((u): u is string => !!u);
			}
		});
	}
	if (creds.reverbKey && reverbId) {
		const reverbKey = creds.reverbKey;
		sources.push({ name: 'Reverb', get: () => getListingPhotoUrls(reverbKey, reverbId) });
	}
	if (creds.ebayCreds && ebayId) {
		const ebayCreds = creds.ebayCreds;
		sources.push({ name: 'eBay', get: () => getItemImageUrls(ebayCreds, ebayId) });
	}
	// Last resort: primary images captured during the reconcile scrape.
	sources.push({
		name: 'scrape',
		get: async () => {
			const { results } = await db
				.prepare(
					`SELECT rl.image_url FROM reconcile_listing rl
					 JOIN reconcile_group rg ON rg.id = rl.group_id
					 WHERE rg.item_id = ? AND rl.image_url IS NOT NULL`
				)
				.bind(itemId)
				.all<{ image_url: string }>();
			return results.map((r) => r.image_url).filter((u): u is string => !!u);
		}
	});

	const { results: existing } = await db
		.prepare(`SELECT source_url FROM item_photo WHERE item_id = ?`)
		.bind(itemId)
		.all<{ source_url: string | null }>();
	const have = new Set(existing.map((r) => r.source_url).filter(Boolean) as string[]);

	const posRow = await db
		.prepare(`SELECT COALESCE(MAX(position), -1) AS p FROM item_photo WHERE item_id = ?`)
		.bind(itemId)
		.first<{ p: number }>();
	let position = (posRow?.p ?? -1) + 1;

	let firstError: string | null = null;
	const attempts: string[] = [];
	for (const src of sources) {
		let urls: string[];
		try {
			urls = await src.get();
		} catch (e) {
			const m = e instanceof Error ? e.message : String(e);
			attempts.push(`${src.name}: error (${m.slice(0, 40)})`);
			if (!firstError) firstError = `${src.name}: ${m}`;
			continue;
		}
		const fresh = urls.filter((u) => isUsablePhotoUrl(u) && !have.has(u));
		if (fresh.length === 0) {
			attempts.push(`${src.name}: ${urls.length} found, 0 new`);
			continue;
		}
		let added = 0;
		for (const u of fresh) {
			if (added >= max) break;
			try {
				await importPhoto(db, r2, itemId, u, `${src.name.toLowerCase()}-${position}`, position, undefined);
				position++;
				added++;
			} catch (e) {
				if (!firstError) {
					firstError = `${src.name} image: ${e instanceof Error ? e.message : String(e)}`;
				}
			}
		}
		attempts.push(`${src.name}: +${added} of ${urls.length}`);
		if (added > 0) return { added, found: urls.length, source: src.name, firstError, attempts };
	}
	return { added: 0, found: 0, source: null, firstError, attempts };
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

// =========================================================================
// Stock sync (Squarespace → us)
// =========================================================================
//
// Uses the dedicated Inventory API (much lighter than re-running the full
// import) to pull current per-variant stock and write it back to our DB.
// Pages through everything in one call — the inventory endpoint returns
// tight JSON (variantId + qty + flags only, no descriptions or photos),
// so a few hundred entries easily fit under the Workers subrequest budget.
//
// For each entry:
//   - If the SS variant matches a known item (squarespace_variant_id),
//     update stock_qty and write a 'adjust' movement so the audit trail
//     shows the sync.
//   - Variants marked "unlimited" are skipped (left at whatever we have)
//     because Dad's catalog is physical; unlimited is almost always a
//     misconfigured SS variant we shouldn't echo as zero.
//   - Variants we don't recognize are tallied as `unknown` — typically
//     means the product hasn't been imported yet.
//
// Idempotent: re-running when nothing changed writes no movements.

export interface StockSyncResult {
	pagesFetched: number;
	entriesScanned: number;
	itemsUpdated: number;
	noChange: number;
	skippedUnlimited: number;
	unknownVariants: number;
	errors: ImportError[];
}

export async function syncStockFromSquarespace(
	db: D1Database,
	apiKey: string
): Promise<StockSyncResult> {
	const result: StockSyncResult = {
		pagesFetched: 0,
		entriesScanned: 0,
		itemsUpdated: 0,
		noChange: 0,
		skippedUnlimited: 0,
		unknownVariants: 0,
		errors: []
	};

	let cursor: string | undefined;
	// Hard cap on pages walked per invocation. Each page is ~50 entries
	// so 20 pages = 1000 variants — well beyond Dad's catalog size and
	// safely under the Workers 50-subrequest budget. The inventory
	// endpoint is one subrequest per page; each DB op is a binding call
	// (not a subrequest), so the math works out.
	const MAX_PAGES = 20;

	while (result.pagesFetched < MAX_PAGES) {
		let page;
		try {
			page = await listInventory(apiKey, { cursor });
		} catch (err) {
			result.errors.push({
				context: `inventory page ${result.pagesFetched + 1}`,
				error: err instanceof Error ? err.message : String(err)
			});
			break;
		}
		result.pagesFetched++;

		for (const entry of page.inventory) {
			result.entriesScanned++;

			if (entry.isUnlimited) {
				result.skippedUnlimited++;
				continue;
			}

			const item = await db
				.prepare(
					`SELECT id, stock_qty FROM item
					 WHERE squarespace_variant_id = ? AND deleted_at IS NULL`
				)
				.bind(entry.variantId)
				.first<{ id: number; stock_qty: number }>();

			if (!item) {
				result.unknownVariants++;
				continue;
			}

			const newQty = Math.max(0, Math.floor(entry.quantity));
			if (item.stock_qty === newQty) {
				result.noChange++;
				continue;
			}

			try {
				const delta = newQty - item.stock_qty;
				const dir = delta > 0 ? 'up' : 'down';
				const nowIso = new Date().toISOString();

				await db.batch([
					db
						.prepare(
							`UPDATE item SET stock_qty = ?, squarespace_synced_at = ?, updated_at = ?
							 WHERE id = ?`
						)
						.bind(newQty, nowIso, nowIso, item.id),

					db
						.prepare(
							`INSERT INTO movement (item_id, kind, quantity, note, actor, reference)
							 VALUES (?, 'adjust', ?, ?, 'squarespace-stock-sync', ?)`
						)
						.bind(
							item.id,
							Math.abs(delta),
							`Stock synced from Squarespace: ${item.stock_qty} → ${newQty} (${dir} ${Math.abs(delta)})`,
							entry.variantId
						)
				]);

				result.itemsUpdated++;
			} catch (err) {
				result.errors.push({
					context: `sku ${entry.sku} (variant ${entry.variantId})`,
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}

		if (page.pagination.hasNextPage && page.pagination.nextPageCursor) {
			cursor = page.pagination.nextPageCursor;
		} else {
			break;
		}
	}

	return result;
}
