import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { listProducts, deleteProduct, SquarespaceError } from '$lib/server/squarespace';

/**
 * Duplicate Squarespace listing cleanup.
 *
 * Earlier pushes that crashed mid-flight (the in-Worker photo transcode
 * blowing the resource limit AFTER createProduct succeeded but BEFORE we
 * saved the link) left ORPHAN duplicate products on Squarespace. This
 * tool finds them and lets Dad delete the extras.
 *
 * How we detect duplicates: we scan every SS product and group by the
 * variant SKU. Because we stamp our unique item SKU onto every product
 * we create, any SKU that appears on 2+ products is a duplicate set we
 * made. (Grouping by SKU, not by name/slug, is exact and safe.)
 *
 * The scan is paginated and capped so a big catalog can't run past the
 * Worker subrequest budget; if we hit the cap we say so.
 */

const MAX_SCAN_PAGES = 40;

interface DupProduct {
	id: string;
	name: string;
	url: string | null;
	imageCount: number;
	variantSku: string;
	modifiedOn: string;
	linkedItemSku: string | null;
	linkedItemTitle: string | null;
	recommendedKeep: boolean;
}

interface DupGroup {
	sku: string;
	products: DupProduct[];
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
	if (!apiKey) {
		return {
			groups: [] as DupGroup[],
			scanned: 0,
			pagesScanned: 0,
			capped: false,
			error: 'SQUARESPACE_API_KEY is not configured on this environment.'
		};
	}

	// Scan all products, bucketed by the first variant's SKU.
	const bySku = new Map<
		string,
		Array<{ id: string; name: string; url: string | null; imageCount: number; modifiedOn: string }>
	>();
	let cursor: string | undefined;
	let pagesScanned = 0;
	let scanned = 0;
	let capped = false;
	let error: string | null = null;

	try {
		for (let page = 0; page < MAX_SCAN_PAGES; page++) {
			const resp = await listProducts(apiKey, cursor ? { cursor } : {});
			pagesScanned++;
			for (const p of resp.products ?? []) {
				scanned++;
				const sku = (p.variants?.[0]?.sku ?? '').trim();
				if (!sku) continue; // products without a SKU can't be matched safely
				const entry = {
					id: p.id,
					name: p.name,
					url: p.url ?? null,
					imageCount: p.images?.length ?? 0,
					modifiedOn: p.modifiedOn ?? p.createdOn ?? ''
				};
				const list = bySku.get(sku);
				if (list) list.push(entry);
				else bySku.set(sku, [entry]);
			}
			if (!resp.pagination?.hasNextPage || !resp.pagination.nextPageCursor) break;
			cursor = resp.pagination.nextPageCursor;
			if (page === MAX_SCAN_PAGES - 1) capped = true;
		}
	} catch (err) {
		error =
			err instanceof SquarespaceError
				? `Squarespace HTTP ${err.httpStatus}: ${err.body.slice(0, 200)}`
				: err instanceof Error
					? err.message
					: String(err);
	}

	// Keep only the SKUs that have more than one product = duplicates.
	const dupSkus = [...bySku.entries()].filter(([, list]) => list.length > 1);

	// Map every duplicate product id → the item it's linked to (if any),
	// so we can label the linked copy and default to KEEPING it.
	const allDupIds = dupSkus.flatMap(([, list]) => list.map((p) => p.id));
	const linkByProductId = new Map<string, { sku: string; title: string }>();
	if (allDupIds.length > 0) {
		// D1 has a ~100 bound-param ceiling per statement; chunk to be safe.
		for (let i = 0; i < allDupIds.length; i += 90) {
			const chunk = allDupIds.slice(i, i + 90);
			const placeholders = chunk.map(() => '?').join(',');
			const { results } = await db
				.prepare(
					`SELECT ml.external_id, i.sku, i.title
					 FROM marketplace_listing ml
					 JOIN item i ON i.id = ml.item_id
					 WHERE ml.platform = 'squarespace' AND ml.external_id IN (${placeholders})`
				)
				.bind(...chunk)
				.all<{ external_id: string; sku: string; title: string }>();
			for (const r of results) linkByProductId.set(r.external_id, { sku: r.sku, title: r.title });
		}
	}

	const groups: DupGroup[] = dupSkus.map(([sku, list]) => {
		// Pick the keeper: the linked product if exactly one is linked;
		// otherwise the one with the most images; tie-break on newest.
		const linked = list.filter((p) => linkByProductId.has(p.id));
		let keeperId: string;
		if (linked.length === 1) {
			keeperId = linked[0].id;
		} else {
			const sorted = [...list].sort(
				(a, b) => b.imageCount - a.imageCount || b.modifiedOn.localeCompare(a.modifiedOn)
			);
			keeperId = sorted[0].id;
		}

		const products: DupProduct[] = list
			.map((p) => {
				const link = linkByProductId.get(p.id);
				return {
					id: p.id,
					name: p.name,
					url: p.url,
					imageCount: p.imageCount,
					variantSku: sku,
					modifiedOn: p.modifiedOn,
					linkedItemSku: link?.sku ?? null,
					linkedItemTitle: link?.title ?? null,
					recommendedKeep: p.id === keeperId
				};
			})
			// Keeper first, then most-complete copies.
			.sort(
				(a, b) =>
					Number(b.recommendedKeep) - Number(a.recommendedKeep) ||
					b.imageCount - a.imageCount
			);

		return { sku, products };
	});

	// Stable order: most-duplicated first, then by SKU.
	groups.sort((a, b) => b.products.length - a.products.length || a.sku.localeCompare(b.sku));

	return { groups, scanned, pagesScanned, capped, error };
};

export const actions: Actions = {
	delete: async (event) => {
		const db = getDB(event);
		const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
		if (!apiKey) return fail(400, { deleteError: 'SQUARESPACE_API_KEY not configured.' });

		const form = await event.request.formData();
		const ids = form.getAll('delete_id').map((v) => v.toString()).filter(Boolean);
		if (ids.length === 0) {
			return fail(400, { deleteError: 'Nothing selected to delete.' });
		}

		let deleted = 0;
		const errors: string[] = [];
		for (const id of ids) {
			try {
				await deleteProduct(apiKey, id);
				deleted++;
				// If this product was linked to an item, blank the link so we
				// don't keep pointing at a now-deleted product. The next push
				// re-adopts a surviving copy by SKU automatically.
				await db
					.prepare(
						`UPDATE marketplace_listing
						 SET external_id = NULL, external_variant_id = NULL, external_url = NULL,
						     updated_at = datetime('now')
						 WHERE platform = 'squarespace' AND external_id = ?`
					)
					.bind(id)
					.run();
			} catch (err) {
				const msg =
					err instanceof SquarespaceError
						? `HTTP ${err.httpStatus}`
						: err instanceof Error
							? err.message
							: String(err);
				errors.push(`${id}: ${msg}`);
			}
		}

		const params = new URLSearchParams({ deleted: String(deleted) });
		if (errors.length > 0) params.set('delete_errors', errors.slice(0, 3).join(' · '));
		throw redirect(303, `/listings/cleanup?${params.toString()}`);
	}
};
