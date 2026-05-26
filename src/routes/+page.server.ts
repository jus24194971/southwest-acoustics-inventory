import type { PageServerLoad } from './$types';
import { getDB } from '$lib/server/db';

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	// Four small COUNTs in parallel. D1 batches these into one round-trip
	// when called via `db.batch()` — handy because edge round-trips to
	// the database, while short, add up if we ever go over the free tier.
	const [items, locations, categories, movements] = await db.batch([
		db.prepare(`SELECT COUNT(*) AS n FROM item WHERE retired_at IS NULL AND deleted_at IS NULL`),
		db.prepare(`SELECT COUNT(*) AS n FROM location WHERE deleted_at IS NULL`),
		db.prepare(`SELECT COUNT(*) AS n FROM category`),
		db.prepare(`SELECT COUNT(*) AS n FROM movement`)
	]);

	return {
		stats: {
			itemsOnHand: (items.results[0] as { n: number }).n,
			locations: (locations.results[0] as { n: number }).n,
			categories: (categories.results[0] as { n: number }).n,
			movements: (movements.results[0] as { n: number }).n
		}
	};
};
