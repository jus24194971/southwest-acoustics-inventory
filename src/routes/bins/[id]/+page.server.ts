import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/**
 * /bins/[id] — what a bin's QR scan opens.
 *
 * Shows: the bin's full path (ancestor chain), its friendly name +
 * notes, every item currently in it (with quick links into each
 * item's detail page), and quick navigation back to the parent
 * bin / location.
 *
 * Doesn't have actions of its own — adding / transferring lives on
 * the item pages. This is the "what's in this drawer?" screen.
 */

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const id = parseInt(event.params.id, 10);
	if (!Number.isInteger(id)) throw error(404);

	const bin = await db
		.prepare(
			`WITH RECURSIVE bin_path(id, parent_bin_id, location_id, code, name, notes, path) AS (
				SELECT b.id, b.parent_bin_id, b.location_id, b.code, b.name, b.notes,
				       loc.code || ' / ' || b.code AS path
				FROM bin b
				JOIN location loc ON loc.id = b.location_id
				WHERE b.id = ? AND b.deleted_at IS NULL

				UNION ALL

				SELECT parent.id, parent.parent_bin_id, parent.location_id,
				       parent.code, parent.name, parent.notes,
				       loc.code || ' / ' || parent.code || ' / ' ||
				         substr(bp.path, instr(bp.path, ' / ') + 3)
				FROM bin parent
				JOIN bin_path bp ON parent.id = bp.parent_bin_id
				JOIN location loc ON loc.id = parent.location_id
				WHERE parent.deleted_at IS NULL
			)
			SELECT id, parent_bin_id, location_id, code, name, notes, path
			FROM bin_path
			WHERE parent_bin_id IS NULL`
		)
		.bind(id)
		.first<{
			id: number;
			parent_bin_id: number | null;
			location_id: number;
			code: string;
			name: string | null;
			notes: string | null;
			path: string;
		}>();
	if (!bin) throw error(404, `Bin ${id} not found`);

	// We want the *immediate* parent for the back link too, not the
	// root from the recursive CTE. Easier as a second cheap query.
	const meta = await db
		.prepare(
			`SELECT b.parent_bin_id, b.location_id, loc.code AS loc_code, loc.name AS loc_name
			 FROM bin b
			 JOIN location loc ON loc.id = b.location_id
			 WHERE b.id = ?`
		)
		.bind(id)
		.first<{
			parent_bin_id: number | null;
			location_id: number;
			loc_code: string;
			loc_name: string;
		}>();

	const [items, children] = await db.batch([
		db
			.prepare(
				`SELECT i.id, i.sku, i.title, i.condition, i.tracking_mode, i.stock_qty,
				        c.code AS cat_code, c.name AS cat_name
				 FROM item i
				 JOIN category c ON c.id = i.category_id
				 WHERE i.current_bin_id = ?
				   AND i.retired_at IS NULL AND i.deleted_at IS NULL
				 ORDER BY i.title`
			)
			.bind(id),

		// Direct children (one level down) for "what's nested in here"
		db
			.prepare(
				`SELECT id, code, name FROM bin
				 WHERE parent_bin_id = ? AND deleted_at IS NULL
				 ORDER BY code`
			)
			.bind(id)
	]);

	return {
		bin,
		meta: meta ?? {
			parent_bin_id: null,
			location_id: bin.location_id,
			loc_code: '',
			loc_name: ''
		},
		items: items.results as Array<{
			id: number;
			sku: string;
			title: string;
			condition: string;
			tracking_mode: 'serialized' | 'stocked';
			stock_qty: number;
			cat_code: string;
			cat_name: string;
		}>,
		children: children.results as Array<{ id: number; code: string; name: string | null }>
	};
};
