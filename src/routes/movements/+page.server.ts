import type { PageServerLoad } from './$types';
import { getDB } from '$lib/server/db';

interface MovementRow {
	id: number;
	kind: string;
	item_id: number;
	sku: string;
	title: string;
	from_bin: string | null;
	from_loc: string | null;
	to_bin: string | null;
	to_loc: string | null;
	note: string | null;
	reference: string | null;
	actor: string | null;
	created_at: string;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	// Most recent 500 movements with item title + SKU + from/to bin labels.
	// Pagination + filters (by item, date range, kind) come later — for
	// now this is the audit trail at a glance.
	const { results } = await db
		.prepare(
			`SELECT
				m.id,
				m.kind,
				m.item_id,
				i.sku,
				i.title,
				fb.code  AS from_bin,
				fl.code  AS from_loc,
				tb.code  AS to_bin,
				tl.code  AS to_loc,
				m.note,
				m.reference,
				m.actor,
				m.created_at
			 FROM movement m
			 JOIN item i ON i.id = m.item_id
			 LEFT JOIN bin fb       ON fb.id = m.from_bin_id
			 LEFT JOIN location fl  ON fl.id = fb.location_id
			 LEFT JOIN bin tb       ON tb.id = m.to_bin_id
			 LEFT JOIN location tl  ON tl.id = tb.location_id
			 ORDER BY m.created_at DESC, m.id DESC
			 LIMIT 500`
		)
		.all<MovementRow>();

	return { movements: results };
};
