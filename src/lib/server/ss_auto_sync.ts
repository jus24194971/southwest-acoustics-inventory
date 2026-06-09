/**
 * Squarespace auto-sync for "sellable" items.
 *
 * When an item is flagged `sellable`, the app treats Squarespace as a
 * live mirror of our on-hand truth and pushes changes automatically so
 * Dad never has to remember to open the listing editor:
 *
 *   - quantity changed  → update the SS listing's stock (0 → "Sold Out")
 *   - item retired      → delete the SS listing entirely
 *
 * Everything here is BEST-EFFORT and gated three ways: the item must be
 * sellable, it must already have a Squarespace product (we never
 * silently CREATE — that needs a storefront, photos, etc., which is a
 * deliberate editor action), and the API key must be present. If any
 * gate fails we return a `skipped` outcome; if the API call fails we
 * record the error on the listing and return an `error` outcome — but we
 * NEVER throw, because the local change (the qty adjustment, the retire)
 * has already committed and must not be rolled back by a flaky network.
 *
 * Only Squarespace is wired here for now. eBay / Reverb auto-sync can
 * reuse this same shape later.
 */

import type { D1Database } from '@cloudflare/workers-types';
import {
	getProduct,
	updateProductFull,
	deleteProduct,
	SquarespaceError,
	type SquarespaceProductWritePayload
} from './squarespace';
import { loadListing, recordSyncResult } from './listings';

export type SsAutoSyncChange =
	| { type: 'stock'; quantity: number }
	| { type: 'content' }
	| { type: 'delete' };

type SsSyncAction = 'stock' | 'content' | 'delete';

export type SsAutoSyncOutcome =
	| { status: 'skipped'; reason: string }
	| { status: 'ok'; action: SsSyncAction; productId: string }
	| { status: 'error'; action: SsSyncAction; message: string };

function errMessage(err: unknown): string {
	if (err instanceof SquarespaceError) {
		return `Squarespace HTTP ${err.httpStatus}: ${err.body.slice(0, 200)}`;
	}
	return err instanceof Error ? err.message : String(err);
}

/**
 * Sync one item's state to its Squarespace listing, if it's sellable.
 * Returns a small outcome the caller can surface to the UI; never throws.
 */
export async function autoSyncSquarespaceForItem(
	db: D1Database,
	apiKey: string | undefined,
	itemId: number,
	change: SsAutoSyncChange
): Promise<SsAutoSyncOutcome> {
	const item = await db
		.prepare(
			`SELECT id, sku, title, description_html, price_cents, stock_qty, sellable
			 FROM item WHERE id = ?`
		)
		.bind(itemId)
		.first<{
			id: number;
			sku: string;
			title: string;
			description_html: string | null;
			price_cents: number | null;
			stock_qty: number;
			sellable: number;
		}>();
	if (!item) return { status: 'skipped', reason: 'item not found' };
	if (!item.sellable) return { status: 'skipped', reason: 'item is not marked sellable' };

	const listing = await loadListing(db, itemId, 'squarespace');
	if (!listing?.external_id) {
		return { status: 'skipped', reason: 'no Squarespace listing to sync' };
	}
	if (!apiKey) {
		return { status: 'error', action: change.type, message: 'SQUARESPACE_API_KEY not configured.' };
	}
	const productId = listing.external_id;

	// ---- Delete (item retired) -------------------------------------
	if (change.type === 'delete') {
		try {
			await deleteProduct(apiKey, productId);
			// Unlink locally — the product no longer exists on SS. We keep
			// the row (for history) but blank the external link + pause it.
			await db
				.prepare(
					`UPDATE marketplace_listing
					 SET external_id = NULL, external_variant_id = NULL, external_url = NULL,
					     status = 'paused', last_synced_at = datetime('now'),
					     last_sync_status = 'ok',
					     last_sync_error = 'Deleted from Squarespace (item retired).',
					     updated_at = datetime('now')
					 WHERE item_id = ? AND platform = 'squarespace'`
				)
				.bind(itemId)
				.run();
			return { status: 'ok', action: 'delete', productId };
		} catch (err) {
			const message = errMessage(err);
			await recordSyncResult(db, itemId, 'squarespace', {
				status: listing.status,
				syncStatus: 'error',
				syncError: `Auto-delete from Squarespace failed: ${message}`
			});
			return { status: 'error', action: 'delete', message };
		}
	}

	// ---- Content push (title / price / SKU / stock edited) --------
	// Routine auto-sync NEVER touches the description: Dad styles his listing
	// copy in Squarespace's editor, and clobbering it with our plainer HTML
	// on every price/stock tweak would wipe that work. So we re-fetch the
	// live product and re-send its OWN description, slug, tags and visibility
	// verbatim — only the title and the variant's price / SKU / stock carry
	// over from our record. (To deliberately rewrite the SS copy, Dad uses
	// the Squarespace listing editor's Push, which is an explicit choice.)
	if (change.type === 'content') {
		try {
			const prod = await getProduct(apiKey, productId);
			const priceValue = ((item.price_cents ?? 0) / 100).toFixed(2);
			const payload: SquarespaceProductWritePayload = {
				type: 'PHYSICAL',
				name: item.title,
				description: prod.description, // preserve Dad's Squarespace styling
				urlSlug: prod.urlSlug,
				tags: prod.tags,
				isVisible: prod.isVisible,
				variants: [
					{
						sku: item.sku,
						pricing: { basePrice: { value: priceValue, currency: 'USD' } },
						stock: {
							quantity: item.stock_qty,
							unlimited: prod.variants?.[0]?.stock?.unlimited ?? false
						}
					}
				]
			};
			await updateProductFull(apiKey, productId, payload);
			// Keep our local copy of the fields we actually push (title + price)
			// in lock-step. We deliberately DON'T touch listing_description_html
			// here — the SS description is the source of truth for listing copy.
			await db
				.prepare(
					`UPDATE marketplace_listing
					 SET listing_title = ?,
					     listing_price_cents = ?,
					     status = CASE WHEN status = 'error' THEN 'live' ELSE status END,
					     last_synced_at = datetime('now'),
					     last_sync_status = 'ok', last_sync_error = NULL,
					     updated_at = datetime('now')
					 WHERE item_id = ? AND platform = 'squarespace'`
				)
				.bind(item.title, item.price_cents, itemId)
				.run();
			return { status: 'ok', action: 'content', productId };
		} catch (err) {
			const message = errMessage(err);
			await recordSyncResult(db, itemId, 'squarespace', {
				status: listing.status,
				syncStatus: 'error',
				syncError: `Auto content-sync to Squarespace failed: ${message}`
			});
			return { status: 'error', action: 'content', message };
		}
	}

	// ---- Stock update (quantity changed) ---------------------------
	try {
		// Re-fetch the live product so we preserve name / description /
		// tags / visibility and only change the variant's stock. (Same
		// safe pattern the dashboard's price push uses.)
		const prod = await getProduct(apiKey, productId);
		const variant = prod.variants?.[0];
		const payload: SquarespaceProductWritePayload = {
			type: 'PHYSICAL',
			name: prod.name,
			description: prod.description,
			urlSlug: prod.urlSlug,
			tags: prod.tags,
			isVisible: prod.isVisible,
			variants: [
				{
					sku: variant?.sku ?? item.sku,
					pricing: {
						basePrice: variant?.pricing?.basePrice ?? { value: '0.00', currency: 'USD' }
					},
					// quantity 0 with isVisible true = SS renders "Sold Out"
					// but keeps the listing on the storefront — exactly what
					// we want for an out-of-stock sellable item.
					stock: { quantity: change.quantity, unlimited: variant?.stock?.unlimited ?? false }
				}
			]
		};
		await updateProductFull(apiKey, productId, payload);
		await recordSyncResult(db, itemId, 'squarespace', {
			// A successful sync clears a stale 'error' status back to live;
			// otherwise leave whatever state Dad set (e.g. 'paused').
			status: listing.status === 'error' ? 'live' : listing.status,
			syncStatus: 'ok',
			syncError: null
		});
		return { status: 'ok', action: 'stock', productId };
	} catch (err) {
		const message = errMessage(err);
		await recordSyncResult(db, itemId, 'squarespace', {
			status: listing.status,
			syncStatus: 'error',
			syncError: `Auto stock-sync to Squarespace failed: ${message}`
		});
		return { status: 'error', action: 'stock', message };
	}
}

export interface PublishAsSellableResult {
	sku: string | null;
	sync: SsAutoSyncOutcome;
	/** SEO title/description + shipping can only be set in Squarespace admin
	 *  (the Products API rejects those fields on write). True when we DID
	 *  publish but the SEO title is still blank — so the caller can softly
	 *  nudge Dad to fill it in, without blocking anything. */
	seoMissing: boolean;
}

/**
 * Mark an item sellable AND push it live to Squarespace in one step — the
 * "confirm → sell it" action the go-live wizard uses.
 *
 * Sets the `sellable` flag FIRST (the auto-sync gates on it), then runs a
 * full content sync. For an item already linked to Squarespace this
 * publishes/refreshes the product and turns on ongoing auto-sync; for one
 * with no Squarespace product yet it just flips the flag and returns a
 * `skipped` sync (the caller tells Dad to list it from the editor, which
 * has the storefront picker + photo upload). Never throws.
 */
export async function publishItemAsSellable(
	db: D1Database,
	apiKey: string | undefined,
	itemId: number
): Promise<PublishAsSellableResult> {
	await db
		.prepare(`UPDATE item SET sellable = 1, updated_at = datetime('now') WHERE id = ?`)
		.bind(itemId)
		.run();

	const sync = await autoSyncSquarespaceForItem(db, apiKey, itemId, { type: 'content' });

	const row = await db
		.prepare(
			`SELECT i.sku, ml.listing_seo_title
			 FROM item i
			 LEFT JOIN marketplace_listing ml
			   ON ml.item_id = i.id AND ml.platform = 'squarespace'
			 WHERE i.id = ?`
		)
		.bind(itemId)
		.first<{ sku: string; listing_seo_title: string | null }>();

	return {
		sku: row?.sku ?? null,
		sync,
		seoMissing: sync.status === 'ok' && !(row?.listing_seo_title ?? '').trim()
	};
}
