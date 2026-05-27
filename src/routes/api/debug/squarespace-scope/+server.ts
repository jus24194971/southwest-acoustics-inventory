import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';

/**
 * POST /api/debug/squarespace-scope
 *
 * Diagnostic: probes a list of candidate Squarespace endpoints to
 * discover what the current API key can see. Used to:
 *   - Find the undocumented endpoint for listing fulfillment profiles
 *     (Dad has 5 named profiles in admin; we want to assign them
 *     programmatically when pushing listings)
 *   - GET a sample product raw so we can see undocumented fields
 *     like categories, ordering, etc. that the docs don't list
 *
 * Body (JSON, optional):
 *   { sampleProductId?: string }   // for the raw-product probe
 *
 * Returns per-candidate { url, method, status, ok, body } with
 * bodies truncated to 2000 chars for readability.
 *
 * Not linked from main navigation — visit directly via the URL or
 * from the new /settings/squarespace-scope page.
 */

interface ReqBody {
	sampleProductId?: string;
}

interface ProbeResult {
	label: string;
	url: string;
	method: 'GET' | 'POST';
	status: number;
	ok: boolean;
	body: string;
	error?: string;
}

const API_BASES = {
	v1: 'https://api.squarespace.com/1.0',
	v2: 'https://api.squarespace.com/v2'
};

async function probe(
	label: string,
	url: string,
	apiKey: string,
	method: 'GET' | 'POST' = 'GET'
): Promise<ProbeResult> {
	try {
		const res = await fetch(url, {
			method,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'User-Agent': 'sw-acoustics-inventory/scope-tool',
				Accept: 'application/json'
			}
		});
		const body = await res.text();
		return {
			label,
			url,
			method,
			status: res.status,
			ok: res.ok,
			// Bumped from 2000 → 12000 chars after the first probe run
			// truncated the product GET mid-images[]. Larger budget so
			// we see undocumented fields if they exist further down.
			body: body.length > 12000 ? body.slice(0, 12000) + '\n…(truncated)' : body
		};
	} catch (err) {
		return {
			label,
			url,
			method,
			status: 0,
			ok: false,
			body: '',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

export const POST: RequestHandler = async (event) => {
	const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
	if (!apiKey) throw error(400, 'SQUARESPACE_API_KEY not configured.');

	let body: ReqBody = {};
	try {
		const ct = event.request.headers.get('content-type') ?? '';
		if (ct.includes('application/json')) body = (await event.request.json()) as ReqBody;
	} catch {
		body = {};
	}

	// Candidate endpoints — best guesses based on SS naming conventions.
	// Round 2: expanded after the first probe found nothing for
	// fulfillment/shipping/categories. More naming patterns + paths
	// nested under products/store_pages since those are siblings of
	// fulfillment in the SS data model.
	const candidates: Array<{ label: string; url: string }> = [
		// Fulfillment profiles — top-level candidates
		{ label: 'v1 fulfillment_profiles', url: `${API_BASES.v1}/commerce/fulfillment_profiles` },
		{ label: 'v1 fulfillment-profiles', url: `${API_BASES.v1}/commerce/fulfillment-profiles` },
		{ label: 'v1 fulfillmentProfiles', url: `${API_BASES.v1}/commerce/fulfillmentProfiles` },
		{ label: 'v1 fulfillment/profiles', url: `${API_BASES.v1}/commerce/fulfillment/profiles` },
		{ label: 'v1 fulfillment', url: `${API_BASES.v1}/commerce/fulfillment` },
		{ label: 'v2 fulfillment_profiles', url: `${API_BASES.v2}/commerce/fulfillment_profiles` },
		{ label: 'v2 fulfillment-profiles', url: `${API_BASES.v2}/commerce/fulfillment-profiles` },
		{ label: 'v2 fulfillmentProfiles', url: `${API_BASES.v2}/commerce/fulfillmentProfiles` },
		{ label: 'v2 fulfillment/profiles', url: `${API_BASES.v2}/commerce/fulfillment/profiles` },
		{ label: 'v2 fulfillment', url: `${API_BASES.v2}/commerce/fulfillment` },

		// Shipping profile variants
		{ label: 'v1 shipping/profiles', url: `${API_BASES.v1}/commerce/shipping/profiles` },
		{ label: 'v1 shipping_profiles', url: `${API_BASES.v1}/commerce/shipping_profiles` },
		{ label: 'v1 shipping-profiles', url: `${API_BASES.v1}/commerce/shipping-profiles` },
		{ label: 'v1 shipping', url: `${API_BASES.v1}/commerce/shipping` },
		{ label: 'v2 shipping/profiles', url: `${API_BASES.v2}/commerce/shipping/profiles` },
		{ label: 'v2 shipping_profiles', url: `${API_BASES.v2}/commerce/shipping_profiles` },
		{ label: 'v2 shipping-profiles', url: `${API_BASES.v2}/commerce/shipping-profiles` },
		{ label: 'v2 shipping', url: `${API_BASES.v2}/commerce/shipping` },

		// Categories candidates
		{ label: 'v1 categories', url: `${API_BASES.v1}/commerce/categories` },
		{ label: 'v2 categories', url: `${API_BASES.v2}/commerce/categories` },
		{ label: 'v1 product_categories', url: `${API_BASES.v1}/commerce/product_categories` },
		{ label: 'v2 product-categories', url: `${API_BASES.v2}/commerce/product-categories` },
		{ label: 'v2 product_categories', url: `${API_BASES.v2}/commerce/product_categories` },

		// Other surfaces of interest
		{ label: 'v1 store_pages', url: `${API_BASES.v1}/commerce/store_pages` },
		{ label: 'v2 store_pages', url: `${API_BASES.v2}/commerce/store_pages` },
		{ label: 'v2 store-pages', url: `${API_BASES.v2}/commerce/store-pages` },

		// Site-level
		{ label: 'v1 website', url: `${API_BASES.v1}/website` },
		{ label: 'v2 website', url: `${API_BASES.v2}/website` }
	];

	// Sub-resources of the store page — fulfillment is store-wide in
	// SS so the list might be nested under the storePageId.
	// Use the known good store page from the first probe run.
	const knownStorePageId = '60ef56663cf7327e6657d84c';
	candidates.push(
		{
			label: 'v1 store_pages/{id}/fulfillment_profiles',
			url: `${API_BASES.v1}/commerce/store_pages/${knownStorePageId}/fulfillment_profiles`
		},
		{
			label: 'v2 store_pages/{id}/fulfillment_profiles',
			url: `${API_BASES.v2}/commerce/store_pages/${knownStorePageId}/fulfillment_profiles`
		},
		{
			label: 'v1 store_pages/{id}',
			url: `${API_BASES.v1}/commerce/store_pages/${knownStorePageId}`
		},
		{
			label: 'v2 store_pages/{id}',
			url: `${API_BASES.v2}/commerce/store_pages/${knownStorePageId}`
		}
	);

	// Plus: if a product id is supplied, GET it RAW so we can see all
	// the fields the docs don't list — categories, profile assignment,
	// position/order, anything else hiding in the response. Also try
	// product sub-resources where fulfillment might be exposed
	// per-product (the SS admin UI does show it on each product).
	if (body.sampleProductId) {
		const pid = encodeURIComponent(body.sampleProductId);
		candidates.push(
			{ label: `v1 product GET (raw)`, url: `${API_BASES.v1}/commerce/products/${pid}` },
			{ label: `v2 product GET (raw)`, url: `${API_BASES.v2}/commerce/products/${pid}` },
			{
				label: `v1 product/{id}/fulfillment`,
				url: `${API_BASES.v1}/commerce/products/${pid}/fulfillment`
			},
			{
				label: `v2 product/{id}/fulfillment`,
				url: `${API_BASES.v2}/commerce/products/${pid}/fulfillment`
			},
			{
				label: `v1 product/{id}/fulfillment_profile`,
				url: `${API_BASES.v1}/commerce/products/${pid}/fulfillment_profile`
			},
			{
				label: `v2 product/{id}/fulfillment_profile`,
				url: `${API_BASES.v2}/commerce/products/${pid}/fulfillment_profile`
			},
			{
				label: `v1 product/{id}/shipping`,
				url: `${API_BASES.v1}/commerce/products/${pid}/shipping`
			},
			{
				label: `v2 product/{id}/shipping`,
				url: `${API_BASES.v2}/commerce/products/${pid}/shipping`
			},
			{
				label: `v1 product/{id}/categories`,
				url: `${API_BASES.v1}/commerce/products/${pid}/categories`
			},
			{
				label: `v2 product/{id}/categories`,
				url: `${API_BASES.v2}/commerce/products/${pid}/categories`
			}
		);
	}

	// Run all probes concurrently — they're independent and we want
	// the page to feel snappy.
	const results = await Promise.all(
		candidates.map((c) => probe(c.label, c.url, apiKey, 'GET'))
	);

	return json({
		probedAt: new Date().toISOString(),
		count: results.length,
		// Sort by whether they succeeded so the interesting hits float
		// to the top of the result table.
		results: results.sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? -1 : 1))
	});
};
