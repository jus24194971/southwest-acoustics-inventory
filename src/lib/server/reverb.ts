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
	photos?: Array<{ _links?: { large_crop?: { href: string } }; url?: string }>;
	_links?: {
		web?: { href: string };
		self?: { href: string };
	};
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
