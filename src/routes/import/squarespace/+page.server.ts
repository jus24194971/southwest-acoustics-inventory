import type { PageServerLoad } from './$types';
import { listProducts, SquarespaceError } from '$lib/server/squarespace';
import { getDB } from '$lib/server/db';

/**
 * Diagnostic + importer for Squarespace.
 *
 * The page load is read-only: it confirms we can hit SS, reports counts,
 * and shows a sample. The `runBatch` form action is what actually
 * writes inventory — it processes up to 10 un-imported variants and
 * returns progress so the client can poll-loop to completion.
 */

interface DiagnosticData {
	status: 'no_key' | 'ok' | 'api_error' | 'network_error';
	message?: string;
	httpStatus?: number;
	body?: string;
	sampleCount?: number;
	hasNextPage?: boolean;
	totalImageCount?: number;
	totalVariantCount?: number;
	alreadyImportedCount?: number;
	sample?: Array<{
		id: string;
		name: string;
		descriptionPreview: string;
		descriptionLength: number;
		imageCount: number;
		firstImageUrl: string | null;
		variantCount: number;
		firstVariantSku: string;
		firstVariantPrice: string;
		isVisible: boolean;
		tags: string[];
	}>;
}

export const load: PageServerLoad = async (event): Promise<DiagnosticData> => {
	const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;

	if (!apiKey) {
		return {
			status: 'no_key',
			message:
				'SQUARESPACE_API_KEY is not set. For production: ' +
				'`npx wrangler pages secret put SQUARESPACE_API_KEY --project-name sw-acoustics-inventory`. ' +
				'For local dev: add it to .dev.vars at the repo root.'
		};
	}

	// Already-imported count comes from D1, regardless of whether SS is up.
	let alreadyImportedCount = 0;
	try {
		const db = getDB(event);
		const row = await db
			.prepare(`SELECT COUNT(*) AS n FROM item WHERE squarespace_product_id IS NOT NULL`)
			.first<{ n: number }>();
		alreadyImportedCount = row?.n ?? 0;
	} catch {
		// platform.env.DB may not be set in vite-dev — silently fall through.
	}

	try {
		const page = await listProducts(apiKey);
		const products = page.products ?? [];

		const sample = products.slice(0, 5).map((p) => {
			const firstImage = p.images?.[0]?.url ?? null;
			const firstVariant = p.variants?.[0];
			const descriptionText = (p.description ?? '')
				.replace(/<[^>]*>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			return {
				id: p.id,
				name: p.name,
				descriptionPreview: descriptionText.slice(0, 180),
				descriptionLength: descriptionText.length,
				imageCount: p.images?.length ?? 0,
				firstImageUrl: firstImage,
				variantCount: p.variants?.length ?? 0,
				firstVariantSku: firstVariant?.sku ?? '',
				firstVariantPrice: firstVariant
					? `${firstVariant.pricing.basePrice.currency} ${firstVariant.pricing.basePrice.value}`
					: '—',
				isVisible: p.isVisible,
				tags: p.tags ?? []
			};
		});

		return {
			status: 'ok',
			sampleCount: products.length,
			hasNextPage: page.pagination?.hasNextPage ?? false,
			totalImageCount: products.reduce((n, p) => n + (p.images?.length ?? 0), 0),
			totalVariantCount: products.reduce((n, p) => n + (p.variants?.length ?? 0), 0),
			alreadyImportedCount,
			sample
		};
	} catch (err) {
		if (err instanceof SquarespaceError) {
			return {
				status: 'api_error',
				httpStatus: err.httpStatus,
				message: err.message,
				body: err.body.slice(0, 2000),
				alreadyImportedCount
			};
		}
		return {
			status: 'network_error',
			message: err instanceof Error ? err.message : String(err),
			alreadyImportedCount
		};
	}
};

// The actual batch processing lives at /api/import/squarespace/batch
// as a plain JSON endpoint — the page polls it in a loop. Returning
// JSON from a real endpoint is much easier on the client than parsing
// SvelteKit's devalue-encoded action results.
