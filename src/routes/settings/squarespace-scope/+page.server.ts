import type { PageServerLoad } from './$types';
import { getDB } from '$lib/server/db';

/**
 * /settings/squarespace-scope — diagnostic UI for poking at the SS API.
 *
 * Loads a few items that have a Squarespace external_id so the user
 * can pick one to GET raw (reveals undocumented fields like fulfillment
 * profile assignment, categories, ordering, etc.). The actual probing
 * happens client-side via POST to /api/debug/squarespace-scope.
 */

interface PushedItem {
	id: number;
	sku: string;
	title: string;
	external_id: string;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	const { results } = await db
		.prepare(
			`SELECT i.id, i.sku, i.title, l.external_id
			 FROM marketplace_listing l
			 JOIN item i ON i.id = l.item_id
			 WHERE l.platform = 'squarespace' AND l.external_id IS NOT NULL
			   AND i.deleted_at IS NULL
			 ORDER BY l.updated_at DESC
			 LIMIT 20`
		)
		.all<PushedItem>();

	return {
		pushedItems: results,
		hasApiKey: !!event.platform?.env?.SQUARESPACE_API_KEY
	};
};
