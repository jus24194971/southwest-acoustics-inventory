import type { PageServerLoad } from './$types';
import { getDB } from '$lib/server/db';

interface CategoryRow {
	id: number;
	code: string;
	name: string;
	description: string | null;
	syncs_to_squarespace: number;
	item_count: number;
	on_hand_count: number;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	// One row per category with two counts: total items ever in this
	// category, and items currently on-hand (not retired, not soft-deleted).
	// `on_hand_count` is what Dad usually cares about; `item_count` is
	// useful for "we've moved a lot of pickups through here" perspective.
	const { results } = await db
		.prepare(
			`SELECT
				c.id, c.code, c.name, c.description, c.syncs_to_squarespace,
				COUNT(i.id) AS item_count,
				COUNT(CASE WHEN i.retired_at IS NULL AND i.deleted_at IS NULL THEN 1 END) AS on_hand_count
			 FROM category c
			 LEFT JOIN item i ON i.category_id = c.id
			 GROUP BY c.id, c.code, c.name, c.description, c.syncs_to_squarespace
			 ORDER BY c.name`
		)
		.all<CategoryRow>();

	return { categories: results };
};
