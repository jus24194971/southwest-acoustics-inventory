import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { getItemAspectsForCategory, EbayError } from '$lib/server/ebay';
import { resolveItemAttributes } from '$lib/server/item_attributes';
import { mapItemToAspects } from '$lib/server/ebay_aspect_mapper';

/**
 * GET /api/listings/<item_id>/ebay/aspects?category=<categoryId>
 *
 * Returns the eBay aspect list for a category, auto-mapped against
 * this item's data (brand, model, attribute slots). The editor calls
 * this on first load AND whenever the category changes, then renders
 * the returned aspects as dynamic fields.
 *
 * Response:
 *   {
 *     categoryId: string,
 *     mappings: AspectMapping[],   // aspect meta + our suggested value
 *     autoFilledCount: number,     // how many we pre-filled
 *     requiredCount: number
 *   }
 *
 * Errors:
 *   400 if no category / eBay app token not configured
 *   502 on eBay API failure (surfaced so the UI can show "couldn't
 *       load specifics, type the category and retry")
 *
 * App token is sufficient (read-only taxonomy) — this works the
 * moment EBAY_CLIENT_ID + EBAY_CLIENT_SECRET are set, before the
 * user/OAuth token exists.
 */

export const GET: RequestHandler = async (event) => {
	const env = event.platform?.env;
	if (!env?.EBAY_CLIENT_ID || !env?.EBAY_CLIENT_SECRET) {
		throw error(
			400,
			'eBay app credentials not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET). Item specifics need the eBay taxonomy API.'
		);
	}

	const itemId = parseInt(event.params.item_id, 10);
	if (!Number.isInteger(itemId)) throw error(400, 'Bad item id');

	const categoryId = (event.url.searchParams.get('category') ?? '').trim();
	if (!categoryId) throw error(400, 'category query param is required');

	const db = getDB(event);

	// Item header for brand/model/title. (Attributes come via the
	// shared resolver below.)
	const item = await db
		.prepare(
			`SELECT i.title, i.model, b.name AS brand_name
			 FROM item i
			 LEFT JOIN brand b ON b.id = i.brand_id
			 WHERE i.id = ? AND i.deleted_at IS NULL`
		)
		.bind(itemId)
		.first<{ title: string; model: string | null; brand_name: string | null }>();
	if (!item) throw error(404, `Item ${itemId} not found`);

	const attributes = await resolveItemAttributes(db, itemId);

	try {
		const aspects = await getItemAspectsForCategory(env, categoryId);
		const mappings = mapItemToAspects(aspects, {
			brand: item.brand_name,
			model: item.model,
			title: item.title,
			attributes
		});

		const autoFilledCount = mappings.filter((m) => m.suggestedValue != null).length;
		const requiredCount = mappings.filter((m) => m.aspect.required).length;

		return json({ categoryId, mappings, autoFilledCount, requiredCount });
	} catch (err) {
		if (err instanceof EbayError) {
			throw error(
				502,
				`eBay taxonomy lookup failed (HTTP ${err.httpStatus}). The category id may be invalid. ${err.body.slice(0, 200)}`
			);
		}
		throw error(500, err instanceof Error ? err.message : String(err));
	}
};
