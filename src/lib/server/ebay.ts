/**
 * eBay client — Inventory API (REST/OAuth).
 *
 * Modern eBay listing flow uses three calls per publish:
 *
 *   1. PUT  /sell/inventory/v1/inventory_item/{sku}   — describe the SKU
 *   2. POST /sell/inventory/v1/offer                  — price + listing format
 *   3. POST /sell/inventory/v1/offer/{offerId}/publish — go live
 *
 * SKU is keyed by string (our local SKU). No separate eBay item ID mapping needed.
 *
 * # Auth — two-tier
 *
 * - **App token** (`client_credentials` grant from EBAY_CLIENT_ID +
 *   EBAY_CLIENT_SECRET). Read-only, used for taxonomy lookups. Lives
 *   in-memory only, refreshed every ~2hr.
 *
 * - **User token** (`refresh_token` grant from EBAY_REFRESH_TOKEN, which
 *   is itself created via the authorization_code flow once per seller
 *   account). Used for all inventory/offer/publish calls. Access tokens
 *   are short-lived (~2hr); the refresh token lasts 18 months. We cache
 *   access tokens in-memory and refresh proactively with a 60s buffer.
 *
 * # Environment
 *
 * - Set EBAY_API_BASE to either `https://api.ebay.com` (prod) or
 *   `https://api.sandbox.ebay.com` (sandbox). Defaults to prod.
 *   The auth host follows the same pattern (`https://api.ebay.com/identity/v1/oauth2/token`).
 *
 * # Photos
 *
 * - eBay's inventory_item accepts `product.imageUrls[]` (public URLs).
 *   Mirrors the Reverb pattern — we pull SS CDN URLs from the
 *   already-pushed Squarespace listing as the photo source.
 * - eBay has a separate EPS (eBay Picture Services) upload endpoint for
 *   binary uploads, but it's a different surface; we stick with URLs
 *   for now since SS push is the prereq anyway.
 */

const DEFAULT_BASE = 'https://api.ebay.com';

/** Resolves the eBay API base URL from env, defaulting to prod. */
function getBase(env: { EBAY_API_BASE?: string }): string {
	return env.EBAY_API_BASE ?? DEFAULT_BASE;
}

// =====================================================================
// Errors
// =====================================================================

export class EbayError extends Error {
	constructor(
		public readonly httpStatus: number,
		public readonly body: string,
		message?: string
	) {
		super(message ?? `eBay API returned ${httpStatus}`);
	}
}

// =====================================================================
// Auth — token cache + refresh
// =====================================================================

/**
 * In-memory cache for both token types. Each Workers invocation
 * gets a fresh module instance so the cache resets on cold starts —
 * acceptable since the refresh call is cheap and we typically batch
 * many calls per request.
 */
const tokenCache: {
	app?: { token: string; expiresAt: number };
	user?: { token: string; expiresAt: number };
} = {};

/** Strip 60s off advertised expiry so we refresh proactively. */
const EXPIRY_SAFETY_BUFFER_MS = 60_000;

export interface EbayEnvCreds {
	EBAY_CLIENT_ID?: string;
	EBAY_CLIENT_SECRET?: string;
	EBAY_REFRESH_TOKEN?: string;
	EBAY_API_BASE?: string;
	/** RuName — eBay's redirect identifier, used as redirect_uri in
	 *  both the consent URL and the auth-code token exchange. */
	EBAY_RU_NAME?: string;
}

/**
 * The user-consent host is DIFFERENT from the API host. Authorization
 * happens on auth.ebay.com (prod) / auth.sandbox.ebay.com (sandbox);
 * token exchange + all REST calls happen on api(.sandbox).ebay.com.
 * Derive the consent host from whichever API base is configured.
 */
function getConsentBase(env: EbayEnvCreds): string {
	const base = getBase(env);
	return base.includes('sandbox')
		? 'https://auth.sandbox.ebay.com'
		: 'https://auth.ebay.com';
}

/**
 * Encode client_id:client_secret as Basic auth. eBay's token endpoint
 * expects this in the Authorization header.
 */
function basicAuth(clientId: string, clientSecret: string): string {
	const raw = `${clientId}:${clientSecret}`;
	// btoa works in Workers; same encoding as Buffer.from(raw).toString('base64').
	return 'Basic ' + btoa(raw);
}

function tokenEndpoint(env: EbayEnvCreds): string {
	return `${getBase(env)}/identity/v1/oauth2/token`;
}

/**
 * Default scopes for the seller account. Adjust if you need
 * additional permissions (sell.marketing, sell.finances, etc.).
 * Scopes must be granted when the refresh token was minted —
 * adding a new scope here without re-consenting fails.
 */
const DEFAULT_USER_SCOPES = [
	'https://api.ebay.com/oauth/api_scope/sell.inventory',
	'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
	// Read orders (Fulfillment API) for the sold-metrics sync. Added
	// after the initial connect — the existing token doesn't carry it,
	// so it needs a one-time Re-authorize from Settings → eBay.
	'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly'
];

/**
 * Get an **app token** (read-only, suitable for taxonomy and other
 * non-user endpoints). Uses the `client_credentials` grant.
 */
export async function getAppToken(env: EbayEnvCreds): Promise<string> {
	if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
		throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not configured.');
	}

	const cached = tokenCache.app;
	if (cached && cached.expiresAt > Date.now()) return cached.token;

	const params = new URLSearchParams();
	params.set('grant_type', 'client_credentials');
	// App tokens use a single, generic scope.
	params.set('scope', 'https://api.ebay.com/oauth/api_scope');

	const res = await fetch(tokenEndpoint(env), {
		method: 'POST',
		headers: {
			Authorization: basicAuth(env.EBAY_CLIENT_ID, env.EBAY_CLIENT_SECRET),
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: params.toString()
	});
	const body = await res.text();
	if (!res.ok) throw new EbayError(res.status, body, `App token refresh failed (${res.status})`);
	const parsed = JSON.parse(body) as { access_token: string; expires_in: number };
	tokenCache.app = {
		token: parsed.access_token,
		expiresAt: Date.now() + parsed.expires_in * 1000 - EXPIRY_SAFETY_BUFFER_MS
	};
	return parsed.access_token;
}

/**
 * Get a **user token** for the seller account. Uses the
 * `refresh_token` grant. The refresh token itself is created
 * out-of-band via the eBay OAuth consent flow (see EBAY_SETUP.md
 * once we write it).
 */
export async function getUserToken(env: EbayEnvCreds): Promise<string> {
	if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET || !env.EBAY_REFRESH_TOKEN) {
		throw new Error(
			'eBay user token not configured. Need EBAY_CLIENT_ID + EBAY_CLIENT_SECRET + EBAY_REFRESH_TOKEN.'
		);
	}

	const cached = tokenCache.user;
	if (cached && cached.expiresAt > Date.now()) return cached.token;

	const params = new URLSearchParams();
	params.set('grant_type', 'refresh_token');
	params.set('refresh_token', env.EBAY_REFRESH_TOKEN);
	// Scope must be a subset of what the refresh token was minted with.
	params.set('scope', DEFAULT_USER_SCOPES.join(' '));

	const res = await fetch(tokenEndpoint(env), {
		method: 'POST',
		headers: {
			Authorization: basicAuth(env.EBAY_CLIENT_ID, env.EBAY_CLIENT_SECRET),
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: params.toString()
	});
	const body = await res.text();
	if (!res.ok) {
		throw new EbayError(
			res.status,
			body,
			`User token refresh failed (${res.status}) — refresh token may be expired or scopes mismatch.`
		);
	}
	const parsed = JSON.parse(body) as { access_token: string; expires_in: number };
	tokenCache.user = {
		token: parsed.access_token,
		expiresAt: Date.now() + parsed.expires_in * 1000 - EXPIRY_SAFETY_BUFFER_MS
	};
	return parsed.access_token;
}

// =====================================================================
// OAuth user-consent flow (authorization_code grant)
// =====================================================================
//
// One-time per seller account: Dad clicks "Connect eBay", we send him
// to eBay's consent screen, he approves, eBay redirects his browser
// back to our callback with a `code`. We exchange that code for an
// access token + an 18-month refresh token, and store the refresh
// token in D1 (a Pages secret can't be written at runtime).

/**
 * Build the eBay consent URL. `state` is an opaque value echoed back
 * to the callback (we use it as a lightweight CSRF guard). Scopes are
 * the same DEFAULT_USER_SCOPES we later request the access token with.
 */
export function buildConsentUrl(env: EbayEnvCreds, state: string): string {
	if (!env.EBAY_CLIENT_ID || !env.EBAY_RU_NAME) {
		throw new Error('eBay consent URL needs EBAY_CLIENT_ID and EBAY_RU_NAME.');
	}
	const url = new URL(`${getConsentBase(env)}/oauth2/authorize`);
	url.searchParams.set('client_id', env.EBAY_CLIENT_ID);
	// redirect_uri is the RuName string, NOT a literal URL — eBay maps
	// it to the registered callback on their side.
	url.searchParams.set('redirect_uri', env.EBAY_RU_NAME);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', DEFAULT_USER_SCOPES.join(' '));
	url.searchParams.set('state', state);
	// NOTE: we intentionally do NOT set prompt=login. If Dad's eBay
	// session is already active in the browser, eBay shows just the
	// "approve these permissions" screen (no password re-entry) — which
	// makes the re-authorize-for-new-scope flow painless. The trade-off
	// is you must ensure the correct eBay account is the one signed in
	// when you click Connect/Re-authorize.
	return url.toString();
}

export interface EbayTokenExchangeResult {
	access_token: string;
	expires_in: number;
	refresh_token: string;
	refresh_token_expires_in: number;
}

/**
 * Exchange an authorization code (from the callback) for tokens.
 * redirect_uri must be the SAME RuName used in the consent URL.
 */
export async function exchangeCodeForTokens(
	env: EbayEnvCreds,
	code: string
): Promise<EbayTokenExchangeResult> {
	if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET || !env.EBAY_RU_NAME) {
		throw new Error('Token exchange needs EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME.');
	}
	const params = new URLSearchParams();
	params.set('grant_type', 'authorization_code');
	params.set('code', code);
	params.set('redirect_uri', env.EBAY_RU_NAME);

	const res = await fetch(tokenEndpoint(env), {
		method: 'POST',
		headers: {
			Authorization: basicAuth(env.EBAY_CLIENT_ID, env.EBAY_CLIENT_SECRET),
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: params.toString()
	});
	const body = await res.text();
	if (!res.ok) throw new EbayError(res.status, body, `Code exchange failed (${res.status})`);
	return JSON.parse(body) as EbayTokenExchangeResult;
}

/**
 * Look up the connected eBay account's username — handy for the
 * Settings card to show WHICH account is linked. Uses the user token.
 * Best-effort; returns null on any failure.
 */
export async function getAccountUsername(env: EbayEnvCreds): Promise<string | null> {
	try {
		const token = await getUserToken(env);
		// The Identity API's get-user endpoint lives on apiz.ebay.com.
		const host = getBase(env).includes('sandbox')
			? 'https://apiz.sandbox.ebay.com'
			: 'https://apiz.ebay.com';
		const res = await fetch(`${host}/commerce/identity/v1/user`, {
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { username?: string };
		return data.username ?? null;
	} catch {
		return null;
	}
}

// =====================================================================
// Taxonomy — categories + item aspects
// =====================================================================

export interface EbayCategorySuggestion {
	categoryId: string;
	categoryName: string;
	categoryTreeNodeAncestors?: Array<{ categoryId: string; categoryName: string }>;
}

/**
 * Fetch eBay's category-suggestion list for a free-text query.
 * Uses the US default tree (tree_id=0); the seller account is
 * US-based per the Listing Studio configuration. If we ever sell
 * internationally we'd need to pick the right tree via
 * `GET /commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=...`.
 *
 * App token is sufficient — this is a read-only endpoint.
 */
export async function suggestCategory(
	env: EbayEnvCreds,
	query: string
): Promise<EbayCategorySuggestion[]> {
	if (!query.trim()) return [];
	const token = await getAppToken(env);
	const url = new URL(
		`${getBase(env)}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions`
	);
	url.searchParams.set('q', query);

	const res = await fetch(url.toString(), {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	const body = await res.text();
	if (!res.ok) throw new EbayError(res.status, body);
	const parsed = JSON.parse(body) as {
		categorySuggestions?: Array<{
			category: EbayCategorySuggestion;
		}>;
	};
	return (parsed.categorySuggestions ?? []).map((s) => s.category);
}

// =====================================================================
// Item aspects (required + recommended "item specifics" per category)
// =====================================================================
//
// This is THE thing that makes eBay reject listings: every category
// has aspects flagged REQUIRED, and a publish 400s if any are missing
// (or, for SELECTION_ONLY aspects, if the value isn't in eBay's
// allowed list). We fetch the per-category aspect metadata here and
// map our item data onto it in ebay_aspect_mapper.ts.
//
// Endpoint (app token sufficient — read-only):
//   GET /commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id={id}

import type { EbayAspectMeta } from './ebay_aspect_mapper';

/** Raw shape of one aspect in the Taxonomy API response. */
interface RawAspect {
	localizedAspectName: string;
	aspectConstraint?: {
		aspectDataType?: string;
		itemToAspectCardinality?: string;
		aspectMode?: string;
		aspectRequired?: boolean;
		aspectUsage?: string;
	};
	aspectValues?: Array<{ localizedValue?: string }>;
}

/**
 * Fetch the required + recommended aspects for an eBay category,
 * normalized into the flat EbayAspectMeta shape the mapper consumes.
 * US default tree (tree_id=0), matching suggestCategory().
 */
export async function getItemAspectsForCategory(
	env: EbayEnvCreds,
	categoryId: string
): Promise<EbayAspectMeta[]> {
	if (!categoryId.trim()) return [];
	const token = await getAppToken(env);
	const url = new URL(
		`${getBase(env)}/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category`
	);
	url.searchParams.set('category_id', categoryId);

	const res = await fetch(url.toString(), {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	const body = await res.text();
	if (!res.ok) throw new EbayError(res.status, body);
	const parsed = JSON.parse(body) as { aspects?: RawAspect[] };

	return (parsed.aspects ?? []).map((a): EbayAspectMeta => {
		const c = a.aspectConstraint ?? {};
		const mode = c.aspectMode === 'SELECTION_ONLY' ? 'SELECTION_ONLY' : 'FREE_TEXT';
		return {
			name: a.localizedAspectName,
			required: c.aspectRequired === true,
			usage: c.aspectUsage ?? (c.aspectRequired ? 'REQUIRED' : 'OPTIONAL'),
			mode,
			cardinality: c.itemToAspectCardinality === 'MULTI' ? 'MULTI' : 'SINGLE',
			dataType: c.aspectDataType ?? 'STRING',
			// Only carry allowed values for SELECTION_ONLY — FREE_TEXT
			// "values" are just suggestions and would bloat the payload.
			allowedValues:
				mode === 'SELECTION_ONLY'
					? (a.aspectValues ?? [])
							.map((v) => v.localizedValue ?? '')
							.filter((v) => v.length > 0)
					: []
		};
	});
}

// =====================================================================
// Inventory item — create/replace
// =====================================================================

/**
 * The shape of `PUT /sell/inventory/v1/inventory_item/{sku}` body.
 * Fields are flat; aspects are key/value where each value is an
 * array of strings (yes, even single values are wrapped).
 *
 * `condition` is an enum: NEW, NEW_OTHER, NEW_WITH_DEFECTS,
 * USED_EXCELLENT, USED_VERY_GOOD, USED_GOOD, USED_ACCEPTABLE,
 * FOR_PARTS_OR_NOT_WORKING. Map our internal codes (N/U/R/B) at the
 * caller.
 *
 * `product.imageUrls[]` must be public (no auth). SS CDN URLs work;
 * R2-via-Access doesn't.
 */
export interface EbayInventoryItemPayload {
	availability: {
		shipToLocationAvailability: {
			quantity: number;
		};
	};
	condition:
		| 'NEW'
		| 'NEW_OTHER'
		| 'NEW_WITH_DEFECTS'
		| 'USED_EXCELLENT'
		| 'USED_VERY_GOOD'
		| 'USED_GOOD'
		| 'USED_ACCEPTABLE'
		| 'FOR_PARTS_OR_NOT_WORKING';
	conditionDescription?: string;
	product: {
		title: string;
		description?: string;
		aspects?: Record<string, string[]>;
		brand?: string;
		mpn?: string; // manufacturer part number
		upc?: string[];
		ean?: string[];
		imageUrls?: string[];
	};
}

/** Create-or-replace one inventory item. Returns void on 204. */
export async function createOrReplaceInventoryItem(
	env: EbayEnvCreds,
	sku: string,
	payload: EbayInventoryItemPayload
): Promise<void> {
	const token = await getUserToken(env);
	const res = await fetch(
		`${getBase(env)}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
		{
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${token}`,
				'content-type': 'application/json',
				'content-language': 'en-US',
				Accept: 'application/json'
			},
			body: JSON.stringify(payload)
		}
	);
	if (!res.ok) {
		const body = await res.text();
		throw new EbayError(res.status, body);
	}
}

/**
 * Map our internal condition code to eBay's enum. Conservative on
 * the Used path — used guitar parts often warrant "USED_GOOD" rather
 * than "USED_EXCELLENT" without inspection. Dad can override per
 * listing in the editor.
 */
export function mapInternalConditionToEbay(
	code: string
): EbayInventoryItemPayload['condition'] {
	switch (code) {
		case 'N':
			return 'NEW';
		case 'U':
			return 'USED_GOOD';
		case 'R':
			return 'USED_EXCELLENT'; // refurbished → "looks great" tier
		case 'B':
			return 'FOR_PARTS_OR_NOT_WORKING';
		default:
			return 'USED_GOOD';
	}
}

// =====================================================================
// Offer — create + publish
// =====================================================================

export interface EbayOfferPayload {
	sku: string;
	marketplaceId: 'EBAY_US' | 'EBAY_GB' | 'EBAY_DE' | string;
	format: 'FIXED_PRICE' | 'AUCTION';
	availableQuantity: number;
	categoryId: string;
	listingDescription: string;
	listingPolicies: {
		fulfillmentPolicyId: string;
		paymentPolicyId: string;
		returnPolicyId: string;
	};
	pricingSummary: {
		price: { value: string; currency: 'USD' | string };
	};
	merchantLocationKey: string;
}

/**
 * Create an offer for an existing inventory item. Returns the offer ID
 * (needed for publish).
 */
export async function createOffer(
	env: EbayEnvCreds,
	payload: EbayOfferPayload
): Promise<{ offerId: string }> {
	const token = await getUserToken(env);
	const res = await fetch(`${getBase(env)}/sell/inventory/v1/offer`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'content-type': 'application/json',
			'content-language': 'en-US',
			Accept: 'application/json'
		},
		body: JSON.stringify(payload)
	});
	const body = await res.text();
	if (!res.ok) throw new EbayError(res.status, body);
	return JSON.parse(body) as { offerId: string };
}

export interface EbayExistingOffer {
	offerId: string;
	marketplaceId: string;
	status?: string;
	/** Present once published. */
	listingId?: string;
}

/**
 * Look up existing offers for a SKU. eBay allows exactly one offer per
 * (sku, marketplace, format), so a re-push must UPDATE the existing
 * offer rather than create a duplicate (which 400s with errorId 25002
 * "Offer entity already exists"). Returns [] when none exist.
 */
export async function getOffersBySku(
	env: EbayEnvCreds,
	sku: string
): Promise<EbayExistingOffer[]> {
	const token = await getUserToken(env);
	const url = `${getBase(env)}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`;
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	// 404 = no offers for this SKU yet — a normal "first push" state.
	if (res.status === 404) return [];
	const body = await res.text();
	if (!res.ok) throw new EbayError(res.status, body);
	const parsed = JSON.parse(body) as {
		offers?: Array<{
			offerId: string;
			marketplaceId: string;
			status?: string;
			listing?: { listingId?: string };
		}>;
	};
	return (parsed.offers ?? []).map((o) => ({
		offerId: o.offerId,
		marketplaceId: o.marketplaceId,
		status: o.status,
		listingId: o.listing?.listingId
	}));
}

/**
 * Update an existing offer. eBay's PUT body is the offer WITHOUT the
 * immutable create-time fields (sku, marketplaceId, format) — those are
 * fixed once the offer exists. Sending them can 400, so the caller
 * passes the mutable subset.
 */
export async function updateOffer(
	env: EbayEnvCreds,
	offerId: string,
	payload: Omit<EbayOfferPayload, 'sku' | 'marketplaceId' | 'format'>
): Promise<void> {
	const token = await getUserToken(env);
	const res = await fetch(
		`${getBase(env)}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
		{
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${token}`,
				'content-type': 'application/json',
				'content-language': 'en-US',
				Accept: 'application/json'
			},
			body: JSON.stringify(payload)
		}
	);
	if (res.ok || res.status === 204) return;
	const body = await res.text();
	throw new EbayError(res.status, body);
}

/**
 * Publish an offer (transitions from draft to live listing).
 * Returns the listingId once active.
 */
export async function publishOffer(
	env: EbayEnvCreds,
	offerId: string
): Promise<{ listingId: string }> {
	const token = await getUserToken(env);
	const res = await fetch(
		`${getBase(env)}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'content-type': 'application/json',
				Accept: 'application/json'
			}
		}
	);
	const body = await res.text();
	if (!res.ok) throw new EbayError(res.status, body);
	return JSON.parse(body) as { listingId: string };
}

// =====================================================================
// Seller policies — needed for offer creation
// =====================================================================
//
// Every offer references three policy IDs: fulfillment (shipping),
// payment, and return. These are configured once in eBay Seller Hub
// and reused. The Account API exposes them so we can populate a
// dropdown in the editor rather than asking Dad to copy IDs around.

export interface EbayPolicy {
	id: string;
	name: string;
	description?: string;
}

/**
 * Fetch the seller's policies of a given kind. `kind` is one of
 * 'fulfillment_policy' | 'payment_policy' | 'return_policy'.
 * Requires sell.account.readonly scope (already in DEFAULT_USER_SCOPES).
 */
export async function listSellerPolicies(
	env: EbayEnvCreds,
	kind: 'fulfillment_policy' | 'payment_policy' | 'return_policy'
): Promise<EbayPolicy[]> {
	const token = await getUserToken(env);
	const url = `${getBase(env)}/sell/account/v1/${kind}?marketplace_id=EBAY_US`;
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	const body = await res.text();
	if (!res.ok) throw new EbayError(res.status, body);
	const parsed = JSON.parse(body) as Record<string, unknown>;
	// Each policy kind returns its array under a different key.
	const key = kind === 'fulfillment_policy'
		? 'fulfillmentPolicies'
		: kind === 'payment_policy'
			? 'paymentPolicies'
			: 'returnPolicies';
	const idKey = kind === 'fulfillment_policy'
		? 'fulfillmentPolicyId'
		: kind === 'payment_policy'
			? 'paymentPolicyId'
			: 'returnPolicyId';
	const arr = (parsed[key] ?? []) as Array<Record<string, unknown>>;
	return arr.map((p) => ({
		id: String(p[idKey]),
		name: String(p.name),
		description: typeof p.description === 'string' ? p.description : undefined
	}));
}

// =====================================================================
// Orders (Fulfillment API) — for pulling SOLD metrics
// =====================================================================
//
// Requires the sell.fulfillment(.readonly) scope. Line items carry SKU
// + quantity + legacyItemId (the listing id), so we match by SKU first
// (our eBay SKUs are current) then legacyItemId → stored listingId.
//
// Docs: https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders

export interface EbayOrderLineItem {
	lineItemId: string;
	legacyItemId?: string;
	sku?: string;
	quantity: number;
}

export interface EbayOrder {
	orderId: string;
	creationDate?: string;
	orderFulfillmentStatus?: string;
	cancelStatus?: { cancelState?: string };
	lineItems?: EbayOrderLineItem[];
}

interface EbayOrdersResponse {
	orders?: EbayOrder[];
	total?: number;
	limit?: number;
	offset?: number;
	next?: string;
}

/**
 * Fetch a page of orders. `creationDateFrom`/`To` are ISO timestamps;
 * we build eBay's `filter=creationdate:[from..to]` range. Paginate via
 * `offset`. Uses the user token (needs sell.fulfillment scope — a 403
 * here means the token predates the scope and needs a Re-authorize).
 */
export async function getOrders(
	env: EbayEnvCreds,
	options: {
		creationDateFrom?: string;
		creationDateTo?: string;
		offset?: number;
		limit?: number;
	} = {}
): Promise<EbayOrdersResponse> {
	const token = await getUserToken(env);
	const url = new URL(`${getBase(env)}/sell/fulfillment/v1/order`);
	if (options.creationDateFrom && options.creationDateTo) {
		url.searchParams.set(
			'filter',
			`creationdate:[${options.creationDateFrom}..${options.creationDateTo}]`
		);
	}
	url.searchParams.set('limit', String(options.limit ?? 200));
	if (options.offset) url.searchParams.set('offset', String(options.offset));

	const res = await fetch(url.toString(), {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	const body = await res.text();
	if (!res.ok) throw new EbayError(res.status, body);
	return JSON.parse(body) as EbayOrdersResponse;
}

// =====================================================================
// Inventory location — required on every offer (merchantLocationKey)
// =====================================================================
//
// eBay's Inventory API requires at least one inventory location, and
// every offer references one by key. There's no Seller Hub UI for the
// raw key — it's created via this API and the key is any slug we pick.

export interface EbayLocationAddress {
	addressLine1?: string;
	city?: string;
	stateOrProvince?: string;
	postalCode: string;
	country: string; // ISO 3166 alpha-2, e.g. "US"
}

/**
 * Create (or replace) an inventory location under `key`. Idempotent —
 * a 204 means created, a 409 "already exists" we treat as success
 * (the caller just wants the key to exist). Returns void.
 */
export async function createInventoryLocation(
	env: EbayEnvCreds,
	key: string,
	name: string,
	address: EbayLocationAddress
): Promise<void> {
	const token = await getUserToken(env);
	const res = await fetch(
		`${getBase(env)}/sell/inventory/v1/location/${encodeURIComponent(key)}`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'content-type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify({
				location: { address },
				name,
				locationTypes: ['WAREHOUSE'],
				merchantLocationStatus: 'ENABLED'
			})
		}
	);
	if (res.ok || res.status === 204) return;
	const body = await res.text();
	// An already-existing location is fine for our "ensure it exists" intent.
	if (res.status === 409 && body.includes('already exists')) return;
	throw new EbayError(res.status, body);
}

// =====================================================================
// Seller listing enumeration (Browse API) — for reconciliation scrape
// =====================================================================
//
// We can't enumerate Dad's web-created ("classic") listings through the
// Inventory API — it only sees offers created by THIS app. The Browse
// API, however, sees every LIVE listing a seller has, so we use it
// (read-only, app token, no user consent) to pull his catalog for the
// onboarding reconcile flow.
//
// Caveats baked into the design:
//   - Browse requires a category or query alongside the seller filter,
//     so we scope to "Musical Instruments & Gear" (cat 619). Fine for a
//     guitar-parts seller; listings outside that tree won't show.
//   - Browse is buyer-facing → LIVE listings only (no drafts/ended) and
//     no available-quantity (Dad enters qty during review).
//   - The RESTful itemId is "v1|<legacyId>|<var>"; we parse the legacy
//     item id out as the stable reference we store.
//   - These are classic listings: we can SHOW + match + reference them,
//     but two-way stock/price sync (offer-based) doesn't drive them.

export interface EbaySellerListing {
	legacyItemId: string; // parsed from the RESTful itemId
	restItemId: string;
	title: string;
	priceValue: string | null;
	priceCurrency: string | null;
	imageUrl: string | null;
	url: string | null;
}

interface BrowseSearchResponse {
	itemSummaries?: Array<{
		itemId: string;
		title?: string;
		price?: { value?: string; currency?: string };
		image?: { imageUrl?: string };
		thumbnailImages?: Array<{ imageUrl?: string }>;
		itemWebUrl?: string;
	}>;
	total?: number;
	next?: string;
	offset?: number;
	limit?: number;
}

/**
 * Enumerate a seller's ACTIVE eBay listings via the Browse API. Returns
 * one normalized page; the caller paginates with `offset` until it has
 * `total`. `username` comes from getAccountUsername().
 */
export async function searchSellerListings(
	env: EbayEnvCreds,
	username: string,
	options: { offset?: number; limit?: number; categoryId?: string } = {}
): Promise<{ items: EbaySellerListing[]; total: number }> {
	const token = await getAppToken(env);
	const url = new URL(`${getBase(env)}/buy/browse/v1/item_summary/search`);
	// eBay's seller filter syntax is `sellers:{name1|name2}` — the braces
	// are literal. Pair it with a broad category so Browse accepts the
	// request (it rejects a bare seller filter with no q/category).
	url.searchParams.set('filter', `sellers:{${username}}`);
	url.searchParams.set('category_ids', options.categoryId ?? '619');
	url.searchParams.set('limit', String(options.limit ?? 200));
	if (options.offset) url.searchParams.set('offset', String(options.offset));

	const res = await fetch(url.toString(), {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json',
			'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
		}
	});
	const body = await res.text();
	if (!res.ok) throw new EbayError(res.status, body);
	const parsed = JSON.parse(body) as BrowseSearchResponse;
	const items = (parsed.itemSummaries ?? []).map((s): EbaySellerListing => {
		const parts = (s.itemId ?? '').split('|');
		const legacyItemId = parts.length >= 2 ? parts[1] : (s.itemId ?? '');
		return {
			legacyItemId,
			restItemId: s.itemId ?? '',
			title: s.title ?? '(untitled)',
			priceValue: s.price?.value ?? null,
			priceCurrency: s.price?.currency ?? null,
			imageUrl: s.image?.imageUrl ?? s.thumbnailImages?.[0]?.imageUrl ?? null,
			url: s.itemWebUrl ?? null
		};
	});
	return { items, total: parsed.total ?? items.length };
}

/**
 * Pull a listing's full image set from eBay's Browse API by its LEGACY item
 * id (the numeric id we store as external_variant_id for adopted classic
 * listings). App token, read-only. Returns the main image + additionalImages
 * as public i.ebayimg.com URLs (fetchable without auth). Best-effort: returns
 * [] on any failure (token unavailable, listing ended, etc.).
 */
export async function getItemImageUrls(env: EbayEnvCreds, legacyItemId: string): Promise<string[]> {
	try {
		const token = await getAppToken(env);
		const url = new URL(`${getBase(env)}/buy/browse/v1/item/get_item_by_legacy_id`);
		url.searchParams.set('legacy_item_id', legacyItemId);
		const res = await fetch(url.toString(), {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/json',
				'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
			}
		});
		if (!res.ok) return [];
		const j = (await res.json()) as {
			image?: { imageUrl?: string };
			additionalImages?: Array<{ imageUrl?: string }>;
		};
		const urls: string[] = [];
		if (j.image?.imageUrl) urls.push(j.image.imageUrl);
		for (const a of j.additionalImages ?? []) if (a.imageUrl) urls.push(a.imageUrl);
		return urls;
	} catch {
		return [];
	}
}

// =====================================================================
// Connection check
// =====================================================================

/**
 * Returns the connection state for the editor page's "is eBay
 * usable?" check. `app=true` means we can do taxonomy lookups;
 * `user=true` means we can actually list. Caller passes both flags
 * separately so the UI can degrade gracefully (e.g. category picker
 * works even if user token isn't set up yet).
 */
export async function checkConnection(env: EbayEnvCreds): Promise<{
	app: boolean;
	user: boolean;
	error?: string;
}> {
	let app = false;
	let user = false;
	let error: string | undefined;
	try {
		await getAppToken(env);
		app = true;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
	if (env.EBAY_REFRESH_TOKEN) {
		try {
			await getUserToken(env);
			user = true;
		} catch (err) {
			error = (error ? error + ' | ' : '') + (err instanceof Error ? err.message : String(err));
		}
	}
	return { app, user, error };
}
