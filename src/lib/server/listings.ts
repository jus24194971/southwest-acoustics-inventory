/**
 * Helpers for the marketplace_listing table. Keeps the routes thin —
 * load(), save(), push().
 *
 * Pattern: every marketplace listing has a "draft" content state stored
 * locally and a separate "live" state on the platform. Push reconciles
 * the two; outside of push, edits stay local. Manual cutover by design.
 */

import type { D1Database } from '@cloudflare/workers-types';

export type Platform = 'squarespace' | 'ebay' | 'reverb' | 'etsy';
export type ListingStatus = 'draft' | 'ready' | 'live' | 'paused' | 'error';
export type SyncStatus = 'ok' | 'error' | 'pending';

export interface MarketplaceListing {
	id: number;
	item_id: number;
	platform: Platform;
	listing_title: string | null;
	listing_description_html: string | null;
	listing_url_slug: string | null;
	listing_tags_json: string | null; // JSON array
	listing_price_cents: number | null;
	listing_visible: number;
	storefront_id: string | null;
	// Squarespace's "sub-shops" (Leo Jaymz, Parts, etc.) are tag-driven
	// since SS's Products API doesn't expose categories. We collect
	// chosen category slugs here, then merge them into listing_tags
	// at push time so the product lands on the right sub-shop URL.
	listing_categories_json: string | null; // JSON array of slugs
	// 0/1 — when 1, "free-shipping" tag is appended on push so Dad's
	// SS free-shipping rule kicks in.
	listing_free_shipping: number;
	// Optional shipping weight in ounces — pushed as the variant's
	// shippingMeasurements.weight so SS's weight-based rate rules
	// can calculate at checkout.
	listing_weight_oz: number | null;
	// Per-listing SEO override (Squarespace `seoOptions`). Plain
	// strings (meta description has no HTML by spec). Nullable —
	// when both are null, SS auto-derives from name + description,
	// which is also the platform-agnostic default for eBay / Reverb
	// if we add SEO controls there later.
	listing_seo_title: string | null;
	listing_seo_description: string | null;
	platform_extras_json: string | null;
	external_id: string | null;
	external_variant_id: string | null;
	external_url: string | null;
	status: ListingStatus;
	last_synced_at: string | null;
	last_sync_status: SyncStatus | null;
	last_sync_error: string | null;
	/** Stamped once when the listing first reaches 'live'. Stable
	 *  "date listed" — distinct from last_synced_at. */
	listed_at: string | null;
	created_at: string;
	updated_at: string;
}

export async function loadListing(
	db: D1Database,
	itemId: number,
	platform: Platform
): Promise<MarketplaceListing | null> {
	return await db
		.prepare(`SELECT * FROM marketplace_listing WHERE item_id = ? AND platform = ?`)
		.bind(itemId, platform)
		.first<MarketplaceListing>();
}

export async function listListingsForItem(
	db: D1Database,
	itemId: number
): Promise<MarketplaceListing[]> {
	const { results } = await db
		.prepare(`SELECT * FROM marketplace_listing WHERE item_id = ? ORDER BY platform`)
		.bind(itemId)
		.all<MarketplaceListing>();
	return results;
}

export interface UpsertFields {
	listing_title: string | null;
	listing_description_html: string | null;
	listing_url_slug: string | null;
	listing_tags_json: string | null;
	listing_price_cents: number | null;
	listing_visible: number;
	storefront_id: string | null;
	status: ListingStatus;
	listing_categories_json: string | null;
	listing_free_shipping: number;
	listing_weight_oz: number | null;
	listing_seo_title: string | null;
	listing_seo_description: string | null;
}

/** Upsert the listing's local-only content fields. Doesn't touch the
 *  external_id / last_synced_* fields — those are owned by the push
 *  path. Status here is whatever Dad picked: draft / ready / paused. */
export async function upsertListingContent(
	db: D1Database,
	itemId: number,
	platform: Platform,
	fields: UpsertFields
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO marketplace_listing (
				item_id, platform,
				listing_title, listing_description_html, listing_url_slug,
				listing_tags_json, listing_price_cents, listing_visible,
				storefront_id, status,
				listing_categories_json, listing_free_shipping, listing_weight_oz,
				listing_seo_title, listing_seo_description,
				updated_at
			)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT (item_id, platform) DO UPDATE SET
				listing_title = excluded.listing_title,
				listing_description_html = excluded.listing_description_html,
				listing_url_slug = excluded.listing_url_slug,
				listing_tags_json = excluded.listing_tags_json,
				listing_price_cents = excluded.listing_price_cents,
				listing_visible = excluded.listing_visible,
				storefront_id = excluded.storefront_id,
				status = excluded.status,
				listing_categories_json = excluded.listing_categories_json,
				listing_free_shipping = excluded.listing_free_shipping,
				listing_weight_oz = excluded.listing_weight_oz,
				listing_seo_title = excluded.listing_seo_title,
				listing_seo_description = excluded.listing_seo_description,
				updated_at = datetime('now')`
		)
		.bind(
			itemId,
			platform,
			fields.listing_title,
			fields.listing_description_html,
			fields.listing_url_slug,
			fields.listing_tags_json,
			fields.listing_price_cents,
			fields.listing_visible,
			fields.storefront_id,
			fields.status,
			fields.listing_categories_json,
			fields.listing_free_shipping,
			fields.listing_weight_oz,
			fields.listing_seo_title,
			fields.listing_seo_description
		)
		.run();
}

export async function recordSyncResult(
	db: D1Database,
	itemId: number,
	platform: Platform,
	args: {
		externalId?: string | null;
		externalVariantId?: string | null;
		externalUrl?: string | null;
		status: ListingStatus;
		syncStatus: SyncStatus;
		syncError?: string | null;
	}
): Promise<void> {
	await db
		.prepare(
			`UPDATE marketplace_listing
			 SET external_id = COALESCE(?, external_id),
			     external_variant_id = COALESCE(?, external_variant_id),
			     external_url = COALESCE(?, external_url),
			     status = ?,
			     -- Stamp listed_at once, the first time a listing reaches
			     -- 'live'. Never moved after — it's "date listed", not
			     -- "last touched" (that's last_synced_at).
			     listed_at = CASE
			         WHEN listed_at IS NULL AND ? = 'live' THEN datetime('now')
			         ELSE listed_at
			     END,
			     last_synced_at = datetime('now'),
			     last_sync_status = ?,
			     last_sync_error = ?,
			     updated_at = datetime('now')
			 WHERE item_id = ? AND platform = ?`
		)
		.bind(
			args.externalId ?? null,
			args.externalVariantId ?? null,
			args.externalUrl ?? null,
			args.status,
			args.status,
			args.syncStatus,
			args.syncError ?? null,
			itemId,
			platform
		)
		.run();
}

/** Slugify a string into a URL-safe form. Used as a default for
 *  listing_url_slug when Dad doesn't set one. */
export function defaultSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 80);
}
