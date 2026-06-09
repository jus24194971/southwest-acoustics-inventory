import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/**
 * /items/[sku]/merge — duplicate picker.
 *
 * Lists candidate duplicates for `sku` (the "keeper"). Candidates are
 * found via a layered match:
 *
 *   1. Same category_id (always required — we never want to merge a
 *      Pickup into a Body).
 *   2. EITHER:
 *      - same brand_id + same model, OR
 *      - title similarity via case-insensitive LIKE on title tokens.
 *
 * The matcher is loose on purpose. Dad's duplicates are usually
 * obvious to a human ("Ivy IJZ-300 Sunburst" vs "IVY IJZ300 SUNBURST"),
 * but tricky for a strict matcher. The picker UI shows the candidate's
 * key fields side-by-side so the human can make the final call.
 *
 * Merged-away items (deleted_at + merged_into_item_id set) and the
 * keeper itself are excluded. Retired items are included — Dad might
 * have retired the duplicate by accident and want to fold it in.
 */

interface KeeperRow {
	id: number;
	sku: string;
	title: string;
	condition: string;
	category_id: number;
	brand_id: number | null;
	model: string | null;
	stock_qty: number;
	tracking_mode: 'serialized' | 'stocked';
	category_name: string;
	cat_code: string;
	brand_name: string | null;
}

interface CandidateRow {
	id: number;
	sku: string;
	title: string;
	condition: string;
	stock_qty: number;
	tracking_mode: 'serialized' | 'stocked';
	price_cents: number | null;
	created_at: string;
	updated_at: string;
	retired_at: string | null;
	photo_count: number;
	listing_count: number;
	thumb_r2_key: string | null;
	match_reason: string;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const sku = event.params.sku;

	const keeper = await db
		.prepare(
			`SELECT i.id, i.sku, i.title, i.condition, i.category_id, i.brand_id,
			        i.model, i.stock_qty, i.tracking_mode,
			        c.name AS category_name, c.code AS cat_code,
			        b.name AS brand_name
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 LEFT JOIN brand b ON b.id = i.brand_id
			 WHERE i.sku = ? AND i.deleted_at IS NULL`
		)
		.bind(sku)
		.first<KeeperRow>();
	if (!keeper) throw error(404, `No item with SKU ${sku}`);

	// Build a flexible WHERE that ORs the match strategies. The CASE
	// in the SELECT records which strategy matched for the UI so Dad
	// sees WHY each candidate was suggested.
	//
	// Title tokens are derived from the keeper's title by splitting on
	// whitespace and dropping noise words. We pre-compute up to 4
	// non-noise tokens; if any one of them appears in a candidate's
	// title, that's a "Title" match. Less precise than full FTS but
	// works without setting up FTS5 on D1.
	const NOISE_WORDS = new Set([
		'the',
		'and',
		'with',
		'for',
		'a',
		'of',
		'in',
		'guitar',
		'electric',
		'acoustic',
		'used',
		'new',
		'fully',
		'set',
		'up'
	]);
	const titleTokens = (keeper.title ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length >= 3 && !NOISE_WORDS.has(t))
		.slice(0, 4);

	const wheres: string[] = ['i.id != ?', 'i.deleted_at IS NULL', 'i.category_id = ?'];
	const binds: unknown[] = [keeper.id, keeper.category_id];

	const orParts: string[] = [];
	// Same brand+model is a strong signal.
	if (keeper.brand_id !== null && keeper.model) {
		orParts.push('(i.brand_id = ? AND LOWER(i.model) = LOWER(?))');
		binds.push(keeper.brand_id, keeper.model);
	}
	// Title token LIKE matches. We score the strongest reason in the
	// SELECT below so the UI sort makes sense.
	for (const tok of titleTokens) {
		orParts.push('LOWER(i.title) LIKE ?');
		binds.push(`%${tok}%`);
	}
	// If we somehow have zero OR clauses (no brand/model + no usable
	// title tokens), fall back to "same category" alone. Rare case
	// (item title is all noise words) but harmless.
	if (orParts.length > 0) {
		wheres.push(`(${orParts.join(' OR ')})`);
	}

	// Build a match-reason expression so the UI can show WHY each
	// candidate was suggested. Brand+model match beats title match.
	const titleMatchExprs = titleTokens.map(
		(t) => `INSTR(LOWER(i.title), ${JSON.stringify(t.toLowerCase())}) > 0`
	);
	const titleMatchExpr =
		titleMatchExprs.length > 0
			? `CASE WHEN (${titleMatchExprs.join(' OR ')}) THEN 'Title match' ELSE 'Same category' END`
			: `'Same category'`;
	const brandModelClause =
		keeper.brand_id !== null && keeper.model
			? `CASE WHEN i.brand_id = ${keeper.brand_id} AND LOWER(i.model) = LOWER(${JSON.stringify(keeper.model)})
			       THEN 'Brand + model' ELSE ${titleMatchExpr} END`
			: titleMatchExpr;

	const sql = `
		SELECT
			i.id, i.sku, i.title, i.condition, i.stock_qty, i.tracking_mode,
			i.price_cents, i.created_at, i.updated_at, i.retired_at,
			(SELECT COUNT(*) FROM item_photo p WHERE p.item_id = i.id AND p.deleted_at IS NULL) AS photo_count,
			(SELECT COUNT(*) FROM marketplace_listing ml WHERE ml.item_id = i.id) AS listing_count,
			(SELECT p.r2_key FROM item_photo p WHERE p.item_id = i.id AND p.deleted_at IS NULL
			 ORDER BY p.position, p.id LIMIT 1) AS thumb_r2_key,
			${brandModelClause} AS match_reason
		FROM item i
		WHERE ${wheres.join(' AND ')}
		ORDER BY
			CASE match_reason
				WHEN 'Brand + model' THEN 0
				WHEN 'Title match' THEN 1
				ELSE 2
			END,
			i.updated_at DESC
		LIMIT 50
	`;

	const { results } = await db.prepare(sql).bind(...binds).all<CandidateRow>();

	return {
		keeper,
		candidates: results,
		titleTokens
	};
};
