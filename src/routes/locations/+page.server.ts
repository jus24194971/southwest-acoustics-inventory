import type { PageServerLoad } from './$types';
import { getDB } from '$lib/server/db';

interface LocationRow {
	id: number;
	code: string;
	name: string;
	bin_count: number;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	// Locations + a denormalized bin count. The full bins-under-location
	// editor lands in /locations/[id] in a follow-up commit.
	const { results } = await db
		.prepare(
			`SELECT
				loc.id, loc.code, loc.name,
				COUNT(bin.id) AS bin_count
			 FROM location loc
			 LEFT JOIN bin ON bin.location_id = loc.id AND bin.deleted_at IS NULL
			 WHERE loc.deleted_at IS NULL
			 GROUP BY loc.id, loc.code, loc.name
			 ORDER BY loc.code`
		)
		.all<LocationRow>();

	return { locations: results };
};
