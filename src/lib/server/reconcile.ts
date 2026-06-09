/**
 * Cross-platform listing scrape for the go-live reconciliation flow.
 *
 * Pulls every listing Dad has on Squarespace, Reverb, and eBay into one
 * normalized shape so the wizard can match them and create unified
 * inventory items. Each platform scraper is independent and paginated;
 * the caller runs them with per-platform error capture so one dead
 * connection doesn't sink the whole scrape.
 *
 * eBay note: Browse only returns LIVE listings and no quantity (see
 * searchSellerListings). Squarespace + Reverb give stock too.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { listProducts } from './squarespace';
import { listMyListings } from './reverb';
import { getAccountUsername, searchSellerListings } from './ebay';
import type { ResolvedEbayCreds } from './ebay_credentials';
import { upsertListingContent, recordSyncResult, type Platform } from './listings';

export type ReconcilePlatform = 'squarespace' | 'ebay' | 'reverb';

export interface ScrapedListing {
	platform: ReconcilePlatform;
	externalId: string;
	title: string;
	sku: string | null;
	priceCents: number | null;
	qty: number | null;
	imageUrl: string | null;
	url: string | null;
	raw: unknown;
}

/**
 * Guitar/bass model families that must NEVER be merged into one product,
 * even when their listings otherwise look similar. A Telecaster body and
 * a Stratocaster body are different parts; lumping them is a real data
 * error, and the fuzzy AI matcher will do it because the titles overlap
 * heavily ("Fender … electric guitar … loaded …"). This is the
 * deterministic backstop, applied after the AI groups.
 *
 * Order matters: more-specific patterns first (jazzmaster before the
 * jazz-bass pattern, etc.). Add a row to extend.
 */
const MODEL_FAMILY_PATTERNS: Array<[string, RegExp]> = [
	['telecaster', /\b(telecaster|tele)\b/i],
	['stratocaster', /\b(stratocaster|strat)\b/i],
	['jazzmaster', /\bjazzmaster\b/i],
	['jaguar', /\bjaguar\b/i],
	['mustang', /\bmustang\b/i],
	['les_paul', /\b(les[\s-]*paul|lespaul)\b/i],
	['precision_bass', /\b(precision\s*bass|p[\s-]?bass)\b/i],
	['jazz_bass', /\b(jazz\s*bass|j[\s-]?bass)\b/i]
];

/** Detect which mutually-exclusive model family a listing title belongs
 *  to, or null if none is named. */
export function detectModelFamily(title: string): string | null {
	for (const [family, re] of MODEL_FAMILY_PATTERNS) {
		if (re.test(title)) return family;
	}
	return null;
}

/**
 * Link every scraped listing in a group to a (just-created) inventory
 * item, with the CORRECT external identifiers so future stock/status
 * updates hit the exact live listing:
 *   - Squarespace → product id (external_id) + the real storefront URL
 *     (external_url) — slug-safe, since we use the id, not the slug.
 *   - Reverb      → listing id (external_id) + web URL.
 *   - eBay        → legacy item id (external_variant_id, for sold-tracking)
 *     + item URL. No offer id — these are classic listings.
 *
 * One marketplace_listing row per platform (the first listing of each);
 * any extra same-platform listings in the group are duplicates and are
 * left for the cleanup tool. Reuses the canonical upsert + sync-record
 * helpers so the row is well-formed.
 */
export async function adoptGroupListings(
	db: D1Database,
	groupId: number,
	itemId: number,
	itemTitle: string,
	itemPriceCents: number | null
): Promise<string[]> {
	const { results: listings } = await db
		.prepare(
			`SELECT platform, external_id, url FROM reconcile_listing
			 WHERE group_id = ? ORDER BY platform, id`
		)
		.bind(groupId)
		.all<{ platform: string; external_id: string; url: string | null }>();

	const seen = new Set<string>();
	const adopted: string[] = [];
	for (const l of listings) {
		if (seen.has(l.platform)) continue; // one row per platform
		if (l.platform !== 'squarespace' && l.platform !== 'reverb' && l.platform !== 'ebay') continue;
		seen.add(l.platform);
		const platform = l.platform as Platform;

		await upsertListingContent(db, itemId, platform, {
			listing_title: itemTitle,
			listing_description_html: null,
			listing_url_slug: null,
			listing_tags_json: null,
			listing_price_cents: itemPriceCents,
			listing_visible: 1,
			storefront_id: null,
			status: 'live',
			listing_categories_json: null,
			listing_free_shipping: 0,
			listing_weight_oz: null,
			listing_seo_title: null,
			listing_seo_description: null
		});
		await recordSyncResult(db, itemId, platform, {
			// eBay classic listings have no offer id — store the legacy item
			// id as the variant id (what sold-tracking matches on).
			externalId: platform === 'ebay' ? null : l.external_id,
			externalVariantId: platform === 'ebay' ? l.external_id : null,
			externalUrl: l.url,
			status: 'live',
			syncStatus: 'ok',
			syncError: null
		});
		adopted.push(platform);
	}
	return adopted;
}

/** Safe decimal-string → integer cents. */
function toCents(value: string | null | undefined): number | null {
	if (!value) return null;
	const n = parseFloat(value);
	return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// Page caps — generous for a small shop, bounded so a runaway can't blow
// the Worker subrequest budget. Each loop also stops early when a page
// comes back short / says there's no next page.
const SS_MAX_PAGES = 40;
const REVERB_MAX_PAGES = 60;
const EBAY_MAX_PAGES = 25;
const EBAY_PAGE_SIZE = 200;

export async function scrapeSquarespace(apiKey: string): Promise<ScrapedListing[]> {
	const out: ScrapedListing[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < SS_MAX_PAGES; page++) {
		const resp = await listProducts(apiKey, cursor ? { cursor } : {});
		for (const p of resp.products ?? []) {
			const v = p.variants?.[0];
			out.push({
				platform: 'squarespace',
				externalId: p.id,
				title: p.name,
				sku: v?.sku ?? null,
				priceCents: toCents(v?.pricing?.basePrice?.value),
				qty: v?.stock?.unlimited ? null : (v?.stock?.quantity ?? null),
				imageUrl: p.images?.[0]?.url ?? null,
				url: p.url ?? null,
				raw: p
			});
		}
		if (!resp.pagination?.hasNextPage || !resp.pagination.nextPageCursor) break;
		cursor = resp.pagination.nextPageCursor;
	}
	return out;
}

export async function scrapeReverb(apiKey: string): Promise<ScrapedListing[]> {
	const out: ScrapedListing[] = [];
	for (let page = 1; page <= REVERB_MAX_PAGES; page++) {
		// `live` = currently up for sale (what Dad "has listed"). Drafts /
		// ended / sold are excluded as noise for onboarding.
		const resp = await listMyListings(apiKey, { page, perPage: 50, state: 'live' });
		const listings = resp.listings ?? [];
		for (const l of listings) {
			const photo =
				l.photos?.[0]?._links?.large_crop?.href ?? l.photos?.[0]?.url ?? null;
			out.push({
				platform: 'reverb',
				externalId: String(l.id),
				title: l.title ?? '(untitled)',
				sku: l.sku ?? null,
				priceCents: toCents(l.price?.amount),
				qty: l.has_inventory ? (l.inventory ?? null) : null,
				imageUrl: photo,
				url: l._links?.web?.href ?? null,
				raw: l
			});
		}
		const totalPages = resp.total_pages ?? 1;
		if (listings.length === 0 || page >= totalPages) break;
	}
	return out;
}

/**
 * Work out Dad's eBay seller username from whatever he pasted on the
 * reconcile page — a store link, a profile link, a seller-search link,
 * or the raw username. The Browse API's seller filter needs the user id,
 * which we can't reliably read from the API (the Identity endpoint needs
 * an extra OAuth scope), so this is the dependable source.
 *
 *   https://www.ebay.com/usr/<username>            → username
 *   https://www.ebay.com/sch/i.html?_ssn=<username>→ username
 *   https://www.ebay.com/str/<storeslug>           → fetch page, find id
 *   <rawusername>                                  → as-is
 */
export async function resolveEbayUsernameFromInput(input: string): Promise<string | null> {
	const s = (input ?? '').trim();
	if (!s) return null;

	const ssn = s.match(/[?&]_ssn=([A-Za-z0-9_.\-]+)/i);
	if (ssn) return decodeURIComponent(ssn[1]);
	const usr = s.match(/\/usr\/([A-Za-z0-9_.\-]+)/i);
	if (usr) return decodeURIComponent(usr[1]);

	const str = s.match(/\/str\/([A-Za-z0-9_.\-]+)/i);
	if (str) {
		// A store slug isn't necessarily the seller username, so fetch the
		// store page and pull the real id out of its markup. Fall back to
		// the slug if we can't find one.
		const fromPage = await extractUsernameFromPage(s);
		return fromPage ?? decodeURIComponent(str[1]);
	}

	// A bare token with no slashes/spaces is the username itself.
	if (!s.includes('/') && !s.includes(' ')) return s;

	// Some other eBay URL — try to mine a username out of it.
	return await extractUsernameFromPage(s);
}

/** Fetch an eBay page and look for the seller username embedded in it
 *  (as an `_ssn=` search link or a `/usr/` profile link). Best-effort. */
async function extractUsernameFromPage(url: string): Promise<string | null> {
	try {
		// Only ever fetch eBay pages — never an arbitrary user-supplied host.
		let host: string;
		try {
			host = new URL(url).hostname.toLowerCase();
		} catch {
			return null;
		}
		if (!/(^|\.)ebay\.[a-z.]+$/.test(host)) return null;

		const res = await fetch(url, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
				Accept: 'text/html'
			}
		});
		if (!res.ok) return null;
		const html = await res.text();
		const ssn = html.match(/[?&]_ssn=([A-Za-z0-9_.\-]+)/i);
		if (ssn) return decodeURIComponent(ssn[1]);
		const usr = html.match(/\/usr\/([A-Za-z0-9_.\-]+)/i);
		if (usr) return decodeURIComponent(usr[1]);
		return null;
	} catch {
		return null;
	}
}

export async function scrapeEbay(creds: ResolvedEbayCreds): Promise<ScrapedListing[]> {
	if (!creds.hasRefreshToken) {
		throw new Error('eBay isn’t connected — connect it in Settings to scrape your listings.');
	}

	// Resolve the seller username: the store link / username Dad entered
	// first (most reliable), then the stored account label, then the
	// Identity API as a last resort.
	let username: string | null = null;
	if (creds.ebaySellerUsername) {
		username = await resolveEbayUsernameFromInput(creds.ebaySellerUsername);
	}
	if (!username) username = creds.accountLabel;
	if (!username) username = await getAccountUsername(creds);
	if (!username) {
		throw new Error(
			'Enter your eBay store link or seller username on the Reconcile page so we can find your listings.'
		);
	}

	const out: ScrapedListing[] = [];
	for (let page = 0; page < EBAY_MAX_PAGES; page++) {
		const { items, total } = await searchSellerListings(creds, username, {
			offset: page * EBAY_PAGE_SIZE,
			limit: EBAY_PAGE_SIZE
		});
		for (const it of items) {
			out.push({
				platform: 'ebay',
				externalId: it.legacyItemId,
				title: it.title,
				sku: null, // Browse summaries don't expose the seller SKU
				priceCents: toCents(it.priceValue),
				qty: null, // Browse doesn't expose available quantity
				imageUrl: it.imageUrl,
				url: it.url,
				raw: it
			});
		}
		if (items.length === 0 || (page + 1) * EBAY_PAGE_SIZE >= total) break;
	}
	return out;
}
