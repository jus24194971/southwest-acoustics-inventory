import type { Actions, PageServerLoad } from './$types';
import type { D1Database } from '@cloudflare/workers-types';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { isCondition, normaliseAttr, ATTR_UNIQUE, generateSku, type Condition } from '$lib/server/sku';

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
	cat_attr_1_label: string | null;
	cat_attr_2_label: string | null;
	cat_attr_3_label: string | null;
	cat_attr_4_label: string | null;
	cat_attr_5_label: string | null;
	cat_attr_1_context_key: string | null;
	cat_attr_2_context_key: string | null;
	cat_attr_3_context_key: string | null;
	cat_attr_4_context_key: string | null;
	cat_attr_5_context_key: string | null;
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
	tracking_mode: 'serialized' | 'stocked';
	stock_qty: number;
	attr_1: string;
	attr_2: string;
	attr_3: string;
	attr_4: string;
	attr_5: string;
	attr_1_unique_desc: string | null;
	attr_2_unique_desc: string | null;
	attr_3_unique_desc: string | null;
	attr_4_unique_desc: string | null;
	attr_5_unique_desc: string | null;
	attributes_json: string | null;
	parent_item_id: number | null;
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
				c.code         AS cat_code,
				c.name         AS cat_name,
				c.attr_1_label AS cat_attr_1_label,
				c.attr_2_label AS cat_attr_2_label,
				c.attr_3_label AS cat_attr_3_label,
				c.attr_4_label AS cat_attr_4_label,
				c.attr_5_label AS cat_attr_5_label,
				c.attr_1_context_key AS cat_attr_1_context_key,
				c.attr_2_context_key AS cat_attr_2_context_key,
				c.attr_3_context_key AS cat_attr_3_context_key,
				c.attr_4_context_key AS cat_attr_4_context_key,
				c.attr_5_context_key AS cat_attr_5_context_key,
				br.code  AS brand_code,
				br.name  AS brand_name,
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

	// Six read queries in one D1 batch round-trip:
	//   - photos
	//   - movements
	//   - bins (for transfer dropdown)
	//   - categories (with attr labels, for the change-category dropdown
	//                 and the edit form's dynamic attribute inputs)
	//   - parent item (if this item is a variant under one)
	//   - child variants (items whose parent_item_id = this.id)
	const [photos, movements, bins, categories, parent, variants] = await db.batch([
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
					m.note, m.reference, m.actor, m.created_at,
					m.quantity
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
			// Tree-aware bin list with full path strings for the transfer
			// picker — see the matching CTE in /items/new for the shape.
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
			SELECT id, code AS bin_code, depth, path
			FROM bin_tree
			ORDER BY path`
		),

		db.prepare(
			`SELECT id, code, name,
			        attr_1_label, attr_2_label, attr_3_label, attr_4_label, attr_5_label,
			        attr_1_context_key, attr_2_context_key, attr_3_context_key,
			        attr_4_context_key, attr_5_context_key
			 FROM category
			 ORDER BY name`
		),

		db
			.prepare(`SELECT id, sku, title FROM item WHERE id = ? AND deleted_at IS NULL`)
			.bind(item.parent_item_id ?? -1),

		db
			.prepare(
				`SELECT id, sku, title, attr_1, attr_2, attr_3, attr_4, attr_5, stock_qty
				 FROM item
				 WHERE parent_item_id = ? AND deleted_at IS NULL
				 ORDER BY sku`
			)
			.bind(item.id)
	]);

	// Attribute values for all contexts — used by the dropdown widgets
	// in the edit form. Small dataset; one query for the whole catalogue.
	const { results: attrValues } = await db
		.prepare(
			`SELECT id, context_key, code, label, sort_order
			 FROM attribute_value
			 WHERE is_active = 1
			 ORDER BY context_key, sort_order, label`
		)
		.all<{
			id: number;
			context_key: string;
			code: string;
			label: string;
			sort_order: number;
		}>();

	return {
		item,
		attrValues,
		photos: photos.results as PhotoRow[],
		movements: movements.results as MovementRow[],
		bins: bins.results as Array<{
			id: number;
			bin_code: string;
			depth: number;
			path: string;
		}>,
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
		parent: (parent.results[0] ?? null) as { id: number; sku: string; title: string } | null,
		variants: variants.results as Array<{
			id: number;
			sku: string;
			title: string;
			attr_1: string;
			attr_2: string;
			attr_3: string;
			attr_4: string;
			attr_5: string;
			stock_qty: number;
		}>
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
		const trackingMode = (form.get('tracking_mode') ?? item.tracking_mode).toString();
		const stockQtyRaw = form.get('stock_qty')?.toString();
		const newCategoryIdRaw = form.get('category_id')?.toString();
		const keepSku = form.get('keep_sku') === 'on';

		// Attribute slots — read positionally. Empty fields normalise to
		// 'XXX' (no value). The matching _unique_desc only persists when
		// the slot itself is UNQ.
		const attrRaw = [1, 2, 3, 4, 5].map((n) => ({
			value: normaliseAttr((form.get(`attr_${n}`) ?? '').toString()),
			uniqueDesc: (form.get(`attr_${n}_unique_desc`) ?? '').toString().trim() || null
		}));

		const errors: Record<string, string> = {};
		if (!title) errors.title = 'Title is required.';
		if (!isCondition(condition)) errors.condition = 'Pick a valid condition.';
		if (trackingMode !== 'serialized' && trackingMode !== 'stocked') {
			errors.tracking_mode = 'Tracking mode must be serialized or stocked.';
		}
		const stockQty =
			trackingMode === 'serialized'
				? 1
				: stockQtyRaw
					? parseInt(stockQtyRaw, 10)
					: item.stock_qty;
		if (trackingMode === 'stocked' && (!Number.isInteger(stockQty) || stockQty < 0)) {
			errors.stock_qty = 'Stock quantity must be a non-negative integer.';
		}
		if (Object.keys(errors).length > 0) {
			return fail(400, { editErrors: errors });
		}

		// Resolve new category (may equal the current one).
		const newCategoryId = newCategoryIdRaw ? parseInt(newCategoryIdRaw, 10) : item.category_id;
		const newCat = await db
			.prepare(`SELECT id, code FROM category WHERE id = ?`)
			.bind(newCategoryId)
			.first<{ id: number; code: string }>();
		if (!newCat) {
			const notFound: Record<string, string> = { category_id: 'Category not found.' };
			return fail(400, { editErrors: notFound });
		}

		const categoryChanged = newCategoryId !== item.category_id;
		const shouldRegenSku = categoryChanged && !keepSku;

		const costCents = costStr ? Math.round(parseFloat(costStr) * 100) : null;
		const priceCents = priceStr ? Math.round(parseFloat(priceStr) * 100) : null;

		// If the category changed and the user didn't tick "keep current
		// SKU", allocate a fresh SKU under the new category's prefix +
		// the just-picked attribute values. The old SKU is reflected in
		// an 'adjust' movement so the audit trail explains the change.
		let finalSku = item.sku;
		if (shouldRegenSku) {
			finalSku = await generateSku(db, {
				categoryCode: newCat.code,
				brandCode: item.brand_code ?? 'XXX',
				modelCode: item.model ?? 'XXX',
				condition: condition as Condition,
				yearReceived: item.year_received,
				attr1: attrRaw[0].value,
				attr2: attrRaw[1].value,
				attr3: attrRaw[2].value,
				attr4: attrRaw[3].value,
				attr5: attrRaw[4].value
			});
		}

		const writes = [
			db
				.prepare(
					`UPDATE item
					 SET sku = ?, category_id = ?,
					     title = ?, description = ?, description_html = ?,
					     condition = ?, cost_cents = ?, price_cents = ?,
					     tracking_mode = ?, stock_qty = ?,
					     attr_1 = ?, attr_2 = ?, attr_3 = ?, attr_4 = ?, attr_5 = ?,
					     attr_1_unique_desc = ?, attr_2_unique_desc = ?,
					     attr_3_unique_desc = ?, attr_4_unique_desc = ?, attr_5_unique_desc = ?,
					     updated_at = datetime('now')
					 WHERE id = ?`
				)
				.bind(
					finalSku,
					newCategoryId,
					title,
					description || null,
					descriptionHtml || null,
					condition,
					costCents,
					priceCents,
					trackingMode,
					stockQty,
					attrRaw[0].value,
					attrRaw[1].value,
					attrRaw[2].value,
					attrRaw[3].value,
					attrRaw[4].value,
					attrRaw[0].value === ATTR_UNIQUE ? attrRaw[0].uniqueDesc : null,
					attrRaw[1].value === ATTR_UNIQUE ? attrRaw[1].uniqueDesc : null,
					attrRaw[2].value === ATTR_UNIQUE ? attrRaw[2].uniqueDesc : null,
					attrRaw[3].value === ATTR_UNIQUE ? attrRaw[3].uniqueDesc : null,
					attrRaw[4].value === ATTR_UNIQUE ? attrRaw[4].uniqueDesc : null,
					item.id
				)
		];
		if (shouldRegenSku) {
			writes.push(
				db
					.prepare(
						`INSERT INTO movement (item_id, kind, note, actor)
						 VALUES (?, 'adjust', ?, ?)`
					)
					.bind(
						item.id,
						`Recategorized to ${newCat.code}; SKU changed from ${item.sku} to ${finalSku}`,
						event.locals?.userEmail ?? 'system'
					)
			);
		} else if (categoryChanged) {
			writes.push(
				db
					.prepare(
						`INSERT INTO movement (item_id, kind, note, actor)
						 VALUES (?, 'adjust', ?, ?)`
					)
					.bind(
						item.id,
						`Recategorized to ${newCat.code}; SKU kept as ${item.sku}`,
						event.locals?.userEmail ?? 'system'
					)
			);
		}
		await db.batch(writes);

		throw redirect(303, `/items/${finalSku}`);
	},

	// (Category changes are folded into the `edit` action above so the
	// new category's attribute values can be picked at the same time and
	// the SKU can regenerate cleanly. The old standalone changeCategory
	// action lived here; it was a strict subset of edit.)

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
