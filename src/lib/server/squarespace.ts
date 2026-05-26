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

/** Fetch one page of products. `cursor` is the pagination cursor from a
 *  previous response; omit for the first page. */
export async function listProducts(
	apiKey: string,
	options: { cursor?: string } = {}
): Promise<SquarespaceListResponse<SquarespaceProduct>> {
	const url = new URL(`${BASE_URL}/commerce/products`);
	if (options.cursor) url.searchParams.set('cursor', options.cursor);

	const res = await fetch(url.toString(), {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			// User-Agent is required by Squarespace's API gateway.
			'User-Agent': 'sw-acoustics-inventory/0.0.1',
			Accept: 'application/json'
		}
	});

	const body = await res.text();
	if (!res.ok) {
		throw new SquarespaceError(res.status, body);
	}

	return JSON.parse(body) as SquarespaceListResponse<SquarespaceProduct>;
}
