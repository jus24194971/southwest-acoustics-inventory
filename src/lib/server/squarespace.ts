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

export interface SquarespaceProduct {
	id: string;
	type: string; // "PHYSICAL" | "DIGITAL" | "SERVICE" | "GIFT_CARD"
	storePageId: string;
	name: string;
	description: string; // HTML
	urlSlug: string;
	tags: string[];
	isVisible: boolean;
	variants: SquarespaceVariant[];
	images: SquarespaceImage[];
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

export async function updateProduct(
	apiKey: string,
	productId: string,
	payload: Partial<SquarespaceProductWritePayload>
): Promise<SquarespaceProduct> {
	const res = await fetch(`${BASE_URL}/commerce/products/${encodeURIComponent(productId)}`, {
		method: 'PUT',
		headers: { ...authHeaders(apiKey), 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});
	const body = await res.text();
	if (!res.ok) throw new SquarespaceError(res.status, body);
	return JSON.parse(body) as SquarespaceProduct;
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

export async function uploadProductImage(
	apiKey: string,
	productId: string,
	imageBytes: ArrayBuffer,
	contentType: string,
	filename: string
): Promise<{ imageId?: string; status?: string }> {
	const url = `${V2_BASE_URL}/commerce/products/${encodeURIComponent(productId)}/images`;

	const form = new FormData();
	form.append('file', new Blob([imageBytes], { type: contentType }), filename);

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
