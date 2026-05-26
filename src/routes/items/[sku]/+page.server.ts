import type { Actions, PageServerLoad } from './$types';
import type { D1Database } from '@cloudflare/workers-types';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { isCondition } from '$lib/server/sku';

/**
 * Item detail page — the screen Dad spends most of his time on.
 *
 * Read side: the item itself, joined to category + current bin + location.
 * Then its photos (ordered by position), its full movement history, and
 * two reference datasets the action forms need (all bins, all categories).
 *
 * Write side: five named form actions, each posting to the same SKU page:
 *   - edit          → title, description, condition, price/cost
 *   - changeCategory → category_id (no movement, pure metadata)
 *   - transfer      → record a 'transfer' movement, refresh current_bin_id
 *   - retire        → record sale/scrap/used_in_build, set retired_at
 *   - unretire      → bring back an accidentally-retired item
 *
 * Each action redirects back to the page on success so a refresh shows
 * the new state. Errors are returned via fail() so the page can show
 * an inline message.
 */

interface ItemRow {
	id: number;
	sku: string;
	title: string;
	description: string | null;
	description_html: string | null;
	category_id: number;
	cat_code: string;
	cat_name: string;
	brand_id: number | null;
	brand_code: string | null;
	brand_name: string | null;
	model: string | null;
	condition: string;
	year_received: number;
	cost_cents: number | null;
	price_cents: number | null;
	current_bin_id: number | null;
	bin_code: string | null;
	loc_code: string | null;
	loc_name: string | null;
	retired_at: string | null;
	retired_reason: string | null;
	squarespace_product_id: string | null;
	squarespace_variant_id: string | null;
	squarespace_sku: string | null;
	squarespace_synced_at: string | null;
	created_at: string;
	updated_at: string;
}

interface PhotoRow {
	id: number;
	r2_key: string;
	source_url: string | null;
	position: number;
	alt_text: string | null;
	width: number | null;
	height: number | null;
	bytes: number | null;
	content_type: string | null;
}

interface MovementRow {
	id: number;
	kind: string;
	from_bin: string | null;
	from_loc: string | null;
	to_bin: string | null;
	to_loc: string | null;
	note: string | null;
	reference: string | null;
	actor: string | null;
	created_at: string;
}

async function loadItemBySku(db: D1Database, sku: string) {
	const item = await db
		.prepare(
			`SELECT
				i.*,
				c.code  AS cat_code,
				c.name  AS cat_name,
				br.code AS brand_code,
				br.name AS brand_name,
				bin.code AS bin_code,
				loc.code AS loc_code,
				loc.name AS loc_name
			 FROM item i
			 JOIN category c       ON c.id = i.category_id
			 LEFT JOIN brand br    ON br.id = i.brand_id
			 LEFT JOIN bin         ON bin.id = i.current_bin_id
			 LEFT JOIN location loc ON loc.id = bin.location_id
			 WHERE i.sku = ? AND i.deleted_at IS NULL`
		)
		.bind(sku)
		.first<ItemRow>();
	return item;
}

export const load: PageServerLoad = async (event) => {
	const sku = event.params.sku;
	const db = getDB(event);

	const item = await loadItemBySku(db, sku);
	if (!item) throw error(404, `No item with SKU ${sku}`);

	// Run the four read queries in one D1 batch round-trip.
	const [photos, movements, bins, categories] = await db.batch([
		db
			.prepare(
				`SELECT id, r2_key, source_url, position, alt_text, width, height, bytes, content_type
				 FROM item_photo
				 WHERE item_id = ? AND deleted_at IS NULL
				 ORDER BY position, id`
			)
			.bind(item.id),

		db
			.prepare(
				`SELECT
					m.id, m.kind,
					fb.code  AS from_bin,
					fl.code  AS from_loc,
					tb.code  AS to_bin,
					tl.code  AS to_loc,
					m.note, m.reference, m.actor, m.created_at
				 FROM movement m
				 LEFT JOIN bin fb       ON fb.id = m.from_bin_id
				 LEFT JOIN location fl  ON fl.id = fb.location_id
				 LEFT JOIN bin tb       ON tb.id = m.to_bin_id
				 LEFT JOIN location tl  ON tl.id = tb.location_id
				 WHERE m.item_id = ?
				 ORDER BY m.created_at DESC, m.id DESC`
			)
			.bind(item.id),

		db.prepare(
			`SELECT bin.id, bin.code AS bin_code, loc.code AS loc_code, loc.name AS loc_name
			 FROM bin
			 JOIN location loc ON loc.id = bin.location_id
			 WHERE bin.deleted_at IS NULL AND loc.deleted_at IS NULL
			 ORDER BY loc.code, bin.code`
		),

		db.prepare(`SELECT id, code, name FROM category ORDER BY name`)
	]);

	return {
		item,
		photos: photos.results as PhotoRow[],
		movements: movements.results as MovementRow[],
		bins: bins.results as Array<{
			id: number;
			bin_code: string;
			loc_code: string;
			loc_name: string;
		}>,
		categories: categories.results as Array<{ id: number; code: string; name: string }>
	};
};

// ============================================================
// Form actions
// ============================================================

export const actions: Actions = {
	edit: async (event) => {
		const db = getDB(event);
		const item = await loadItemBySku(db, event.params.sku);
		if (!item) throw error(404);

		const form = await event.request.formData();
		const title = (form.get('title') ?? '').toString().trim();
		const description = (form.get('description') ?? '').toString().trim();
		const descriptionHtml = (form.get('description_html') ?? '').toString();
		const condition = (form.get('condition') ?? '').toString();
		const costStr = form.get('cost')?.toString().trim();
		const priceStr = form.get('price')?.toString().trim();

		const errors: Record<string, string> = {};
		if (!title) errors.title = 'Title is required.';
		if (!isCondition(condition)) errors.condition = 'Pick a valid condition.';
		if (Object.keys(errors).length > 0) {
			return fail(400, { editErrors: errors });
		}

		const costCents = costStr ? Math.round(parseFloat(costStr) * 100) : null;
		const priceCents = priceStr ? Math.round(parseFloat(priceStr) * 100) : null;

		await db
			.prepare(
				`UPDATE item
				 SET title = ?, description = ?, description_html = ?,
				     condition = ?, cost_cents = ?, price_cents = ?,
				     updated_at = datetime('now')
				 WHERE id = ?`
			)
			.bind(
				title,
				description || null,
				descriptionHtml || null,
				condition,
				costCents,
				priceCents,
				item.id
			)
			.run();

		throw redirect(303, `/items/${item.sku}`);
	},

	changeCategory: async (event) => {
		const db = getDB(event);
		const item = await loadItemBySku(db, event.params.sku);
		if (!item) throw error(404);

		const newCatId = parseInt((await event.request.formData()).get('category_id')?.toString() ?? '', 10);
		if (!Number.isInteger(newCatId)) return fail(400, { actionError: 'Pick a category.' });

		await db
			.prepare(`UPDATE item SET category_id = ?, updated_at = datetime('now') WHERE id = ?`)
			.bind(newCatId, item.id)
			.run();

		throw redirect(303, `/items/${item.sku}`);
	},

	transfer: async (event) => {
		const db = getDB(event);
		const item = await loadItemBySku(db, event.params.sku);
		if (!item) throw error(404);

		const form = await event.request.formData();
		const toBinIdRaw = form.get('bin_id')?.toString();
		const note = form.get('note')?.toString().trim() || null;
		const toBinId = toBinIdRaw ? parseInt(toBinIdRaw, 10) : null;

		if (toBinId !== null && !Number.isInteger(toBinId)) {
			return fail(400, { actionError: 'Bad bin id.' });
		}

		// Two writes in a batch: insert the movement row, update the
		// denormalized current_bin_id cache.
		await db.batch([
			db
				.prepare(
					`INSERT INTO movement (item_id, kind, from_bin_id, to_bin_id, note, actor)
					 VALUES (?, 'transfer', ?, ?, ?, ?)`
				)
				.bind(
					item.id,
					item.current_bin_id,
					toBinId,
					note,
					event.locals?.userEmail ?? 'system'
				),

			db
				.prepare(`UPDATE item SET current_bin_id = ?, updated_at = datetime('now') WHERE id = ?`)
				.bind(toBinId, item.id)
		]);

		throw redirect(303, `/items/${item.sku}`);
	},

	retire: async (event) => {
		const db = getDB(event);
		const item = await loadItemBySku(db, event.params.sku);
		if (!item) throw error(404);

		const form = await event.request.formData();
		const reason = (form.get('reason') ?? '').toString();
		const note = form.get('note')?.toString().trim() || null;

		// The reason maps to a movement kind:
		//   sold → 'sale', scrap → 'scrap', used_in_build → 'build_consume'
		const kind =
			reason === 'sold' ? 'sale' : reason === 'scrap' ? 'scrap' : reason === 'used_in_build' ? 'build_consume' : null;
		if (!kind) {
			return fail(400, { actionError: 'Pick a retirement reason.' });
		}
		if (item.retired_at) {
			return fail(400, { actionError: 'Item is already retired.' });
		}

		await db.batch([
			db
				.prepare(
					`INSERT INTO movement (item_id, kind, from_bin_id, note, actor)
					 VALUES (?, ?, ?, ?, ?)`
				)
				.bind(item.id, kind, item.current_bin_id, note, event.locals?.userEmail ?? 'system'),

			db
				.prepare(
					`UPDATE item
					 SET retired_at = datetime('now'), retired_reason = ?,
					     current_bin_id = NULL,
					     updated_at = datetime('now')
					 WHERE id = ?`
				)
				.bind(reason, item.id)
		]);

		throw redirect(303, `/items/${item.sku}`);
	},

	unretire: async (event) => {
		const db = getDB(event);
		const item = await loadItemBySku(db, event.params.sku);
		if (!item) throw error(404);
		if (!item.retired_at) return fail(400, { actionError: 'Item is not retired.' });

		// Log an "adjust" movement so the unretire is in the ledger, then
		// clear the retired_at columns.
		await db.batch([
			db
				.prepare(
					`INSERT INTO movement (item_id, kind, note, actor)
					 VALUES (?, 'adjust', ?, ?)`
				)
				.bind(item.id, 'Unretired', event.locals?.userEmail ?? 'system'),

			db
				.prepare(
					`UPDATE item
					 SET retired_at = NULL, retired_reason = NULL, updated_at = datetime('now')
					 WHERE id = ?`
				)
				.bind(item.id)
		]);

		throw redirect(303, `/items/${item.sku}`);
	}
};
