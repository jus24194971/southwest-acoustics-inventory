import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import {
	getProduct as getSsProduct,
	updateProductFull as updateSsProduct,
	listOrders as listSsOrders,
	SquarespaceError,
	type SquarespaceProductWritePayload
} from '$lib/server/squarespace';
import {
	updateListing as updateReverbListing,
	listSellingOrders as listReverbOrders,
	reverbOrderListingId,
	ReverbError
} from '$lib/server/reverb';
import {
	getOffersBySku,
	updateOffer as updateEbayOffer,
	publishOffer as publishEbayOffer,
	getOrders as getEbayOrders,
	EbayError
} from '$lib/server/ebay';
import { resolveEbayCreds } from '$lib/server/ebay_credentials';

/**
 * /listings — the single-pane-of-glass view across every marketplace.
 *
 * One row per (item, platform) listing that's been pushed. Built so Dad
 * can answer "what's selling and what's not" at a glance and adjust
 * price without diving into each platform's editor:
 *   - photo, linked item, platform, current listing price, shipping
 *   - date listed + days-live (stale listings = candidates to re-price)
 *   - status + a "Sold / out of stock" badge + last-sold date
 *
 * The inline price field + "Save & push" updates marketplace_listing
 * AND pushes the new price to the platform (SS variant price, Reverb
 * price, eBay offer price).
 */

interface ListingRow {
	listing_id: number;
	item_id: number;
	platform: string;
	sku: string;
	item_title: string;
	listing_title: string | null;
	base_price_cents: number | null;
	listing_price_cents: number | null;
	free_shipping: number;
	weight_oz: number | null;
	status: string;
	listed_at: string | null;
	last_synced_at: string | null;
	external_url: string | null;
	external_id: string | null;
	stock_qty: number;
	tracking_mode: 'serialized' | 'stocked';
	thumb_r2_key: string | null;
	last_sold_at: string | null;
	sold_qty: number;
}

/** One platform's listing for an item — the editable price cell. */
interface PlatformListing {
	listing_id: number;
	listing_price_cents: number | null;
	status: string;
	external_id: string | null;
	external_url: string | null;
	listed_at: string | null;
	free_shipping: number;
	weight_oz: number | null;
}

/** One item, with its listings across platforms keyed by platform. */
interface ItemListings {
	item_id: number;
	sku: string;
	item_title: string;
	base_price_cents: number | null;
	stock_qty: number;
	tracking_mode: 'serialized' | 'stocked';
	thumb_r2_key: string | null;
	last_sold_at: string | null;
	/** Cumulative units sold (sum of 'sale' movement quantities). */
	sold_qty: number;
	/** Most-recent listed_at across platforms (ms epoch) — for sorting. */
	latest_listed_ms: number | null;
	platforms: Record<string, PlatformListing>;
}

// Item-level sort keys (we group by item, then sort the grouped array).
const SORT_KEYS = ['item', 'base', 'listed', 'sold'] as const;
type SortKey = (typeof SORT_KEYS)[number];
const SORT_DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
	item: 'asc',
	base: 'desc',
	listed: 'desc',
	sold: 'asc'
};
const DEFAULT_SORT: SortKey = 'listed';

function parseTs(ts: string | null): number | null {
	if (!ts) return null;
	const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
	return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const url = event.url;

	const platformFilter = (url.searchParams.get('platform') ?? '').trim().toLowerCase();
	const sortRequested = (url.searchParams.get('sort') ?? '').trim().toLowerCase() as SortKey;
	const sortKey: SortKey = SORT_KEYS.includes(sortRequested) ? sortRequested : DEFAULT_SORT;
	const dirRequested = (url.searchParams.get('dir') ?? '').trim().toLowerCase();
	const sortDir: 'asc' | 'desc' =
		dirRequested === 'asc' || dirRequested === 'desc'
			? (dirRequested as 'asc' | 'desc')
			: SORT_DEFAULT_DIR[sortKey];

	// Flat fetch of every "real" listing; we group by item below. The
	// platform filter narrows to ITEMS that have a listing on that
	// platform (the row still shows all platforms for those items).
	const filterItemsOnPlatform = ['squarespace', 'reverb', 'ebay', 'etsy'].includes(
		platformFilter
	)
		? platformFilter
		: null;

	const sql = `
		SELECT
			ml.id            AS listing_id,
			ml.item_id,
			ml.platform,
			i.sku,
			i.title          AS item_title,
			ml.listing_title,
			i.price_cents    AS base_price_cents,
			ml.listing_price_cents,
			ml.listing_free_shipping AS free_shipping,
			ml.listing_weight_oz     AS weight_oz,
			ml.status,
			ml.listed_at,
			ml.last_synced_at,
			ml.external_url,
			ml.external_id,
			i.stock_qty,
			i.tracking_mode,
			(SELECT r2_key FROM item_photo p
			 WHERE p.item_id = i.id AND p.deleted_at IS NULL
			 ORDER BY p.position, p.id LIMIT 1) AS thumb_r2_key,
			(SELECT MAX(created_at) FROM movement m
			 WHERE m.item_id = i.id AND m.kind = 'sale') AS last_sold_at,
			(SELECT COALESCE(SUM(quantity), 0) FROM movement m
			 WHERE m.item_id = i.id AND m.kind = 'sale') AS sold_qty
		FROM marketplace_listing ml
		JOIN item i ON i.id = ml.item_id
		WHERE i.deleted_at IS NULL
		  AND (ml.external_id IS NOT NULL OR ml.status != 'draft')
		ORDER BY i.id
		LIMIT 2000
	`;

	const { results } = await db.prepare(sql).all<ListingRow>();

	// Summary over flat rows (before any platform filtering of items).
	const now = Date.now();
	const STALE_DAYS = 30;
	let liveCount = 0;
	let staleCount = 0;
	let totalListedValueCents = 0;
	const soldItemIds = new Set<number>();
	for (const r of results) {
		const price = r.listing_price_cents ?? r.base_price_cents ?? 0;
		if (r.status === 'live') {
			liveCount++;
			totalListedValueCents += price;
		}
		if (r.stock_qty === 0) soldItemIds.add(r.item_id);
		const listedMs = parseTs(r.listed_at);
		if (r.stock_qty > 0 && r.status === 'live' && listedMs && now - listedMs > STALE_DAYS * 86400000) {
			staleCount++;
		}
	}

	// Group flat rows → one ItemListings per item.
	const byItem = new Map<number, ItemListings>();
	for (const r of results) {
		let it = byItem.get(r.item_id);
		if (!it) {
			it = {
				item_id: r.item_id,
				sku: r.sku,
				item_title: r.item_title,
				base_price_cents: r.base_price_cents,
				stock_qty: r.stock_qty,
				tracking_mode: r.tracking_mode,
				thumb_r2_key: r.thumb_r2_key,
				last_sold_at: r.last_sold_at,
				sold_qty: r.sold_qty,
				latest_listed_ms: null,
				platforms: {}
			};
			byItem.set(r.item_id, it);
		}
		it.platforms[r.platform] = {
			listing_id: r.listing_id,
			listing_price_cents: r.listing_price_cents,
			status: r.status,
			external_id: r.external_id,
			external_url: r.external_url,
			listed_at: r.listed_at,
			free_shipping: r.free_shipping,
			weight_oz: r.weight_oz
		};
		const listedMs = parseTs(r.listed_at);
		if (listedMs && (it.latest_listed_ms == null || listedMs > it.latest_listed_ms)) {
			it.latest_listed_ms = listedMs;
		}
	}

	let items = [...byItem.values()];

	// Platform filter: keep only items that have a listing on that platform.
	if (filterItemsOnPlatform) {
		items = items.filter((it) => it.platforms[filterItemsOnPlatform]);
	}

	// Sort the grouped items.
	const dirMul = sortDir === 'desc' ? -1 : 1;
	items.sort((a, b) => {
		let cmp = 0;
		switch (sortKey) {
			case 'item':
				cmp = a.item_title.localeCompare(b.item_title);
				break;
			case 'base':
				cmp = (a.base_price_cents ?? -1) - (b.base_price_cents ?? -1);
				break;
			case 'sold':
				cmp = a.stock_qty - b.stock_qty;
				break;
			case 'listed':
			default:
				cmp = (a.latest_listed_ms ?? 0) - (b.latest_listed_ms ?? 0);
				break;
		}
		if (cmp === 0) cmp = a.item_title.localeCompare(b.item_title);
		return cmp * dirMul;
	});

	return {
		items,
		filters: { platform: platformFilter },
		sort: { key: sortKey, dir: sortDir },
		summary: {
			items: items.length,
			live: liveCount,
			sold: soldItemIds.size,
			stale: staleCount,
			totalListedValueCents
		}
	};
};

// ---------------------------------------------------------------------
// Price update + push
// ---------------------------------------------------------------------

interface ListingForPush {
	id: number;
	item_id: number;
	platform: string;
	external_id: string | null;
	listing_description_html: string | null;
	platform_extras_json: string | null;
	status: string;
	sku: string;
	item_description_html: string | null;
	stock_qty: number;
}

async function pushPriceToPlatform(
	event: Parameters<Actions['updatePrice']>[0],
	listing: ListingForPush,
	priceCents: number
): Promise<void> {
	const env = event.platform?.env;
	const db = getDB(event);
	const priceStr = (priceCents / 100).toFixed(2);

	if (!listing.external_id) {
		throw new Error('This listing has not been pushed yet — open its editor to publish first.');
	}

	if (listing.platform === 'squarespace') {
		const apiKey = env?.SQUARESPACE_API_KEY;
		if (!apiKey) throw new Error('SQUARESPACE_API_KEY not configured.');
		// Re-fetch the live product and re-send it with only the price
		// changed, so we preserve name/description/tags/visibility/stock.
		const prod = await getSsProduct(apiKey, listing.external_id);
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
					sku: variant?.sku ?? listing.sku,
					pricing: {
						basePrice: {
							value: priceStr,
							currency: variant?.pricing?.basePrice?.currency ?? 'USD'
						}
					},
					stock: variant?.stock
						? { quantity: variant.stock.quantity, unlimited: variant.stock.unlimited }
						: { quantity: listing.stock_qty, unlimited: false }
				}
			]
		};
		await updateSsProduct(apiKey, listing.external_id, payload);
		return;
	}

	if (listing.platform === 'reverb') {
		const apiKey = env?.REVERB_API_KEY;
		if (!apiKey) throw new Error('REVERB_API_KEY not configured.');
		await updateReverbListing(apiKey, listing.external_id, {
			price: { amount: priceStr, currency: 'USD' }
		});
		return;
	}

	if (listing.platform === 'ebay') {
		if (!env) throw new Error('platform env missing');
		const creds = await resolveEbayCreds(db, env);
		if (!creds.hasRefreshToken) {
			throw new Error('eBay not connected — connect in Settings first.');
		}
		const extras = (() => {
			try {
				return JSON.parse(listing.platform_extras_json ?? '{}') as Record<string, string>;
			} catch {
				return {} as Record<string, string>;
			}
		})();
		const offers = await getOffersBySku(creds, listing.sku);
		const offer = offers.find((o) => o.marketplaceId === 'EBAY_US');
		if (!offer) {
			throw new Error('No eBay offer found for this SKU — open the eBay editor to publish.');
		}
		// updateOffer needs the full mutable payload; reconstruct from
		// stored extras + the new price. Updating a PUBLISHED offer
		// revises the live listing directly (no republish needed).
		await updateEbayOffer(creds, offer.offerId, {
			availableQuantity: listing.stock_qty,
			categoryId: extras.ebay_category_id ?? '',
			listingDescription:
				listing.listing_description_html || listing.item_description_html || '',
			listingPolicies: {
				fulfillmentPolicyId: extras.ebay_fulfillment_policy_id ?? '',
				paymentPolicyId: extras.ebay_payment_policy_id ?? '',
				returnPolicyId: extras.ebay_return_policy_id ?? ''
			},
			pricingSummary: { price: { value: priceStr, currency: 'USD' } },
			merchantLocationKey: creds.EBAY_MERCHANT_LOCATION_KEY ?? ''
		});
		// If the offer hadn't been published yet, publish it so the new
		// price is actually live.
		if (!offer.listingId) {
			await publishEbayOffer(creds, offer.offerId);
		}
		return;
	}

	throw new Error(`Price push not supported for platform "${listing.platform}".`);
}

export const actions: Actions = {
	updatePrice: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const listingId = parseInt((form.get('listing_id') ?? '').toString(), 10);
		const priceStr = (form.get('price') ?? '').toString().trim();

		if (!Number.isInteger(listingId)) return fail(400, { priceError: 'Bad listing id', listingId });
		const priceFloat = parseFloat(priceStr);
		if (!Number.isFinite(priceFloat) || priceFloat < 0) {
			return fail(400, { priceError: 'Enter a valid price.', listingId });
		}
		const priceCents = Math.round(priceFloat * 100);

		// Load the listing + item context needed for a platform push.
		const listing = await db
			.prepare(
				`SELECT ml.id, ml.item_id, ml.platform, ml.external_id,
				        ml.listing_description_html, ml.platform_extras_json, ml.status,
				        i.sku, i.description_html AS item_description_html, i.stock_qty
				 FROM marketplace_listing ml
				 JOIN item i ON i.id = ml.item_id
				 WHERE ml.id = ?`
			)
			.bind(listingId)
			.first<ListingForPush>();
		if (!listing) throw error(404, 'Listing not found');

		// Save the new price locally first (so it's recorded even if the
		// platform push then fails).
		await db
			.prepare(
				`UPDATE marketplace_listing
				 SET listing_price_cents = ?, updated_at = datetime('now')
				 WHERE id = ?`
			)
			.bind(priceCents, listingId)
			.run();

		// A listing that was never pushed can't have a live price update.
		// Save locally and tell the user to publish via the editor.
		if (!listing.external_id) {
			throw redirect(303, `/listings?saved=${listingId}`);
		}

		// Update price live on the platform.
		try {
			await pushPriceToPlatform(event, listing, priceCents);
			await db
				.prepare(
					`UPDATE marketplace_listing
					 SET last_synced_at = datetime('now'), last_sync_status = 'ok',
					     last_sync_error = NULL, updated_at = datetime('now')
					 WHERE id = ?`
				)
				.bind(listingId)
				.run();
			throw redirect(303, `/listings?pushed=${listingId}`);
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			const message =
				err instanceof SquarespaceError || err instanceof ReverbError || err instanceof EbayError
					? `HTTP ${err.httpStatus}: ${err.body.slice(0, 300)}`
					: err instanceof Error
						? err.message
						: String(err);
			await db
				.prepare(
					`UPDATE marketplace_listing
					 SET last_sync_status = 'error', last_sync_error = ?, updated_at = datetime('now')
					 WHERE id = ?`
				)
				.bind(message, listingId)
				.run();
			return fail(500, { priceError: message, listingId });
		}
	},

	// ----------------------------------------------------------------
	// Pull SOLD metrics from Squarespace orders.
	// ----------------------------------------------------------------
	// Walks recent SS orders, matches line items to our items by SKU,
	// and writes a 'sale' movement (decrementing on-hand) for each line
	// we haven't seen before. Idempotent via a per-line reference
	// (`ss-order:<orderId>:<sku>`) — re-running never double-counts.
	//
	// Window: last 90 days. The movement's created_at is backdated to
	// the order date so "last sold" reflects reality, not sync time.
	syncSquarespaceSales: async (event) => {
		const db = getDB(event);
		const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
		if (!apiKey) return fail(400, { syncError: 'SQUARESPACE_API_KEY not configured.' });

		// Build three match maps. SKU is the obvious key, but it BREAKS
		// for orders placed before a SKU rename (the order line keeps the
		// old SKU forever). The Squarespace product/variant id, on the
		// other hand, is stable across renames — and we store it as
		// external_id / external_variant_id on the SS listing. So we
		// match variantId → productId → sku, in that order of confidence.
		type ItemRec = {
			id: number;
			sku: string;
			current_bin_id: number | null;
			stock_qty: number;
		};
		const { results: items } = await db
			.prepare(`SELECT id, sku, current_bin_id, stock_qty FROM item WHERE deleted_at IS NULL`)
			.all<ItemRec>();
		const bySku = new Map<string, ItemRec>(items.map((i) => [i.sku.toLowerCase(), i]));

		const byProductId = new Map<string, ItemRec>();
		const byVariantId = new Map<string, ItemRec>();
		const { results: ssLinks } = await db
			.prepare(
				`SELECT i.id, i.sku, i.current_bin_id, i.stock_qty,
				        ml.external_id, ml.external_variant_id
				 FROM item i
				 JOIN marketplace_listing ml ON ml.item_id = i.id AND ml.platform = 'squarespace'
				 WHERE i.deleted_at IS NULL AND ml.external_id IS NOT NULL`
			)
			.all<ItemRec & { external_id: string; external_variant_id: string | null }>();
		for (const r of ssLinks) {
			const rec: ItemRec = {
				id: r.id,
				sku: r.sku,
				current_bin_id: r.current_bin_id,
				stock_qty: r.stock_qty
			};
			if (r.external_id) byProductId.set(r.external_id, rec);
			if (r.external_variant_id) byVariantId.set(r.external_variant_id, rec);
		}

		const now = new Date();
		const modifiedBefore = now.toISOString();
		const modifiedAfter = new Date(now.getTime() - 90 * 86400000).toISOString();

		let cursor: string | undefined;
		let pages = 0;
		let recorded = 0;
		let skipped = 0;
		let unmatched = 0;
		const writes: import('@cloudflare/workers-types').D1PreparedStatement[] = [];

		try {
			do {
				const pageData = await listSsOrders(
					apiKey,
					cursor ? { cursor } : { modifiedAfter, modifiedBefore }
				);
				pages++;
				for (const order of pageData.result) {
					if (order.fulfillmentStatus === 'CANCELED') continue;
					for (const li of order.lineItems ?? []) {
						const sku = (li.sku ?? '').trim();
						// Match variantId → productId → sku (most → least
						// reliable across SKU renames).
						const item =
							(li.variantId ? byVariantId.get(li.variantId) : undefined) ??
							(li.productId ? byProductId.get(li.productId) : undefined) ??
							(sku ? bySku.get(sku.toLowerCase()) : undefined);
						if (!item) {
							unmatched++;
							continue;
						}
						// Idempotency key — stable per order line, independent of
						// how we matched it. Prefer the SS line-item id.
						const refKey = li.id ?? li.variantId ?? li.productId ?? sku;
						const ref = `ss-order:${order.id}:${refKey}`;
						// Also check the legacy sku-based ref from the first
						// version of this sync, so the upgrade doesn't re-count
						// anything already recorded.
						const legacyRef = sku ? `ss-order:${order.id}:${sku}` : ref;
						const existing = await db
							.prepare(`SELECT 1 AS x FROM movement WHERE reference IN (?, ?) LIMIT 1`)
							.bind(ref, legacyRef)
							.first();
						if (existing) {
							skipped++;
							continue;
						}
						const qty = li.quantity && li.quantity > 0 ? li.quantity : 1;
						writes.push(
							db
								.prepare(
									`INSERT INTO movement
									 (item_id, kind, from_bin_id, to_bin_id, quantity, note, actor, reference, created_at)
									 VALUES (?, 'sale', ?, NULL, ?, ?, 'squarespace-sync', ?, ?)`
								)
								.bind(
									item.id,
									item.current_bin_id,
									qty,
									`Squarespace order ${order.orderNumber ?? order.id}`,
									ref,
									order.createdOn
								)
						);
						writes.push(
							db
								.prepare(
									`UPDATE item SET stock_qty = MAX(0, stock_qty - ?), updated_at = datetime('now') WHERE id = ?`
								)
								.bind(qty, item.id)
						);
						recorded++;
					}
				}
				cursor = pageData.pagination.hasNextPage
					? pageData.pagination.nextPageCursor
					: undefined;
			} while (cursor && pages < 12); // cap pages to stay under Workers subrequest limit

			if (writes.length > 0) await db.batch(writes);

			const params = new URLSearchParams({
				synced: 'squarespace',
				recorded: String(recorded),
				skipped: String(skipped),
				unmatched: String(unmatched)
			});
			throw redirect(303, `/listings?${params.toString()}`);
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			const message =
				err instanceof SquarespaceError
					? `HTTP ${err.httpStatus} from Squarespace: ${err.body.slice(0, 300)}`
					: err instanceof Error
						? err.message
						: String(err);
			return fail(500, { syncError: message });
		}
	},

	// ----------------------------------------------------------------
	// Pull SOLD metrics from Reverb orders.
	// ----------------------------------------------------------------
	// Same shape as the Squarespace sync. Reverb orders reference a
	// listing id, which we match to our stored Reverb external_id
	// (stable across SKU renames), falling back to SKU. Cancelled /
	// refunded orders are skipped. Idempotent via
	// `reverb-order:<orderNumber>:<listingId|sku>`.
	syncReverbSales: async (event) => {
		const db = getDB(event);
		const apiKey = event.platform?.env?.REVERB_API_KEY;
		if (!apiKey) return fail(400, { syncError: 'REVERB_API_KEY not configured.' });

		type ItemRec = {
			id: number;
			sku: string;
			current_bin_id: number | null;
			stock_qty: number;
		};
		const { results: items } = await db
			.prepare(`SELECT id, sku, current_bin_id, stock_qty FROM item WHERE deleted_at IS NULL`)
			.all<ItemRec>();
		const bySku = new Map<string, ItemRec>(items.map((i) => [i.sku.toLowerCase(), i]));

		// Reverb listing id → item (stable across SKU renames).
		const byListingId = new Map<string, ItemRec>();
		const { results: rvLinks } = await db
			.prepare(
				`SELECT i.id, i.sku, i.current_bin_id, i.stock_qty, ml.external_id
				 FROM item i
				 JOIN marketplace_listing ml ON ml.item_id = i.id AND ml.platform = 'reverb'
				 WHERE i.deleted_at IS NULL AND ml.external_id IS NOT NULL`
			)
			.all<ItemRec & { external_id: string }>();
		for (const r of rvLinks) {
			byListingId.set(String(r.external_id), {
				id: r.id,
				sku: r.sku,
				current_bin_id: r.current_bin_id,
				stock_qty: r.stock_qty
			});
		}

		let page = 1;
		let pages = 0;
		let recorded = 0;
		let skipped = 0;
		let unmatched = 0;
		const writes: import('@cloudflare/workers-types').D1PreparedStatement[] = [];

		try {
			while (pages < 12) {
				const data = await listReverbOrders(apiKey, { page, perPage: 50 });
				pages++;
				const orders = data.orders ?? [];
				if (orders.length === 0) break;

				for (const o of orders) {
					const status = (o.status ?? '').toLowerCase();
					if (status.includes('cancel') || status.includes('refund')) continue;

					const listingId = reverbOrderListingId(o);
					const sku = (o.sku ?? '').trim();
					const item =
						(listingId ? byListingId.get(listingId) : undefined) ??
						(sku ? bySku.get(sku.toLowerCase()) : undefined);
					if (!item) {
						unmatched++;
						continue;
					}

					const ref = `reverb-order:${o.order_number ?? listingId ?? sku}:${listingId ?? sku}`;
					const existing = await db
						.prepare(`SELECT 1 AS x FROM movement WHERE reference = ? LIMIT 1`)
						.bind(ref)
						.first();
					if (existing) {
						skipped++;
						continue;
					}

					const qty = o.quantity && o.quantity > 0 ? o.quantity : 1;
					writes.push(
						db
							.prepare(
								`INSERT INTO movement
								 (item_id, kind, from_bin_id, to_bin_id, quantity, note, actor, reference, created_at)
								 VALUES (?, 'sale', ?, NULL, ?, ?, 'reverb-sync', ?, ?)`
							)
							.bind(
								item.id,
								item.current_bin_id,
								qty,
								`Reverb order ${o.order_number ?? ''}`.trim(),
								ref,
								o.created_at ?? new Date().toISOString()
							)
					);
					writes.push(
						db
							.prepare(
								`UPDATE item SET stock_qty = MAX(0, stock_qty - ?), updated_at = datetime('now') WHERE id = ?`
							)
							.bind(qty, item.id)
					);
					recorded++;
				}

				const hasNext =
					!!data._links?.next?.href ||
					(data.total_pages != null && page < data.total_pages);
				if (!hasNext) break;
				page++;
			}

			if (writes.length > 0) await db.batch(writes);

			const params = new URLSearchParams({
				synced: 'reverb',
				recorded: String(recorded),
				skipped: String(skipped),
				unmatched: String(unmatched)
			});
			throw redirect(303, `/listings?${params.toString()}`);
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			const message =
				err instanceof ReverbError
					? `HTTP ${err.httpStatus} from Reverb: ${err.body.slice(0, 300)}`
					: err instanceof Error
						? err.message
						: String(err);
			return fail(500, { syncError: message });
		}
	},

	// ----------------------------------------------------------------
	// Pull SOLD metrics from eBay orders (Fulfillment API).
	// ----------------------------------------------------------------
	// Match line items by SKU (eBay SKUs are current) then legacyItemId
	// → stored listingId. Skip canceled orders. Idempotent via
	// `ebay-order:<orderId>:<lineItemId>`. Needs the sell.fulfillment
	// scope — a 403 means the token predates it (Re-authorize in Settings).
	syncEbaySales: async (event) => {
		const db = getDB(event);
		const env = event.platform?.env;
		if (!env) return fail(500, { syncError: 'platform env missing' });
		const creds = await resolveEbayCreds(db, env);
		if (!creds.hasRefreshToken) {
			return fail(400, { syncError: 'eBay not connected — connect in Settings first.' });
		}

		type ItemRec = {
			id: number;
			sku: string;
			current_bin_id: number | null;
			stock_qty: number;
		};
		const { results: items } = await db
			.prepare(`SELECT id, sku, current_bin_id, stock_qty FROM item WHERE deleted_at IS NULL`)
			.all<ItemRec>();
		const bySku = new Map<string, ItemRec>(items.map((i) => [i.sku.toLowerCase(), i]));

		// eBay listing id (external_variant_id, set on publish) → item.
		const byListingId = new Map<string, ItemRec>();
		const { results: ebLinks } = await db
			.prepare(
				`SELECT i.id, i.sku, i.current_bin_id, i.stock_qty, ml.external_variant_id
				 FROM item i
				 JOIN marketplace_listing ml ON ml.item_id = i.id AND ml.platform = 'ebay'
				 WHERE i.deleted_at IS NULL AND ml.external_variant_id IS NOT NULL`
			)
			.all<ItemRec & { external_variant_id: string }>();
		for (const r of ebLinks) {
			byListingId.set(String(r.external_variant_id), {
				id: r.id,
				sku: r.sku,
				current_bin_id: r.current_bin_id,
				stock_qty: r.stock_qty
			});
		}

		const now = new Date();
		const creationDateTo = now.toISOString();
		const creationDateFrom = new Date(now.getTime() - 90 * 86400000).toISOString();

		let offset = 0;
		let pages = 0;
		let recorded = 0;
		let skipped = 0;
		let unmatched = 0;
		const writes: import('@cloudflare/workers-types').D1PreparedStatement[] = [];

		try {
			while (pages < 12) {
				const data = await getEbayOrders(creds, {
					creationDateFrom,
					creationDateTo,
					offset,
					limit: 200
				});
				pages++;
				const orders = data.orders ?? [];
				if (orders.length === 0) break;

				for (const o of orders) {
					if (o.cancelStatus?.cancelState === 'CANCELED') continue;
					for (const li of o.lineItems ?? []) {
						const sku = (li.sku ?? '').trim();
						const item =
							(sku ? bySku.get(sku.toLowerCase()) : undefined) ??
							(li.legacyItemId ? byListingId.get(li.legacyItemId) : undefined);
						if (!item) {
							unmatched++;
							continue;
						}
						const ref = `ebay-order:${o.orderId}:${li.lineItemId}`;
						const existing = await db
							.prepare(`SELECT 1 AS x FROM movement WHERE reference = ? LIMIT 1`)
							.bind(ref)
							.first();
						if (existing) {
							skipped++;
							continue;
						}
						const qty = li.quantity && li.quantity > 0 ? li.quantity : 1;
						writes.push(
							db
								.prepare(
									`INSERT INTO movement
									 (item_id, kind, from_bin_id, to_bin_id, quantity, note, actor, reference, created_at)
									 VALUES (?, 'sale', ?, NULL, ?, ?, 'ebay-sync', ?, ?)`
								)
								.bind(
									item.id,
									item.current_bin_id,
									qty,
									`eBay order ${o.orderId}`,
									ref,
									o.creationDate ?? new Date().toISOString()
								)
						);
						writes.push(
							db
								.prepare(
									`UPDATE item SET stock_qty = MAX(0, stock_qty - ?), updated_at = datetime('now') WHERE id = ?`
								)
								.bind(qty, item.id)
						);
						recorded++;
					}
				}

				offset += orders.length;
				if (!data.next) break;
			}

			if (writes.length > 0) await db.batch(writes);

			const params = new URLSearchParams({
				synced: 'ebay',
				recorded: String(recorded),
				skipped: String(skipped),
				unmatched: String(unmatched)
			});
			throw redirect(303, `/listings?${params.toString()}`);
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			// A 403 almost always means the token lacks sell.fulfillment.
			if (err instanceof EbayError && err.httpStatus === 403) {
				return fail(400, {
					syncError:
						'eBay denied order access (403). Re-authorize eBay in Settings → eBay to grant the orders permission, then sync again.'
				});
			}
			const message =
				err instanceof EbayError
					? `HTTP ${err.httpStatus} from eBay: ${err.body.slice(0, 300)}`
					: err instanceof Error
						? err.message
						: String(err);
			return fail(500, { syncError: message });
		}
	}
};
