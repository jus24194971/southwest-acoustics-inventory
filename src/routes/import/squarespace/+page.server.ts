import type { PageServerLoad } from './$types';
import { listProducts, SquarespaceError } from '$lib/server/squarespace';

/**
 * Diagnostic page for the Squarespace Commerce API.
 *
 * Pulls page 1 of products and reports what came back — explicitly does
 * NOT write anything to inventory. The point is to confirm:
 *
 *   1. The SQUARESPACE_API_KEY secret is reachable from the worker
 *   2. The key has at least Products read scope (no 401/403)
 *   3. Squarespace has products to import (count, sample, pagination)
 *
 * Once this page reports OK, the real importer is just plumbing on top
 * of `listProducts()` plus a few D1 inserts + R2 puts per item.
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

	try {
		const page = await listProducts(apiKey);
		const products = page.products ?? [];

		// Brief, non-destructive summary. Strip HTML from descriptions so
		// the preview is readable in the dark panel.
		const sample = products.slice(0, 5).map((p) => {
			const firstImage = p.images?.[0]?.url ?? null;
			const firstVariant = p.variants?.[0];
			const descriptionText = (p.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
			sample
		};
	} catch (err) {
		if (err instanceof SquarespaceError) {
			return {
				status: 'api_error',
				httpStatus: err.httpStatus,
				message: err.message,
				body: err.body.slice(0, 2000)
			};
		}
		return {
			status: 'network_error',
			message: err instanceof Error ? err.message : String(err)
		};
	}
};
