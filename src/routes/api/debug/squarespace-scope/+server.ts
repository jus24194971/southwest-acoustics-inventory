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
			body: body.length > 2000 ? body.slice(0, 2000) + '\n…(truncated)' : body
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
	// Most will probably 404; we just want to find which one(s) work
	// with the new broader-scope API key.
	const candidates: Array<{ label: string; url: string }> = [
		// Fulfillment profiles — the main hunt
		{ label: 'v1 fulfillment_profiles', url: `${API_BASES.v1}/commerce/fulfillment_profiles` },
		{ label: 'v1 fulfillment-profiles (dash)', url: `${API_BASES.v1}/commerce/fulfillment-profiles` },
		{ label: 'v1 fulfillmentProfiles (camel)', url: `${API_BASES.v1}/commerce/fulfillmentProfiles` },
		{ label: 'v2 fulfillment_profiles', url: `${API_BASES.v2}/commerce/fulfillment_profiles` },
		{ label: 'v2 fulfillment-profiles', url: `${API_BASES.v2}/commerce/fulfillment-profiles` },
		{ label: 'v2 fulfillmentProfiles', url: `${API_BASES.v2}/commerce/fulfillmentProfiles` },

		// Shipping profile variants
		{ label: 'v1 shipping/profiles', url: `${API_BASES.v1}/commerce/shipping/profiles` },
		{ label: 'v1 shipping_profiles', url: `${API_BASES.v1}/commerce/shipping_profiles` },
		{ label: 'v2 shipping/profiles', url: `${API_BASES.v2}/commerce/shipping/profiles` },
		{ label: 'v2 shipping_profiles', url: `${API_BASES.v2}/commerce/shipping_profiles` },

		// Categories — the other unknown
		{ label: 'v1 categories', url: `${API_BASES.v1}/commerce/categories` },
		{ label: 'v2 categories', url: `${API_BASES.v2}/commerce/categories` },
		{ label: 'v1 product_categories', url: `${API_BASES.v1}/commerce/product_categories` },
		{ label: 'v2 product-categories', url: `${API_BASES.v2}/commerce/product-categories` },

		// Other surfaces of interest
		{ label: 'v1 store_pages (known)', url: `${API_BASES.v1}/commerce/store_pages` },
		{ label: 'v2 store_pages', url: `${API_BASES.v2}/commerce/store_pages` },
		{ label: 'v2 store-pages (dash)', url: `${API_BASES.v2}/commerce/store-pages` },

		// Site-level
		{ label: 'v1 website', url: `${API_BASES.v1}/website` },
		{ label: 'v2 website', url: `${API_BASES.v2}/website` }
	];

	// Plus: if a product id is supplied, GET it RAW so we can see all
	// the fields the docs don't list — categories, profile assignment,
	// position/order, anything else hiding in the response.
	if (body.sampleProductId) {
		candidates.push(
			{
				label: `v1 product GET (raw fields)`,
				url: `${API_BASES.v1}/commerce/products/${encodeURIComponent(body.sampleProductId)}`
			},
			{
				label: `v2 product GET (raw fields)`,
				url: `${API_BASES.v2}/commerce/products/${encodeURIComponent(body.sampleProductId)}`
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
