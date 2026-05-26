import type { PageServerLoad } from './$types';
import { getDB } from '$lib/server/db';

/**
 * /labels — receive workflow + label printing.
 *
 * Load: same shape as /items/new (categories with their attribute
 * labels + contexts, brands, bin tree, attribute values) plus the
 * available label templates so Dad can pick which DYMO label size
 * he's printing on.
 */

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	const [categories, brands, bins, attrValues, templates] = await db.batch([
		db.prepare(
			`SELECT id, code, name,
			        attr_1_label, attr_2_label, attr_3_label, attr_4_label, attr_5_label,
			        attr_1_context_key, attr_2_context_key, attr_3_context_key,
			        attr_4_context_key, attr_5_context_key
			 FROM category
			 ORDER BY name`
		),
		db.prepare(`SELECT id, code, name FROM brand ORDER BY name`),
		db.prepare(
			`WITH RECURSIVE bin_tree(id, parent_bin_id, code, name, depth, path) AS (
				SELECT b.id, b.parent_bin_id, b.code, b.name,
				       0 AS depth,
				       loc.code || ' / ' || b.code AS path
				FROM bin b
				JOIN location loc ON loc.id = b.location_id
				WHERE b.parent_bin_id IS NULL
				  AND b.deleted_at IS NULL AND loc.deleted_at IS NULL
				UNION ALL
				SELECT b.id, b.parent_bin_id, b.code, b.name,
				       bt.depth + 1,
				       bt.path || ' / ' || b.code
				FROM bin b
				JOIN bin_tree bt ON b.parent_bin_id = bt.id
				WHERE b.deleted_at IS NULL
			)
			SELECT id, code AS bin_code, depth, path FROM bin_tree ORDER BY path`
		),
		db.prepare(
			`SELECT id, context_key, code, label, sort_order
			 FROM attribute_value
			 WHERE is_active = 1
			 ORDER BY context_key, sort_order, label`
		),
		db.prepare(
			`SELECT code, display_name, width_mm, height_mm, is_default
			 FROM label_template
			 WHERE is_active = 1
			 ORDER BY is_default DESC, display_name`
		)
	]);

	return {
		categories: categories.results as Array<{
			id: number;
			code: string;
			name: string;
			attr_1_label: string | null;
			attr_2_label: string | null;
			attr_3_label: string | null;
			attr_4_label: string | null;
			attr_5_label: string | null;
			attr_1_context_key: string | null;
			attr_2_context_key: string | null;
			attr_3_context_key: string | null;
			attr_4_context_key: string | null;
			attr_5_context_key: string | null;
		}>,
		brands: brands.results as Array<{ id: number; code: string; name: string }>,
		bins: bins.results as Array<{ id: number; bin_code: string; depth: number; path: string }>,
		attrValues: attrValues.results as Array<{
			id: number;
			context_key: string;
			code: string;
			label: string;
			sort_order: number;
		}>,
		templates: templates.results as Array<{
			code: string;
			display_name: string;
			width_mm: number;
			height_mm: number;
			is_default: number;
		}>
	};
};
