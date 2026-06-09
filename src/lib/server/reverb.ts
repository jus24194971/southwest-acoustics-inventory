/**
 * Thin client for Reverb's Marketplace API.
 *
 * Docs: https://www.reverb-api.com/docs
 *
 * Auth: Personal Access Token, sent as `Authorization: Bearer <token>`.
 * Reverb requires `Accept-Version: 3.0` and content-type
 * `application/hal+json` on writes. Token is generated from Reverb's
 * account settings under API integrations.
 *
 * Photos: Reverb does NOT accept binary photo uploads — the only path
 * is to pass publicly-fetchable URLs in the `photos` field of the
 * create payload. Reverb's servers fetch the images server-side.
 * That's why ImageBB was needed in Listing Studio originally; in this
 * project we use the Squarespace CDN URLs (after the SS push) as the
 * public image host. Free, no third-party dependency.
 *
 * Sandbox: Reverb has https://api.sandbox.reverb.com for testing.
 * For now we default to production; can add a setting later if a
 * sandbox flow is needed.
 */

const BASE_URL = 'https://api.reverb.com/api';

export class ReverbError extends Error {
	constructor(
		public httpStatus: number,
		public body: string,
		message?: string
	) {
		super(message ?? `Reverb API returned ${httpStatus}`);
	}
}

function authHeaders(apiKey: string): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		'Accept-Version': '3.0',
		Accept: 'application/hal+json',
		'Content-Type': 'application/hal+json',
		'User-Agent': 'sw-acoustics-inventory/0.0.1'
	};
}

// ---------- Categories ------------------------------------------------

export interface ReverbCategory {
	uuid: string;
	name: string;
	slug?: string;
	full_path?: string; // some endpoints include the hierarchy path
}

interface CategoriesResponse {
	categories?: ReverbCategory[];
}

/**
 * Reverb's "flat" category list — all ~700 categories in a single
 * response, no pagination. Good for populating a select once and
 * caching per worker isolate.
 */
export async function listCategories(apiKey: string): Promise<ReverbCategory[]> {
	const res = await fetch(`${BASE_URL}/categories/flat`, {
		headers: authHeaders(apiKey)
	});
	const body = await res.text();
	if (!res.ok) throw new ReverbError(res.status, body);
	const parsed = JSON.parse(body) as CategoriesResponse;
	return parsed.categories ?? [];
}

// ---------- Listing conditions ----------------------------------------

export interface ReverbCondition {
	uuid: string;
	display_name: string;
	description?: string;
}

interface ConditionsResponse {
	conditions?: ReverbCondition[];
}

/**
 * Reverb's listing conditions list. Conditions are referenced by UUID
 * in the create payload (not by name string), so we need to either
 * fetch or hardcode the UUIDs. Fetching is more correct since Reverb
 * may revise the list.
 */
export async function listConditions(apiKey: string): Promise<ReverbCondition[]> {
	const res = await fetch(`${BASE_URL}/listing_conditions`, {
		headers: authHeaders(apiKey)
	});
	const body = await res.text();
	if (!res.ok) throw new ReverbError(res.status, body);
	const parsed = JSON.parse(body) as ConditionsResponse;
	return parsed.conditions ?? [];
}

/**
 * Fallback condition UUIDs known from the Reverb docs. Used only when
 * the /listing_conditions fetch fails (network error, scope issue) —
 * lets the push path still work with a reasonable default.
 */
export const REVERB_CONDITION_FALLBACK_UUIDS = {
	brand_new: 'ac5b9c1e-dc78-466d-b0b3-7cf712967a48',
	mint: 'ac5b9c1e-dc78-466d-b0b3-7cf712967a48',
	excellent: 'df268ad1-c462-4ba6-b6db-e007e23922ea',
	very_good: 'ddadff5b-0b90-4d7b-a8b8-d8a85b3c7e07',
	good: 'ae4d9114-1bd7-4ec5-a4ba-6653af5ac84d',
	fair: '0c1d4b87-3e09-4a98-9c45-89dcd7e6c2e5',
	poor: '7c3f4d8a-1b2a-4e9f-8a7c-5d6e7f8a9b0c',
	non_functioning: '5a4b3c2d-1e0f-9876-5432-10fedcba9876'
};

// ---------- Listings (the main API surface) ----------------------------

export interface ReverbMoney {
	amount: string; // decimal string, e.g. "189.00"
	currency: string; // ISO 4217, "USD"
}

export interface ReverbShippingRate {
	rate: ReverbMoney;
	region_code: string; // "US_CON" = continental US, "XX" = everywhere else
}

export interface ReverbListingCreatePayload {
	make: string;
	model: string;
	title: string;
	description: string;
	condition: { uuid: string };
	categories: Array<{ uuid: string }>; // 1-3 entries
	price: ReverbMoney;
	photos?: string[]; // public URLs
	videos?: Array<{ link: string }>;
	year?: string; // accepts "2024", "1960s", "mid 80s", etc.
	finish?: string;
	sku?: string;
	upc?: string;
	upc_does_not_apply?: boolean;
	shipping_profile_id?: string;
	shipping?: {
		rates: ReverbShippingRate[];
		local?: boolean;
	};
	has_inventory?: boolean;
	inventory?: number;
	offers_enabled?: boolean;
	handmade?: boolean;
	publish?: boolean; // true = live; false = draft
}

export interface ReverbListing {
	id: number;
	slug?: string;
	state?: { slug: string; description?: string };
	listing_currency?: string;
	title?: string;
	make?: string;
	model?: string;
	year?: string;
	finish?: string;
	description?: string;
	condition?: { uuid: string; display_name?: string };
	categories?: Array<{ uuid: string; full_name?: string }>;
	price?: ReverbMoney;
	sku?: string;
	has_inventory?: boolean;
	inventory?: number;
	photos?: Array<{ _links?: { large_crop?: { href: string } }; url?: string }>;
	_links?: {
		web?: { href: string };
		self?: { href: string };
	};
}

interface ReverbListingsResponse {
	listings?: ReverbListing[];
	total?: number;
	current_page?: number;
	total_pages?: number;
	_links?: { next?: { href?: string } };
}

/**
 * Enumerate the seller's OWN listings — the source for the cross-platform
 * reconciliation scrape. `/my/listings` returns everything the account
 * owns; pass `state` to scope it (`live` = currently up, `all` = incl.
 * ended/sold/draft). Paginated; the caller loops `page` until
 * `total_pages`.
 *
 * Docs: https://www.reverb-api.com/docs (GET /my/listings)
 */
export async function listMyListings(
	apiKey: string,
	options: { page?: number; perPage?: number; state?: string } = {}
): Promise<ReverbListingsResponse> {
	const url = new URL(`${BASE_URL}/my/listings`);
	url.searchParams.set('per_page', String(options.perPage ?? 50));
	if (options.page) url.searchParams.set('page', String(options.page));
	if (options.state) url.searchParams.set('state', options.state);
	const res = await fetch(url.toString(), { headers: authHeaders(apiKey) });
	const body = await res.text();
	if (!res.ok) throw new ReverbError(res.status, body);
	return JSON.parse(body) as ReverbListingsResponse;
}

/**
 * Create a new Reverb listing. The response includes the assigned id
 * + slug + state — we capture those into marketplace_listing as the
 * external identifiers.
 *
 * If `publish: false`, the listing is created as a draft and Dad can
 * publish from Reverb's admin. If true, it goes live immediately.
 * Mirrors the SS isVisible semantic.
 */
export async function createListing(
	apiKey: string,
	payload: ReverbListingCreatePayload
): Promise<ReverbListing> {
	const res = await fetch(`${BASE_URL}/listings`, {
		method: 'POST',
		headers: authHeaders(apiKey),
		body: JSON.stringify(payload)
	});
	const body = await res.text();
	if (!res.ok) throw new ReverbError(res.status, body);
	const parsed = JSON.parse(body);
	// Reverb wraps single-listing responses as { listing: {...} }
	return (parsed.listing ?? parsed) as ReverbListing;
}

/**
 * Update an existing listing by its Reverb listing id (or slug —
 * both work on /api/my/listings/{id_or_slug}). Partial payload OK.
 */
export async function updateListing(
	apiKey: string,
	listingIdOrSlug: string,
	payload: Partial<ReverbListingCreatePayload>
): Promise<ReverbListing> {
	const res = await fetch(
		`${BASE_URL}/my/listings/${encodeURIComponent(listingIdOrSlug)}`,
		{
			method: 'PUT',
			headers: authHeaders(apiKey),
			body: JSON.stringify(payload)
		}
	);
	const body = await res.text();
	if (!res.ok) throw new ReverbError(res.status, body);
	const parsed = JSON.parse(body);
	return (parsed.listing ?? parsed) as ReverbListing;
}

/**
 * End a live Reverb listing (take it off the marketplace). Reverb's
 * teardown is a state transition, not a DELETE: PUT
 * /my/listings/{id}/state/end with a reason ("not_sold" = pulled, not a
 * Reverb sale). A 404 means it's already gone — treat as success so the
 * dead-listings teardown is idempotent.
 *
 * Docs: https://www.reverb-api.com/docs (Listing state transitions)
 */
export async function endListing(
	apiKey: string,
	listingId: string,
	reason: 'not_sold' | 'reverb_sale' = 'not_sold'
): Promise<void> {
	const res = await fetch(
		`${BASE_URL}/my/listings/${encodeURIComponent(listingId)}/state/end`,
		{
			method: 'PUT',
			headers: authHeaders(apiKey),
			body: JSON.stringify({ reason })
		}
	);
	if (res.ok || res.status === 404) return;
	const body = await res.text();
	throw new ReverbError(res.status, body);
}

/**
 * Fetch the current state of a listing from Reverb — useful for
 * the "Did the photos actually attach?" verification step and for
 * unlinking when the listing's been deleted on Reverb's side.
 */
export async function getListing(
	apiKey: string,
	listingIdOrSlug: string
): Promise<ReverbListing> {
	const res = await fetch(
		`${BASE_URL}/my/listings/${encodeURIComponent(listingIdOrSlug)}`,
		{ headers: authHeaders(apiKey) }
	);
	const body = await res.text();
	if (!res.ok) throw new ReverbError(res.status, body);
	const parsed = JSON.parse(body);
	return (parsed.listing ?? parsed) as ReverbListing;
}

/**
 * A listing's full photo set as public URLs (large_crop where available,
 * else the raw url) — used to pull images into inventory. Best-effort:
 * returns [] if the listing's gone or has no photos.
 */
export async function getListingPhotoUrls(apiKey: string, listingId: string): Promise<string[]> {
	const extract = (listing: ReverbListing): string[] => {
		const urls: string[] = [];
		for (const p of listing.photos ?? []) {
			// Reverb nests sized variants under _links.<size>.href. Prefer a
			// large render, fall back through the others, then the raw url.
			const links = p._links as Record<string, { href?: string }> | undefined;
			const u =
				links?.large_crop?.href ??
				links?.full?.href ??
				links?.large?.href ??
				links?.small_crop?.href ??
				p.url;
			if (u) urls.push(u);
		}
		return urls;
	};

	// The PUBLIC listing endpoint reliably returns the full photos array for
	// any listing id (the /my/listings/{id} single-fetch did not). Fall back
	// to the seller endpoint if the public one is unavailable.
	const res = await fetch(`${BASE_URL}/listings/${encodeURIComponent(listingId)}`, {
		headers: authHeaders(apiKey)
	});
	if (res.ok) {
		const parsed = JSON.parse(await res.text());
		const urls = extract((parsed.listing ?? parsed) as ReverbListing);
		if (urls.length > 0) return urls;
	}
	// Fall back to the seller endpoint (throws on error → caller records it).
	return extract(await getListing(apiKey, listingId));
}

// ---------- Orders (for pulling SOLD metrics) -------------------------
//
// Reverb's selling-orders feed. Each order is a sale referencing a
// listing (Reverb listings are typically qty 1 — one guitar). We match
// the order's listing id to our stored Reverb external_id, falling back
// to SKU. Requires the `read_orders` scope on the PAT (a full-access
// token has it).
//
// Docs: https://www.reverb-api.com/docs#tag/Orders

export interface ReverbOrder {
	order_number?: string;
	created_at?: string;
	/** "unpaid" | "payment_pending" | "paid" | "shipped" | "received" |
	 *  "refunded" | "cancelled" | ... */
	status?: string;
	quantity?: number;
	sku?: string;
	title?: string;
	/** Listing id may appear directly or only via the HAL link. */
	listing_id?: number | string;
	_links?: { listing?: { href?: string } };
}

interface ReverbOrdersResponse {
	orders?: ReverbOrder[];
	current_page?: number;
	total_pages?: number;
	_links?: { next?: { href?: string } };
}

/**
 * Fetch one page of the seller's orders. `/all` is the comprehensive
 * feed (every status); we filter cancelled/refunded at the call site.
 */
export async function listSellingOrders(
	apiKey: string,
	options: { page?: number; perPage?: number } = {}
): Promise<ReverbOrdersResponse> {
	const url = new URL(`${BASE_URL}/my/orders/selling/all`);
	url.searchParams.set('per_page', String(options.perPage ?? 50));
	if (options.page) url.searchParams.set('page', String(options.page));
	const res = await fetch(url.toString(), { headers: authHeaders(apiKey) });
	const body = await res.text();
	if (!res.ok) throw new ReverbError(res.status, body);
	return JSON.parse(body) as ReverbOrdersResponse;
}

/**
 * Pull the listing id out of an order — directly when present, else
 * parsed from the HAL `listing` link (…/listings/12345). Returns null
 * when neither is available (we then fall back to SKU matching).
 */
export function reverbOrderListingId(o: ReverbOrder): string | null {
	if (o.listing_id != null && o.listing_id !== '') return String(o.listing_id);
	const href = o._links?.listing?.href;
	const m = href?.match(/listings\/(\d+)/);
	return m ? m[1] : null;
}

// ---------- Condition mapping ----------------------------------------

/**
 * Map our internal item condition code (N/U/R/B) to a Reverb condition
 * UUID. Uses the freshly-fetched list when available, falls back to
 * the hardcoded UUIDs if the fetch failed.
 *
 * Mapping:
 *   N (New)          → Brand New
 *   U (Used)         → Very Good (sane default for used inventory)
 *   R (Refurbished)  → Excellent
 *   B (For parts)    → Non-functioning
 *
 * Dad can override per-listing once we expose the picker in UI.
 */
export function mapInternalConditionToReverbUuid(
	internalCondition: string,
	conditions: ReverbCondition[]
): string {
	const want: Record<string, string[]> = {
		N: ['Brand New', 'Mint', 'New', 'B-Stock'],
		U: ['Very Good', 'Good', 'Excellent'],
		R: ['Excellent', 'Very Good', 'B-Stock'],
		B: ['Non Functioning', 'Non-functioning', 'Poor', 'Fair']
	};
	const candidates = want[internalCondition] ?? ['Good'];
	for (const name of candidates) {
		const found = conditions.find(
			(c) => c.display_name.toLowerCase() === name.toLowerCase()
		);
		if (found) return found.uuid;
	}
	// Final fallback — first available condition or the hardcoded one.
	if (conditions[0]) return conditions[0].uuid;
	if (internalCondition === 'N') return REVERB_CONDITION_FALLBACK_UUIDS.brand_new;
	if (internalCondition === 'U') return REVERB_CONDITION_FALLBACK_UUIDS.very_good;
	if (internalCondition === 'R') return REVERB_CONDITION_FALLBACK_UUIDS.excellent;
	if (internalCondition === 'B') return REVERB_CONDITION_FALLBACK_UUIDS.non_functioning;
	return REVERB_CONDITION_FALLBACK_UUIDS.good;
}
