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
	maxToProcess: number = 10
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

	// Walk SS pages until we find `maxToProcess` un-imported variants OR
	// exhaust the catalog. Cursor isn't persisted between calls — we
	// rebuild the "already imported" set from D1 each call. Wasteful for
	// huge catalogs but trivially correct.
	let cursor: string | undefined;
	let exhausted = false;

	while (result.processedThisCall < maxToProcess && !exhausted) {
		const page = await listProducts(apiKey, { cursor });

		for (const product of page.products) {
			if (result.processedThisCall >= maxToProcess) break;
			for (const variant of product.variants) {
				if (result.processedThisCall >= maxToProcess) break;

				// Skip if we already imported this variant. Cheap lookup
				// since we indexed (product_id, variant_id).
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
					} else {
						const photoCount = await createNew(
							db,
							r2,
							product,
							variant,
							defaultCat.id,
							result.errors
						);
						result.itemsCreated++;
						result.photosUploaded += photoCount;
					}
					result.processedThisCall++;
				} catch (err) {
					result.errors.push({
						context: `${product.id} / ${variant.id} (${product.name})`,
						error: err instanceof Error ? err.message : String(err)
					});
					// Don't count failures toward maxToProcess — they're not
					// real work, and a permanent failure shouldn't slow
					// progress on the rest.
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

	// "hasMore" = either we hit maxToProcess this call (probably more
	// unprocessed variants exist on later pages), or we exhausted the
	// catalog without filling the batch (definitely done). Be explicit:
	result.hasMore = result.processedThisCall === maxToProcess && !exhausted;

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
	const res = await fetch(url);
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
