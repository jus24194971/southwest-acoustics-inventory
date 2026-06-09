/**
 * Squarespace listing health check / repair.
 *
 * Walks every tracked SS listing and verifies the link still resolves to
 * a live product:
 *   - live      → refresh the stored URL + clear any stale error
 *   - orphaned  → the product is gone on SS (404); clear the link so the
 *                 next push re-adopts (by SKU) or recreates it
 *   - error     → record what SS said, leave the link alone
 *
 * Runs in batches ordered by least-recently-checked, so a periodic
 * heartbeat naturally rotates through the whole catalog without blowing
 * the Worker's per-request subrequest budget.
 */

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import Anthropic from '@anthropic-ai/sdk';
import { listProducts } from './squarespace';
import { defaultSlug } from './listings';
import { detectModelFamily } from './reconcile';

export type ListingHealth = 'live' | 'orphaned' | 'error';

export interface HealthRow {
	itemId: number;
	sku: string;
	title: string;
	externalId: string;
	status: ListingHealth;
	message?: string;
	url?: string | null;
}

export interface HealthSummary {
	checked: number;
	live: number;
	orphaned: number;
	errors: number;
	results: HealthRow[];
}

export interface RelinkSummary {
	productsScanned: number;
	itemsConsidered: number;
	alreadyLinked: number;
	relinked: number;
	aiMatched: number;
	unmatched: number;
}

const lastSeg = (s: string | null | undefined) =>
	(s ?? '').split('/').filter(Boolean).pop()?.toLowerCase() ?? '';

const normTitle = (s: string | null | undefined) =>
	(s ?? '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[.,!?:;]+$/, '');

interface CatalogProduct {
	id: string;
	name: string;
	url: string | null;
	slug: string;
	variantId: string | null;
}

/**
 * Bulk relink by TITLE (then slug, then SKU). Scans the whole Squarespace
 * catalog once and re-points EVERY active item to its current live
 * product. This fixes the common go-live mess: items backfilled with a
 * STALE squarespace_product_id (Dad relisted under new SKUs), so their
 * link points at a deleted product. Squarespace titles don't change, so
 * an exact title match is the reliable anchor; an AI pass handles
 * near-matches, with a hard model-family guard (Tele ≠ Strat). All writes
 * are batched, so it stays cheap on subrequests.
 */
export async function bulkRelinkSquarespace(
	db: D1Database,
	apiKey: string,
	anthropicKey: string | undefined,
	maxPages = 50
): Promise<RelinkSummary> {
	// 1. Whole catalog → lookup maps + product list. First-seen wins.
	const products: CatalogProduct[] = [];
	const byTitle = new Map<string, CatalogProduct>();
	const bySlug = new Map<string, CatalogProduct>();
	const bySku = new Map<string, CatalogProduct>();
	let cursor: string | undefined;
	let productsScanned = 0;
	for (let page = 0; page < maxPages; page++) {
		const resp = await listProducts(apiKey, cursor ? { cursor } : {});
		for (const p of resp.products ?? []) {
			productsScanned++;
			const entry: CatalogProduct = {
				id: p.id,
				name: p.name,
				url: p.url ?? null,
				slug: lastSeg(p.urlSlug),
				variantId: p.variants?.[0]?.id ?? null
			};
			products.push(entry);
			const t = normTitle(p.name);
			if (t && !byTitle.has(t)) byTitle.set(t, entry);
			if (entry.slug && !bySlug.has(entry.slug)) bySlug.set(entry.slug, entry);
			for (const v of p.variants ?? []) {
				const sku = (v.sku ?? '').trim().toLowerCase();
				if (sku && !bySku.has(sku)) bySku.set(sku, entry);
			}
		}
		if (!resp.pagination?.hasNextPage || !resp.pagination.nextPageCursor) break;
		cursor = resp.pagination.nextPageCursor;
	}

	// 2. EVERY active item + its CURRENT SS link (LEFT JOIN so items with
	//    no SS row are included — we create one when the title matches).
	const { results: items } = await db
		.prepare(
			`SELECT i.id AS itemId, i.title, i.sku, ml.listing_title,
			        ml.external_id AS currentExternalId
			 FROM item i
			 LEFT JOIN marketplace_listing ml ON ml.item_id = i.id AND ml.platform = 'squarespace'
			 WHERE i.deleted_at IS NULL AND i.retired_at IS NULL`
		)
		.all<{
			itemId: number;
			title: string;
			sku: string;
			listing_title: string | null;
			currentExternalId: string | null;
		}>();

	type Upd = { itemId: number; title: string; product: CatalogProduct };
	const updates: Upd[] = [];
	const claimed = new Set<string>();
	const leftover: typeof items = [];
	let alreadyLinked = 0;

	// 3. Exact match: title → slug → sku.
	for (const it of items) {
		const t = normTitle(it.listing_title || it.title);
		const match =
			(t ? byTitle.get(t) : undefined) ??
			bySlug.get(lastSeg(defaultSlug(it.listing_title || it.title))) ??
			(it.sku ? bySku.get(it.sku.trim().toLowerCase()) : undefined) ??
			null;
		if (match) {
			claimed.add(match.id);
			if (match.id === it.currentExternalId) alreadyLinked++;
			else updates.push({ itemId: it.itemId, title: it.listing_title || it.title, product: match });
		} else {
			leftover.push(it);
		}
	}

	// 4. AI pass for the leftovers (titles that didn't match exactly).
	let aiMatched = 0;
	const freeProducts = products.filter((p) => !claimed.has(p.id));
	if (anthropicKey && leftover.length > 0 && freeProducts.length > 0) {
		const pairs = await aiPairByTitle(anthropicKey, leftover, freeProducts);
		for (const { itemId, productIndex } of pairs) {
			const product = freeProducts[productIndex];
			const it = leftover.find((x) => x.itemId === itemId);
			if (!product || !it || claimed.has(product.id)) continue;
			// Hard guard: never pair across distinct guitar/bass models.
			const fi = detectModelFamily(it.listing_title || it.title);
			const fp = detectModelFamily(product.name);
			if (fi && fp && fi !== fp) continue;
			claimed.add(product.id);
			if (product.id !== it.currentExternalId) {
				updates.push({ itemId, title: it.listing_title || it.title, product });
				aiMatched++;
			}
		}
	}

	// 5. Upsert all relinks (create the SS row if missing). Batched.
	for (let i = 0; i < updates.length; i += 25) {
		const chunk = updates.slice(i, i + 25);
		await db.batch(
			chunk.map((u) =>
				db
					.prepare(
						`INSERT INTO marketplace_listing
						   (item_id, platform, listing_title, status, external_id,
						    external_variant_id, external_url, listing_url_slug,
						    last_synced_at, last_sync_status)
						 VALUES (?, 'squarespace', ?, 'live', ?, ?, ?, ?, datetime('now'), 'ok')
						 ON CONFLICT (item_id, platform) DO UPDATE SET
						   external_id = excluded.external_id,
						   external_variant_id = excluded.external_variant_id,
						   external_url = excluded.external_url,
						   listing_url_slug = COALESCE(excluded.listing_url_slug, marketplace_listing.listing_url_slug),
						   status = 'live', last_synced_at = datetime('now'),
						   last_sync_status = 'ok', last_sync_error = NULL,
						   updated_at = datetime('now')`
					)
					.bind(u.itemId, u.title, u.product.id, u.product.variantId, u.product.url, u.product.slug || null)
			)
		);
	}

	return {
		productsScanned,
		itemsConsidered: items.length,
		alreadyLinked,
		relinked: updates.length,
		aiMatched,
		unmatched: leftover.length - aiMatched
	};
}

/** Ask Claude to pair leftover items → leftover products by title. Short
 *  I/P indices keep the prompt tight + ids intact. Best-effort: [] on any
 *  failure. The caller still applies the model-family guard. */
async function aiPairByTitle(
	anthropicKey: string,
	items: Array<{ itemId: number; title: string; listing_title: string | null }>,
	products: CatalogProduct[]
): Promise<Array<{ itemId: number; productIndex: number }>> {
	const itemList = items.slice(0, 200);
	const prodList = products.slice(0, 200);
	const itemsText = itemList.map((it) => `I${it.itemId}: ${it.listing_title || it.title}`).join('\n');
	const prodsText = prodList.map((p, i) => `P${i}: ${p.name}`).join('\n');
	const system = `You match inventory ITEMS to live Squarespace PRODUCTS by title. The shop's Squarespace titles have NOT changed, so a match means the two titles refer to the same physical product (near-identical wording; minor differences are fine). Only pair when you're confident. NEVER pair two different guitar/bass models — a Telecaster is not a Stratocaster, a Les Paul is not an SG, a Precision Bass is not a Jazz Bass. Return ONLY JSON: { "pairs": [ { "item": <the I number>, "product": <the P number> } ] }. Omit anything uncertain. No prose, no code fences.`;
	try {
		const anthropic = new Anthropic({ apiKey: anthropicKey });
		const msg = await anthropic.messages.create({
			model: 'claude-haiku-4-5',
			max_tokens: 4000,
			system,
			messages: [
				{ role: 'user', content: `ITEMS:\n${itemsText}\n\nPRODUCTS:\n${prodsText}\n\nReturn the JSON.` }
			]
		});
		const raw = msg.content
			.filter((b): b is Anthropic.TextBlock => b.type === 'text')
			.map((b) => b.text)
			.join('')
			.trim();
		const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
		const fb = cleaned.indexOf('{');
		const lb = cleaned.lastIndexOf('}');
		const parsed = JSON.parse(fb >= 0 && lb > fb ? cleaned.slice(fb, lb + 1) : cleaned) as {
			pairs?: Array<{ item: number; product: number }>;
		};
		const out: Array<{ itemId: number; productIndex: number }> = [];
		for (const p of parsed.pairs ?? []) {
			if (
				typeof p.item === 'number' &&
				typeof p.product === 'number' &&
				p.product >= 0 &&
				p.product < prodList.length
			) {
				out.push({ itemId: p.item, productIndex: p.product });
			}
		}
		return out;
	} catch {
		return [];
	}
}

type CheckRow = { itemId: number; externalId: string; sku: string; title: string };

/**
 * Verify every linked Squarespace listing in ONE pass, cheaply.
 *
 * The naive approach — one `getProduct` per listing — costs one subrequest
 * each, so ~120 links blow past the Worker's 50-subrequest cap. Instead we
 * pull the WHOLE catalog with a handful of paginated `listProducts` calls,
 * build an id→product map, and match every link locally. Total cost is
 * ~(catalog pages) + (a few batched writes): well under the cap regardless
 * of how many listings we have.
 *
 * A link whose product id is in the catalog is LIVE (URL refreshed). One
 * that's missing is ORPHANED (cleared so the next push re-adopts/recreates)
 * — but ONLY when the scan reached the true end of the catalog. If the scan
 * was truncated (catalog bigger than `maxPages`), we can't prove a product
 * is gone, so we leave those links untouched rather than risk wiping a good
 * link.
 */
export async function validateSquarespaceListings(
	db: D1Database,
	apiKey: string,
	maxPages = 30
): Promise<HealthSummary> {
	// 1. Scan the whole catalog into an id→product map (cheap, paginated).
	const byId = new Map<string, CatalogProduct>();
	let cursor: string | undefined;
	let scanComplete = false;
	for (let page = 0; page < maxPages; page++) {
		const resp = await listProducts(apiKey, cursor ? { cursor } : {});
		for (const p of resp.products ?? []) {
			byId.set(p.id, {
				id: p.id,
				name: p.name,
				url: p.url ?? null,
				slug: lastSeg(p.urlSlug),
				variantId: p.variants?.[0]?.id ?? null
			});
		}
		if (!resp.pagination?.hasNextPage || !resp.pagination.nextPageCursor) {
			scanComplete = true;
			break;
		}
		cursor = resp.pagination.nextPageCursor;
	}

	// 2. Every linked SS listing on an active item.
	const { results: rows } = await db
		.prepare(
			`SELECT ml.item_id AS itemId, ml.external_id AS externalId, i.sku, i.title
			 FROM marketplace_listing ml
			 JOIN item i ON i.id = ml.item_id
			 WHERE ml.platform = 'squarespace'
			   AND ml.external_id IS NOT NULL
			   AND i.deleted_at IS NULL`
		)
		.all<CheckRow>();

	const out: HealthRow[] = [];
	let live = 0;
	let orphaned = 0;
	let errors = 0;
	const writes: D1PreparedStatement[] = [];

	for (const r of rows) {
		const prod = byId.get(r.externalId);
		if (prod) {
			// Live — present in the catalog. Refresh the stored open-link URL
			// and clear any stale error.
			writes.push(
				db
					.prepare(
						`UPDATE marketplace_listing
						 SET status = 'live', external_url = COALESCE(?, external_url),
						     last_synced_at = datetime('now'), last_sync_status = 'ok',
						     last_sync_error = NULL, updated_at = datetime('now')
						 WHERE item_id = ? AND platform = 'squarespace'`
					)
					.bind(prod.url ?? null, r.itemId)
			);
			live++;
			out.push({ itemId: r.itemId, sku: r.sku, title: r.title, externalId: r.externalId, status: 'live', url: prod.url ?? null });
		} else if (scanComplete) {
			// Gone — the FULL catalog doesn't contain it. Clear the link so the
			// next push re-adopts (by SKU) or recreates it.
			writes.push(
				db
					.prepare(
						`UPDATE marketplace_listing
						 SET external_id = NULL, external_variant_id = NULL, external_url = NULL,
						     status = 'paused', last_synced_at = datetime('now'),
						     last_sync_status = 'error',
						     last_sync_error = 'Squarespace product no longer exists — link cleared; re-push to relist.',
						     updated_at = datetime('now')
						 WHERE item_id = ? AND platform = 'squarespace'`
					)
					.bind(r.itemId)
			);
			orphaned++;
			out.push({ itemId: r.itemId, sku: r.sku, title: r.title, externalId: r.externalId, status: 'orphaned' });
		} else {
			// Scan was truncated — we can't prove this is gone, so DON'T clear
			// it. Flag as unconfirmed; running again with a complete scan resolves it.
			const msg = 'Could not confirm — Squarespace catalog scan was incomplete. Try again.';
			writes.push(
				db
					.prepare(
						`UPDATE marketplace_listing
						 SET last_synced_at = datetime('now'), last_sync_status = 'error',
						     last_sync_error = ?, updated_at = datetime('now')
						 WHERE item_id = ? AND platform = 'squarespace'`
					)
					.bind(msg, r.itemId)
			);
			errors++;
			out.push({ itemId: r.itemId, sku: r.sku, title: r.title, externalId: r.externalId, status: 'error', message: msg });
		}
	}

	// Flush writes in batches — each db.batch() is one transaction and counts
	// as a single subrequest regardless of how many statements it holds.
	for (let i = 0; i < writes.length; i += 50) {
		await db.batch(writes.slice(i, i + 50));
	}

	return { checked: rows.length, live, orphaned, errors, results: out };
}

export interface DescPullSummary {
	productsScanned: number;
	ssLinkedItems: number;
	filled: number; // had no description → filled from Squarespace
	alreadyHad: number; // already had a description → left untouched
	noSource: number; // SS-linked but the product (or its description) wasn't found
}

/**
 * Backfill item descriptions from Squarespace — a BASELINE so items that
 * aren't on eBay/Reverb yet still have copy to start from when listed there.
 *
 * "Fill blanks only": we set `item.description_html` from the live Squarespace
 * product ONLY where the item currently has none — existing descriptions are
 * never touched. One cheap catalog scan (a few paginated calls) feeds every
 * SS-linked item, and writes are batched, so it's well within the Worker
 * subrequest budget regardless of catalog size.
 */
export async function bulkPullSquarespaceDescriptions(
	db: D1Database,
	apiKey: string,
	maxPages = 30
): Promise<DescPullSummary> {
	// 1. Scan the whole catalog → id→description map (cheap).
	const byId = new Map<string, string>();
	let cursor: string | undefined;
	for (let page = 0; page < maxPages; page++) {
		const resp = await listProducts(apiKey, cursor ? { cursor } : {});
		for (const p of resp.products ?? []) {
			if (typeof p.description === 'string') byId.set(p.id, p.description);
		}
		if (!resp.pagination?.hasNextPage || !resp.pagination.nextPageCursor) break;
		cursor = resp.pagination.nextPageCursor;
	}

	// 2. Every SS-linked active item + its current description.
	const { results: items } = await db
		.prepare(
			`SELECT i.id AS itemId, i.description_html AS descHtml, ml.external_id AS ssId
			 FROM item i
			 JOIN marketplace_listing ml ON ml.item_id = i.id AND ml.platform = 'squarespace'
			 WHERE i.deleted_at IS NULL AND ml.external_id IS NOT NULL`
		)
		.all<{ itemId: number; descHtml: string | null; ssId: string }>();

	let filled = 0;
	let alreadyHad = 0;
	let noSource = 0;
	const writes: D1PreparedStatement[] = [];

	for (const it of items) {
		if ((it.descHtml ?? '').trim()) {
			alreadyHad++; // fill blanks ONLY — never overwrite
			continue;
		}
		const desc = byId.get(it.ssId);
		if (!desc || !desc.trim()) {
			noSource++; // product gone, or its SS description is empty too
			continue;
		}
		// Plain-text fallback for the item's `description` column, only if it's
		// also blank (mirrors how the original import populated both columns).
		const plain = desc
			.replace(/<[^>]*>/g, ' ')
			.replace(/&nbsp;/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		writes.push(
			db
				.prepare(
					`UPDATE item
					 SET description_html = ?,
					     description = COALESCE(NULLIF(TRIM(description), ''), ?),
					     updated_at = datetime('now')
					 WHERE id = ?`
				)
				.bind(desc, plain, it.itemId)
		);
		filled++;
	}

	for (let i = 0; i < writes.length; i += 50) {
		await db.batch(writes.slice(i, i + 50));
	}

	return { productsScanned: byId.size, ssLinkedItems: items.length, filled, alreadyHad, noSource };
}
