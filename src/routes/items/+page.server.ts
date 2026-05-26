import type { PageServerLoad } from './$types';
import { getDB } from '$lib/server/db';

interface ItemRow {
	id: number;
	sku: string;
	title: string;
	condition: string;
	category_name: string;
	brand_name: string | null;
	bin_code: string | null;
	location_code: string | null;
	price_cents: number | null;
	retired_at: string | null;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	const { results } = await db
		.prepare(
			`SELECT
				i.id,
				i.sku,
				i.title,
				i.condition,
				c.name        AS category_name,
				b.name        AS brand_name,
				bin.code      AS bin_code,
				loc.code      AS location_code,
				i.price_cents,
				i.retired_at
			 FROM item i
			 JOIN category c        ON c.id = i.category_id
			 LEFT JOIN brand b      ON b.id = i.brand_id
			 LEFT JOIN bin          ON bin.id = i.current_bin_id
			 LEFT JOIN location loc ON loc.id = bin.location_id
			 WHERE i.deleted_at IS NULL
			 ORDER BY i.created_at DESC
			 LIMIT 200`
		)
		.all<ItemRow>();

	return { items: results };
};
