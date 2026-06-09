/**
 * Thin client for the Squarespace Commerce API.
 *
 * Docs: https://developers.squarespace.com/commerce-apis/products-api
 *
 * Auth is a Bearer token created in Settings → Developer Tools → API Keys
 * in the Squarespace admin. The key must have the **Products** scope at
 * minimum; **Inventory** and **Transactions** scopes will be required once
 * we move past this read-only import phase.
 *
 * We keep this module narrow on purpose — only the endpoints we actually
 * call, only the response shape we actually read. When the official
 * spec adds fields, we add them here as we need them.
 */

const BASE_URL = 'https://api.squarespace.com/1.0';

/** A monetary amount as Squarespace returns it. */
export interface Money {
	value: string; // decimal string, e.g. "129.00"
	currency: string; // ISO 4217, e.g. "USD"
}

/** One purchasable SKU within a product. A product with no variation
 *  options still has exactly one variant. */
export interface SquarespaceVariant {
	id: string;
	sku: string;
	pricing: {
		basePrice: Money;
		onSale: boolean;
		salePrice?: Money;
	};
	stock?: {
		quantity: number;
		unlimited: boolean;
	};
	attributes?: Record<string, string>;
}

/** A product image as the API returns it. The `url` is on the Squarespace
 *  CDN and is publicly fetchable without auth — easy to download to R2. */
export interface SquarespaceImage {
	id: string;
	url: string;
	altText?: string;
}

/** SEO override fields stored on a product. SS calls this `seoOptions`
 *  in GET responses and `seoData` in some update-product docs — it's
 *  the same shape, just different keys. We send BOTH on writes to
 *  avoid betting on the wrong one (extra unknown keys are ignored).
 *  When unset, SS auto-derives the page title and meta description
 *  from the product's own name + description. */
export interface SquarespaceSeoOptions {
	title?: string;
	description?: string;
}

export interface SquarespaceProduct {
	id: string;
	type: string; // "PHYSICAL" | "DIGITAL" | "SERVICE" | "GIFT_CARD"
	storePageId: string;
	name: string;
	description: string; // HTML
	/** Full publicly-fetchable storefront URL including Dad's custom
	 *  domain — e.g. https://www.southwestacousticproducts.com/shop/p/...
	 *  SS populates this for any product on a published store page. */
	url?: string;
	urlSlug: string;
	tags: string[];
	isVisible: boolean;
	variants: SquarespaceVariant[];
	images: SquarespaceImage[];
	/** Per-product SEO override. `null` (NOT undefined) when unset on
	 *  the SS side — the API explicitly returns the field with null. */
	seoOptions?: SquarespaceSeoOptions | null;
	createdOn: string;
	modifiedOn: string;
}

export interface SquarespaceListResponse<T> {
	products: T[];
	pagination: {
		hasNextPage: boolean;
		nextPageCursor?: string;
		nextPageUrl?: string;
	};
}

/** Network/API error with context — surfaced to the diagnostic page so
 *  we can tell at a glance whether it's a bad key, a missing scope, or
 *  the API itself being unhappy. */
export class SquarespaceError extends Error {
	constructor(
		public readonly httpStatus: number,
		public readonly body: string,
		message?: string
	) {
		super(message ?? `Squarespace API returned ${httpStatus}`);
	}
}

function authHeaders(apiKey: string): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		'User-Agent': 'sw-acoustics-inventory/0.0.1',
		Accept: 'application/json'
	};
}

/** Fetch one page of products. `cursor` is the pagination cursor from a
 *  previous response; omit for the first page. */
export async function listProducts(
	apiKey: string,
	options: { cursor?: string } = {}
): Promise<SquarespaceListResponse<SquarespaceProduct>> {
	const url = new URL(`${BASE_URL}/commerce/products`);
	if (options.cursor) url.searchParams.set('cursor', options.cursor);

	const res = await fetch(url.toString(), { headers: authHeaders(apiKey) });
	const body = await res.text();
	if (!res.ok) throw new SquarespaceError(res.status, body);
	return JSON.parse(body) as SquarespaceListResponse<SquarespaceProduct>;
}

/**
 * Find an existing product on Squarespace by one of its variant SKUs.
 *
 * We stamp our internal item SKU onto the variant of every product we
 * create, and SKUs are unique per item in our DB — so a SKU match
 * reliably identifies a product WE created, even when the local
 * external_id link was lost. (That happens when a push crashed before
 * saving the id — e.g. the old in-Worker photo transcode hitting the
 * resource limit — leaving an "orphan" product on SS.) The push path
 * uses this to ADOPT the orphan and update it in place instead of
 * creating yet another duplicate.
 *
 * Matching on the SKU (not the slug) is the safe choice: the read-side
 * `urlSlug` carries a `p/` prefix the write side doesn't, and a wrong
 * slug match could clobber an unrelated product. A SKU is ours and exact.
 *
 * The Products API has no server-side SKU filter, so we page through.
 * `maxPages` caps the scan to stay well under the Worker subrequest
 * budget — for Dad's small store this is a page or two. Returns the
 * FIRST matching product (+ its variant id), or null if none found
 * within the scan window.
 */
export async function findProductBySku(
	apiKey: string,
	sku: string,
	maxPages = 15
): Promise<{ product: SquarespaceProduct; variantId: string | null } | null> {
	const target = sku.trim().toLowerCase();
	if (!target) return null;

	let cursor: string | undefined;
	for (let page = 0; page < maxPages; page++) {
		const resp = await listProducts(apiKey, cursor ? { cursor } : {});
		for (const product of resp.products ?? []) {
			const variant = product.variants?.find(
				(v) => (v.sku ?? '').trim().toLowerCase() === target
			);
			if (variant) return { product, variantId: variant.id };
		}
		if (!resp.pagination?.hasNextPage || !resp.pagination.nextPageCursor) break;
		cursor = resp.pagination.nextPageCursor;
	}
	return null;
}

/**
 * Find a product by its URL slug. Used when a create 409s with
 * URL_SLUG_UNAVAILABLE: the slug being taken means the product already
 * exists, so we ADOPT the owner instead of creating a suffixed
 * duplicate. (This is the safety net for products that carry a different
 * SKU than ours — Dad's original listings — which findProductBySku
 * can't match.)
 *
 * The read-side urlSlug can include a "p/" path prefix while the slug we
 * send on create doesn't, so we compare the last path segment.
 */
export async function findProductBySlug(
	apiKey: string,
	slug: string,
	maxPages = 15
): Promise<SquarespaceProduct | null> {
	const lastSeg = (s: string | null | undefined) =>
		(s ?? '').split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
	const target = lastSeg(slug);
	if (!target) return null;

	let cursor: string | undefined;
	for (let page = 0; page < maxPages; page++) {
		const resp = await listProducts(apiKey, cursor ? { cursor } : {});
		for (const product of resp.products ?? []) {
			if (lastSeg(product.urlSlug) === target) return product;
		}
		if (!resp.pagination?.hasNextPage || !resp.pagination.nextPageCursor) break;
		cursor = resp.pagination.nextPageCursor;
	}
	return null;
}

// =====================================================================
// Inventory API.
//
// Separate from the Products API — the inventory endpoint returns
// stock data per variant in a tight, paginated format. Useful for a
// fast stock-only sync without re-fetching every product's images and
// description.
//
// Docs: https://developers.squarespace.com/commerce-apis/inventory-api-overview
// =====================================================================

export interface SquarespaceInventoryEntry {
	variantId: string;
	sku: string;
	quantity: number;
	isUnlimited: boolean;
	descriptor?: string;
}

interface InventoryListResponse {
	inventory: SquarespaceInventoryEntry[];
	pagination: {
		hasNextPage: boolean;
		nextPageCursor?: string;
		nextPageUrl?: string;
	};
}

/** Fetch one page of inventory entries. `cursor` is the pagination
 *  cursor from a previous response; omit for the first page. The
 *  Inventory scope on the API key is required for this endpoint. */
export async function listInventory(
	apiKey: string,
	options: { cursor?: string } = {}
): Promise<InventoryListResponse> {
	const url = new URL(`${BASE_URL}/commerce/inventory`);
	if (options.cursor) url.searchParams.set('cursor', options.cursor);

	const res = await fetch(url.toString(), { headers: authHeaders(apiKey) });
	const body = await res.text();
	if (!res.ok) throw new SquarespaceError(res.status, body);
	return JSON.parse(body) as InventoryListResponse;
}

// =====================================================================
// Orders API — for pulling SOLD metrics back into inventory.
//
// When a product sells on the storefront, it shows up as an order line
// item here. We match line items to our items by SKU, then write a
// 'sale' movement + decrement on-hand. Requires the **Orders** read
// scope on the API key.
//
// Docs: https://developers.squarespace.com/commerce-apis/orders-api-overview
// =====================================================================

export interface SquarespaceOrderLineItem {
	id?: string;
	variantId?: string;
	sku?: string;
	productId?: string;
	productName?: string;
	quantity: number;
	unitPricePaid?: Money;
}

export interface SquarespaceOrder {
	id: string;
	orderNumber?: string;
	createdOn: string;
	modifiedOn?: string;
	fulfillmentStatus?: string; // PENDING | FULFILLED | CANCELED
	lineItems: SquarespaceOrderLineItem[];
}

interface OrdersListResponse {
	result: SquarespaceOrder[];
	pagination: {
		hasNextPage: boolean;
		nextPageCursor?: string;
		nextPageUrl?: string;
	};
}

/**
 * Fetch one page of orders. SS requires `modifiedAfter` + `modifiedBefore`
 * together (ISO 8601) when filtering by time, OR a `cursor` for the next
 * page — never both. We page through everything in the window at the
 * call site.
 */
export async function listOrders(
	apiKey: string,
	options: { modifiedAfter?: string; modifiedBefore?: string; cursor?: string } = {}
): Promise<OrdersListResponse> {
	const url = new URL(`${BASE_URL}/commerce/orders`);
	if (options.cursor) {
		url.searchParams.set('cursor', options.cursor);
	} else if (options.modifiedAfter && options.modifiedBefore) {
		url.searchParams.set('modifiedAfter', options.modifiedAfter);
		url.searchParams.set('modifiedBefore', options.modifiedBefore);
	}

	const res = await fetch(url.toString(), { headers: authHeaders(apiKey) });
	const body = await res.text();
	if (!res.ok) throw new SquarespaceError(res.status, body);
	return JSON.parse(body) as OrdersListResponse;
}

// =====================================================================
// Store pages — Dad's storefronts. We need these for the SS storePageId
// when creating new products. Cached client-side once fetched.
// =====================================================================

export interface SquarespaceStorePage {
	id: string;
	title: string;
}

interface StorePagesResponse {
	storePages?: SquarespaceStorePage[];
}

export async function listStorePages(apiKey: string): Promise<SquarespaceStorePage[]> {
	const res = await fetch(`${BASE_URL}/commerce/store_pages`, {
		headers: authHeaders(apiKey)
	});
	const body = await res.text();
	if (!res.ok) throw new SquarespaceError(res.status, body);
	const data = JSON.parse(body) as StorePagesResponse;
	return data.storePages ?? [];
}

// =====================================================================
// Push: create / update products.
//
// The payload shape mirrors what we receive from listProducts() —
// products with one or more variants; each variant has its own SKU,
// price, and stock. For inventory items we typically push a single
// variant per product (per-physical-item) until we wire the
// parent/variant grouping into the listing builder.
// =====================================================================

export interface SquarespaceProductWritePayload {
	type: 'PHYSICAL' | 'DIGITAL' | 'SERVICE' | 'GIFT_CARD';
	storePageId?: string;
	name: string;
	description?: string; // HTML
	urlSlug?: string;
	tags?: string[];
	/**
	 * SS product categories (sub-shop navigation entries on Dad's
	 * storefront). NOT publicly documented in the Products API as of
	 * this writing — SS docs only mention `tags`. We send it anyway
	 * because the admin UI clearly stores categories separately from
	 * tags, and APIs typically accept the underlying field name.
	 *
	 * If SS silently ignores it, no harm done — we also send the
	 * category slugs in `tags[]` as a fallback for tag-driven
	 * storefront filtering. If it works, categories appear correctly
	 * in SS admin and drive the proper sub-shop navigation.
	 *
	 * Category names: max 25 chars, case-sensitive, must match what
	 * SS admin shows (or it'll create a new category with that name).
	 */
	categories?: string[];
	/**
	 * NOT SENT on writes — kept here only for future-proofing if SS
	 * ever opens this on the public API. Both candidate field names
	 * we tried (`seoData` and `seoOptions`) are rejected with HTTP 400
	 * "unknown or readonly fields". Same admin-UI-only restriction as
	 * `categories` and Fulfillment Profile.
	 *
	 * SS does RETURN the field as `seoOptions` on product GETs, so
	 * we still parse it on reads via the `SquarespaceProduct` type
	 * (which has the `seoOptions` field) and round-trip Dad's
	 * admin-UI-set SEO back to our local copy via the Pull action.
	 */
	seoData?: SquarespaceSeoOptions;
	isVisible?: boolean;
	variants: Array<{
		sku: string;
		pricing: {
			basePrice: { value: string; currency: string };
		};
		stock?: { quantity: number; unlimited: boolean };
		attributes?: Record<string, string>;
		// Per the Products API: weight + dimensions live on the
		// variant under shippingMeasurements. SS uses these for any
		// weight-based shipping rules on Dad's store. Omit when we
		// don't have it — SS treats it as "no specific weight".
		//
		// IMPORTANT: SS only accepts the literal strings POUND or
		// KILOGRAM for weight unit, and INCH or CENTIMETER for
		// dimension unit. They reject "oz", "lb", "in" etc. — we
		// convert ounces → pounds at the call site (oz / 16).
		shippingMeasurements?: {
			weight?: { value: number; unit: 'POUND' | 'KILOGRAM' };
			dimensions?: {
				length: number;
				width: number;
				height: number;
				unit: 'INCH' | 'CENTIMETER';
			};
		};
	}>;
	// Squarespace's documented field is `images` (an array of objects
	// describing each image). For pushing without re-uploading we omit
	// it entirely so SS leaves the existing images alone on updates.
}

export async function createProduct(
	apiKey: string,
	payload: SquarespaceProductWritePayload
): Promise<SquarespaceProduct> {
	const res = await fetch(`${BASE_URL}/commerce/products`, {
		method: 'POST',
		headers: { ...authHeaders(apiKey), 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});
	const body = await res.text();
	if (!res.ok) throw new SquarespaceError(res.status, body);
	return JSON.parse(body) as SquarespaceProduct;
}

/**
 * Fetch a single product by id, including its full image list with
 * publicly-fetchable CDN URLs. Used by the Reverb push path to grab
 * SS-hosted image URLs and pass them to Reverb's create-listing
 * endpoint (Reverb fetches images by URL, doesn't accept binary).
 *
 * SS's single-product GET wraps the result in `{ products: [...] }`
 * even though it's just one — we unwrap to the bare product object.
 */
export async function getProduct(
	apiKey: string,
	productId: string
): Promise<SquarespaceProduct> {
	const res = await fetch(
		`${BASE_URL}/commerce/products/${encodeURIComponent(productId)}`,
		{ headers: authHeaders(apiKey) }
	);
	const body = await res.text();
	if (!res.ok) throw new SquarespaceError(res.status, body);
	const parsed = JSON.parse(body);
	if (parsed.products && Array.isArray(parsed.products) && parsed.products[0]) {
		return parsed.products[0] as SquarespaceProduct;
	}
	return parsed as SquarespaceProduct;
}

export async function updateProduct(
	apiKey: string,
	productId: string,
	payload: Partial<SquarespaceProductWritePayload>
): Promise<SquarespaceProduct> {
	// Updating a product is POST /v2/commerce/products/{id} — NOT PUT, and
	// NOT the legacy 1.0 base. (1.0 create still works, but 1.0 has no
	// PUT-update, which is what produced the HTTP 405.) v2 supports partial
	// updates of PRODUCT-LEVEL fields only.
	// Ref: https://developers.squarespace.com/commerce-apis/update-product
	//
	// v2 rejects create-only / read-only fields with "unknown or readonly
	// fields: [...]". Strip them: `type` + `storePageId` are immutable, and
	// `variants` are NOT part of the product-update body in v2 — variant
	// price lives on POST .../variants/{id} and stock on the Inventory API
	// (see updateProductVariant / setVariantStock / updateProductFull).
	const updatable: Partial<SquarespaceProductWritePayload> = { ...payload };
	delete updatable.type;
	delete updatable.storePageId;
	delete updatable.variants;
	// Don't re-send the slug on updates. It's set at create and a stable
	// URL is what we want; re-sending it on every push is the source of
	// slug conflicts/errors on existing products. (Renaming a slug, if ever
	// needed, would be a deliberate separate action.)
	delete updatable.urlSlug;
	const res = await fetch(`${V2_BASE_URL}/commerce/products/${encodeURIComponent(productId)}`, {
		method: 'POST',
		headers: { ...authHeaders(apiKey), 'content-type': 'application/json' },
		body: JSON.stringify(updatable)
	});
	const body = await res.text();
	if (!res.ok) throw new SquarespaceError(res.status, body);
	return JSON.parse(body) as SquarespaceProduct;
}

/**
 * Update a single variant's PRICE (v2). Stock is NOT here — see
 * setVariantStock. POST /v2/commerce/products/{productId}/variants/{id}.
 */
export async function updateProductVariant(
	apiKey: string,
	productId: string,
	variantId: string,
	payload: { pricing?: { basePrice: Money; onSale?: boolean; salePrice?: Money }; sku?: string }
): Promise<void> {
	const res = await fetch(
		`${V2_BASE_URL}/commerce/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
		{
			method: 'POST',
			headers: { ...authHeaders(apiKey), 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		}
	);
	if (res.ok) return;
	throw new SquarespaceError(res.status, await res.text());
}

/**
 * Set a variant's ABSOLUTE on-hand quantity via the Inventory API.
 * POST /1.0/commerce/inventory/adjustments with `setFiniteOperations`.
 * The SS variant id IS the inventory item id. Requires the Inventory
 * write scope on the API key.
 * Ref: https://developers.squarespace.com/commerce-apis/adjust-stock-quantities
 */
export async function setVariantStock(
	apiKey: string,
	variantId: string,
	quantity: number
): Promise<void> {
	const res = await fetch(`${BASE_URL}/commerce/inventory/adjustments`, {
		method: 'POST',
		headers: {
			...authHeaders(apiKey),
			'content-type': 'application/json',
			// Inventory writes REQUIRE a unique Idempotency-Key — without it
			// SS rejects with a bare 400 (no body). One fresh UUID per call
			// is correct here: each stock-set is its own intended action.
			'Idempotency-Key': crypto.randomUUID()
		},
		body: JSON.stringify({
			setFiniteOperations: [{ variantId, quantity: Math.max(0, Math.round(quantity)) }]
		})
	});
	if (res.ok) return;
	throw new SquarespaceError(res.status, await res.text());
}

/**
 * High-level "update this listing" for v2 — orchestrates the three calls
 * the old 1.0 single-payload update used to do in one shot:
 *   1. product-level fields  (name/description/slug/tags/visibility)
 *   2. variant price         (if the payload carries a variant price)
 *   3. variant stock         (if the payload carries a finite stock qty)
 *
 * Callers keep handing us the familiar create-style payload (with a
 * variants[0]) and this fans it out to the right v2 endpoints. Returns
 * the fresh product (with variant ids + url) for the caller's bookkeeping.
 */
export async function updateProductFull(
	apiKey: string,
	productId: string,
	payload: Partial<SquarespaceProductWritePayload>
): Promise<SquarespaceProduct> {
	// Each step is labeled so a failure tells us EXACTLY which v2 call
	// rejected it (product / variant price / stock) + the response body,
	// instead of an ambiguous "HTTP 400".
	// 1. Product-level fields (updateProduct strips type/storePageId/variants).
	await labelStep('product fields', () => updateProduct(apiKey, productId, payload));

	// Re-fetch for the authoritative variant ids + complete product object.
	const product = await getProduct(apiKey, productId);
	const want = payload.variants?.[0];
	if (want) {
		const variant =
			(want.sku ? product.variants?.find((v) => v.sku === want.sku) : undefined) ??
			product.variants?.[0];
		const vid = variant?.id;
		if (vid) {
			// 2. Price + SKU (both live on the variant).
			if (want.pricing?.basePrice || want.sku) {
				const variantPayload: {
					pricing?: { basePrice: Money; onSale?: boolean; salePrice?: Money };
					sku?: string;
				} = {};
				if (want.pricing?.basePrice) {
					const newBase = want.pricing.basePrice;
					// Squarespace rejects a base price that's BELOW an active sale
					// price ("sale price is greater than the base price"). If our
					// new base undercuts an existing sale, clear the sale so the
					// update succeeds; otherwise leave any still-valid sale alone.
					const live = variant?.pricing;
					const baseVal = parseFloat(newBase.value);
					const saleVal = live?.salePrice ? parseFloat(live.salePrice.value) : NaN;
					variantPayload.pricing =
						live?.onSale && Number.isFinite(saleVal) && saleVal > baseVal
							? { basePrice: newBase, onSale: false }
							: { basePrice: newBase };
				}
				if (want.sku) variantPayload.sku = want.sku;
				await labelStep('variant price', () =>
					updateProductVariant(apiKey, productId, vid, variantPayload)
				);
			}
			// 3. Stock (absolute), unless the variant is unlimited. Stock is
			// best-effort: content + price already updated, so a stock-only
			// hiccup must NOT fail the whole push. Logged for follow-up.
			if (want.stock && !want.stock.unlimited && typeof want.stock.quantity === 'number') {
				const qty = want.stock.quantity;
				try {
					await labelStep('stock', () => setVariantStock(apiKey, vid, qty));
				} catch (stockErr) {
					console.error('Squarespace stock sync failed (non-fatal):', stockErr);
				}
			}
		}
	}
	return product;
}

/** Run a v2 update step; on a Squarespace error, rethrow with the step
 *  name baked into the body so the recorded push error says which call
 *  failed (e.g. "[variant price] …"). */
async function labelStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof SquarespaceError) {
			throw new SquarespaceError(err.httpStatus, `[${label}] ${err.body || '(no response body)'}`);
		}
		throw err;
	}
}

/**
 * Permanently delete a product from Squarespace.
 *
 * Used by (a) the retire-an-item auto-sync (sellable items pull their
 * listing when discontinued) and (b) the duplicate-cleanup tool. SS
 * returns 204 No Content on success and 404 if the product is already
 * gone — we treat 404 as success (idempotent: the end state is "not on
 * SS" either way) so a double-click or a stale id doesn't error.
 *
 * This is irreversible on SS's side — the product, its URL, and any
 * reviews are gone. Callers gate it behind an explicit user action.
 */
export async function deleteProduct(apiKey: string, productId: string): Promise<void> {
	const res = await fetch(`${BASE_URL}/commerce/products/${encodeURIComponent(productId)}`, {
		method: 'DELETE',
		headers: authHeaders(apiKey)
	});
	if (res.ok || res.status === 404) return;
	const body = await res.text();
	throw new SquarespaceError(res.status, body);
}

/**
 * Upload a single product image as multipart/form-data.
 *
 * IMPORTANT: this endpoint lives on Squarespace's v2 API (not the
 * 1.0 API the rest of this module uses) and the path is plural
 * (`/images`). The 1.0/.../image (singular) endpoint exists too —
 * but it accepts application/json for metadata updates, not image
 * binaries. Sending multipart to it returns HTTP 415:
 *   "Content-Type header value must be application/json"
 * Burned that hour finding out. v2 + plural is the binary endpoint.
 *
 * Docs:
 *   POST https://api.squarespace.com/v2/commerce/products/{id}/images
 *   Returns 202 Accepted with `{ imageId: string }`. Image processes
 *   asynchronously; status checkable at
 *   GET /v2/commerce/products/{id}/images/{imageId}/status
 *
 * The Products API also doesn't accept image URLs in the product
 * payload (Reverb does, Squarespace doesn't). Even if it did, our
 * R2 photos live behind Cloudflare Access so SS couldn't fetch
 * them. So binary multipart per photo is the only path.
 *
 * Each call is one Workers subrequest. Free-tier Workers cap at 50
 * subrequests per invocation, so the caller should keep the photo
 * batch comfortably under that.
 */
const V2_BASE_URL = 'https://api.squarespace.com/v2';

/**
 * Image formats Squarespace's upload endpoint will accept. WebP and
 * AVIF are explicitly NOT on this list — sending either returns
 * HTTP 400 "The provided file could not be read as an image". We
 * transcode anything outside this set to JPEG before upload.
 *
 * Source: https://support.squarespace.com/hc/en-us/articles/206542547
 * (also discoverable via trial-and-error — see the 400 contextId in
 * git history).
 */
const SS_ACCEPTED_IMAGE_TYPES = new Set([
	'image/jpeg',
	'image/jpg',
	'image/pjpeg',
	'image/png',
	'image/gif'
]);

/**
 * Lazy WASM module loader for Photon. Imported on first use so the
 * ~500 KB WASM module isn't paid for on cold starts that don't push
 * photos (most page loads). Cached at module scope after first call.
 */
let _photonModule: Promise<typeof import('@cf-wasm/photon')> | null = null;
function loadPhoton(): Promise<typeof import('@cf-wasm/photon')> {
	if (!_photonModule) _photonModule = import('@cf-wasm/photon');
	return _photonModule;
}

/**
 * If `contentType` is outside SS_ACCEPTED_IMAGE_TYPES, decode the
 * source bytes via Photon and re-encode as JPEG. Returns the
 * (possibly-transcoded) bytes + the new content type + the filename
 * with a `.jpg` extension. The PhotonImage handle is `.free()`'d
 * eagerly — Workers' WASM heap is shared with JS, leaking adds up
 * across batches.
 *
 * Quality 85 strikes the usual balance for product photography
 * (visually indistinguishable from the source for most cameras,
 * ~3-5× smaller than q100).
 */
async function normalizeForSquarespace(
	bytes: ArrayBuffer,
	contentType: string,
	filename: string
): Promise<{ bytes: ArrayBuffer; contentType: string; filename: string }> {
	const ct = contentType.toLowerCase();
	if (SS_ACCEPTED_IMAGE_TYPES.has(ct)) {
		return { bytes, contentType, filename };
	}

	const { PhotonImage } = await loadPhoton();
	let img: InstanceType<typeof PhotonImage> | null = null;
	try {
		img = PhotonImage.new_from_byteslice(new Uint8Array(bytes));
		const jpegBytes = img.get_bytes_jpeg(85);
		// jpegBytes is a Uint8Array — copy into a fresh ArrayBuffer so
		// the caller gets a contiguous, non-shared buffer regardless of
		// what Photon's WASM allocator returned. (Photon's underlying
		// buffer may be a SharedArrayBuffer or larger than the view —
		// .slice() on a Uint8Array returns a Uint8Array, whose .buffer
		// is a fresh ArrayBuffer.)
		const out = jpegBytes.slice().buffer;
		const newFilename = filename.replace(/\.[^./\\]+$/, '') + '.jpg';
		return { bytes: out, contentType: 'image/jpeg', filename: newFilename };
	} finally {
		img?.free();
	}
}

export async function uploadProductImage(
	apiKey: string,
	productId: string,
	imageBytes: ArrayBuffer,
	contentType: string,
	filename: string
): Promise<{ imageId?: string; status?: string }> {
	// Transcode WebP / AVIF / anything-not-on-SS's-list into JPEG
	// before posting. Photos imported from SS CDN are often WebP
	// (SS serves WebP via content negotiation when the import fetch
	// advertises support) and SS's own upload endpoint refuses them.
	const normalized = await normalizeForSquarespace(imageBytes, contentType, filename);

	const url = `${V2_BASE_URL}/commerce/products/${encodeURIComponent(productId)}/images`;

	const form = new FormData();
	form.append(
		'file',
		new Blob([normalized.bytes], { type: normalized.contentType }),
		normalized.filename
	);

	const res = await fetch(url, {
		method: 'POST',
		headers: {
			// Don't set content-type here — FormData sets it with the
			// multipart boundary. Hand-rolling that boundary is the
			// number-one footgun on this endpoint.
			...authHeaders(apiKey)
		},
		body: form
	});

	const body = await res.text();
	if (!res.ok) throw new SquarespaceError(res.status, body);

	// SS returns JSON on 202 Accepted with `{ imageId: "..." }`. Some
	// images may return an empty body — defensive parse.
	try {
		return JSON.parse(body) as { imageId?: string; status?: string };
	} catch {
		return {};
	}
}
