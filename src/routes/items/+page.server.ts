import type { PageServerLoad } from './$types';
import { getDB } from '$lib/server/db';

/**
 * Items list with search + filters.
 *
 * URL query params (all optional, all combinable):
 *   q          — full-text-ish search across sku/title/description/model/brand
 *   category   — category code (e.g. "PU") or numeric id
 *   condition  — N | U | R | B
 *   location   — location code (e.g. "GAR") or numeric id
 *   bin        — numeric bin id (exact match)
 *   tracking   — "serialized" | "stocked"
 *   retired    — "1" to include retired items (default: hide them)
 *   has_photo  — "1" to only show items with at least one photo
 *   sort       — column to sort by; see SORT_COLUMNS below for the
 *                whitelist. Default "modified".
 *   dir        — "asc" | "desc". Default depends on the column
 *                (numeric / date columns default to desc; text to asc).
 *
 * Returns the matching items plus the applied-filter context so the
 * page can render removable chips and resolve filter-label display.
 */

interface ItemRow {
	id: number;
	sku: string;
	title: string;
	condition: string;
	category_id: number;
	category_name: string;
	cat_code: string;
	brand_name: string | null;
	bin_code: string | null;
	location_code: string | null;
	price_cents: number | null;
	tracking_mode: 'serialized' | 'stocked';
	stock_qty: number;
	retired_at: string | null;
	updated_at: string;
	thumb_r2_key: string | null;
}

// Whitelist of sortable columns. Maps the URL-friendly `sort` value
// to a SQL ORDER BY clause AND a default direction. The default dir
// is what makes the first click on a fresh column produce the "most
// useful" view — newest dates first, biggest prices first, A→Z for
// text. Subsequent clicks toggle the direction.
//
// Direction is applied as a suffix so we never interpolate user input
// into the ORDER BY clause. The `extra` clause adds a stable tiebreaker
// (id) so pagination would be deterministic if we ever add it.
const SORT_COLUMNS: Record<
	string,
	{ expr: string; defaultDir: 'asc' | 'desc'; label: string }
> = {
	sku: { expr: 'i.sku', defaultDir: 'asc', label: 'SKU' },
	title: { expr: 'i.title', defaultDir: 'asc', label: 'Title' },
	category: { expr: 'c.name', defaultDir: 'asc', label: 'Category' },
	condition: { expr: 'i.condition', defaultDir: 'asc', label: 'Condition' },
	// Location sort: by location_code first, then bin_code so the bins
	// within a location group together. NULLs (unassigned items) fall
	// to the end on asc — SQLite's NULLs-first default; we flip with
	// `loc.code IS NULL` to push them to the bottom on asc, to the top
	// on desc (consistent "rare/empty values last on the natural view").
	location: {
		expr: 'loc.code IS NULL, loc.code, bin.code',
		defaultDir: 'asc',
		label: 'Where'
	},
	qty: { expr: 'i.stock_qty', defaultDir: 'desc', label: 'Qty' },
	// Price: NULL prices fall to the end. Same rationale as location —
	// "no price set" is the rare/empty case.
	price: {
		expr: 'i.price_cents IS NULL, i.price_cents',
		defaultDir: 'desc',
		label: 'Price'
	},
	modified: { expr: 'i.updated_at', defaultDir: 'desc', label: 'Modified' },
	created: { expr: 'i.created_at', defaultDir: 'desc', label: 'Created' }
};

/** The fallback sort when no ?sort= is provided. "modified desc" puts
 *  recently-edited items at the top, which is the most useful default
 *  for Dad's "what did I just touch?" workflow. */
const DEFAULT_SORT = 'modified';

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const url = event.url;

	const q = (url.searchParams.get('q') ?? '').trim();
	const categoryFilter = (url.searchParams.get('category') ?? '').trim();
	const conditionFilter = (url.searchParams.get('condition') ?? '').trim();
	const locationFilter = (url.searchParams.get('location') ?? '').trim();
	const binFilter = (url.searchParams.get('bin') ?? '').trim();
	const trackingFilter = (url.searchParams.get('tracking') ?? '').trim();
	const includeRetired = url.searchParams.get('retired') === '1';
	const onlyHasPhoto = url.searchParams.get('has_photo') === '1';

	// Sort: validate against the whitelist; fall back to the default if
	// the user typed garbage. dir defaults to whatever the column says
	// is the most useful first-click direction.
	const sortRequested = (url.searchParams.get('sort') ?? '').trim().toLowerCase();
	const sortKey = SORT_COLUMNS[sortRequested] ? sortRequested : DEFAULT_SORT;
	const sortDef = SORT_COLUMNS[sortKey];
	const dirRequested = (url.searchParams.get('dir') ?? '').trim().toLowerCase();
	const sortDir: 'asc' | 'desc' =
		dirRequested === 'asc' || dirRequested === 'desc'
			? (dirRequested as 'asc' | 'desc')
			: sortDef.defaultDir;

	// Build the WHERE clause dynamically. Every condition is parameterised.
	const wheres: string[] = ['i.deleted_at IS NULL'];
	const binds: unknown[] = [];

	if (!includeRetired) wheres.push('i.retired_at IS NULL');

	if (q) {
		// Search across SKU, title, description, model, plus brand name
		// via the joined brand table. Wrap each LIKE in lower() so the
		// match is case-insensitive without forcing a fancy collation.
		// NOTE: alias `b` matches the LEFT JOIN below — not `br`. SQLite
		// throws "no such column: br.name" otherwise (a previous version
		// used `br` here and bricked the global search).
		wheres.push(
			`(LOWER(i.sku) LIKE ? OR LOWER(i.title) LIKE ? OR LOWER(COALESCE(i.description,'')) LIKE ? OR LOWER(COALESCE(i.model,'')) LIKE ? OR LOWER(COALESCE(b.name,'')) LIKE ?)`
		);
		const needle = `%${q.toLowerCase()}%`;
		binds.push(needle, needle, needle, needle, needle);
	}

	if (categoryFilter) {
		// Accept either a numeric id or a category code (e.g. PU, BD).
		if (/^\d+$/.test(categoryFilter)) {
			wheres.push('i.category_id = ?');
			binds.push(parseInt(categoryFilter, 10));
		} else {
			wheres.push('c.code = ?');
			binds.push(categoryFilter.toUpperCase());
		}
	}

	if (conditionFilter && ['N', 'U', 'R', 'B'].includes(conditionFilter)) {
		wheres.push('i.condition = ?');
		binds.push(conditionFilter);
	}

	if (locationFilter) {
		if (/^\d+$/.test(locationFilter)) {
			wheres.push('loc.id = ?');
			binds.push(parseInt(locationFilter, 10));
		} else {
			wheres.push('loc.code = ?');
			binds.push(locationFilter.toUpperCase());
		}
	}

	if (binFilter && /^\d+$/.test(binFilter)) {
		wheres.push('i.current_bin_id = ?');
		binds.push(parseInt(binFilter, 10));
	}

	if (trackingFilter === 'serialized' || trackingFilter === 'stocked') {
		wheres.push('i.tracking_mode = ?');
		binds.push(trackingFilter);
	}

	if (onlyHasPhoto) {
		wheres.push(`EXISTS (SELECT 1 FROM item_photo ip2 WHERE ip2.item_id = i.id AND ip2.deleted_at IS NULL)`);
	}

	const whereSql = wheres.join(' AND ');

	// Correlated subquery for the first photo's R2 key per item.
	// SQLite handles this fine at our scale; if we ever scrape past
	// 10K items we'd swap for a denormalised cache.
	// Compose ORDER BY from the whitelisted column expression + direction.
	// `expr` can be a comma-separated list (location: "loc.code IS NULL,
	// loc.code, bin.code"); the dir suffix only applies to the last
	// term, which is fine — the leading NULL-flag terms are already in
	// the right order to push NULLs to the end on asc / top on desc.
	// Always append id as a stable tiebreaker for deterministic order.
	const orderBy = `${sortDef.expr} ${sortDir === 'desc' ? 'DESC' : 'ASC'}, i.id ${sortDir === 'desc' ? 'DESC' : 'ASC'}`;

	const sql = `
		SELECT
			i.id,
			i.sku,
			i.title,
			i.condition,
			i.category_id,
			c.name        AS category_name,
			c.code        AS cat_code,
			b.name        AS brand_name,
			bin.code      AS bin_code,
			loc.code      AS location_code,
			i.price_cents,
			i.tracking_mode,
			i.stock_qty,
			i.retired_at,
			i.updated_at,
			(SELECT ip.r2_key
			 FROM item_photo ip
			 WHERE ip.item_id = i.id AND ip.deleted_at IS NULL
			 ORDER BY ip.position, ip.id
			 LIMIT 1) AS thumb_r2_key
		FROM item i
		JOIN category c        ON c.id = i.category_id
		LEFT JOIN brand b      ON b.id = i.brand_id
		LEFT JOIN bin          ON bin.id = i.current_bin_id
		LEFT JOIN location loc ON loc.id = bin.location_id
		WHERE ${whereSql}
		ORDER BY ${orderBy}
		LIMIT 500
	`;

	const { results } = await db.prepare(sql).bind(...binds).all<ItemRow>();

	// Also load the lookup data the filter UI needs (categories + locations).
	const [cats, locs] = await db.batch([
		db.prepare(`SELECT id, code, name FROM category ORDER BY name`),
		db.prepare(`SELECT id, code, name FROM location WHERE deleted_at IS NULL ORDER BY code`)
	]);

	return {
		items: results,
		filters: {
			q,
			category: categoryFilter,
			condition: conditionFilter,
			location: locationFilter,
			bin: binFilter,
			tracking: trackingFilter,
			retired: includeRetired,
			has_photo: onlyHasPhoto
		},
		sort: {
			key: sortKey,
			dir: sortDir,
			isDefault: sortKey === DEFAULT_SORT && !url.searchParams.get('dir')
		},
		categories: cats.results as Array<{ id: number; code: string; name: string }>,
		locations: locs.results as Array<{ id: number; code: string; name: string }>,
		// True when at least one filter is active — drives the "X results / clear all" UI.
		anyFilterActive: !!(
			q ||
			categoryFilter ||
			conditionFilter ||
			locationFilter ||
			binFilter ||
			trackingFilter ||
			includeRetired ||
			onlyHasPhoto
		)
	};
};
