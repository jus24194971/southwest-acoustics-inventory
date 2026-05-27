import type { Actions, PageServerLoad } from './$types';
import type { D1Database } from '@cloudflare/workers-types';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { isCondition, normaliseAttr, ATTR_UNIQUE, generateSku, type Condition } from '$lib/server/sku';
import { defaultSlug, type Platform } from '$lib/server/listings';

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

	// Marketplace listings — per-platform status for the sidebar panel.
	const { results: listings } = await db
		.prepare(
			`SELECT platform, status, external_id, external_url, last_synced_at,
			        last_sync_status, listing_visible
			 FROM marketplace_listing WHERE item_id = ?`
		)
		.bind(item.id)
		.all<{
			platform: string;
			status: string;
			external_id: string | null;
			external_url: string | null;
			last_synced_at: string | null;
			last_sync_status: string | null;
			listing_visible: number;
		}>();

	return {
		item,
		attrValues,
		listings,
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
	},

	// ============================================================
	// Quantity adjustment (all items — stocked + serialized)
	// ============================================================
	//
	// Items drift — eBay sells a thing we forgot to mark out, a friend
	// grabs a part off the bench, we miscounted on receive, etc. This
	// action lets Dad correct the on-hand qty + leave an audit row
	// explaining why.
	//
	// Works on both tracking modes. For serialized items the count is
	// always 0 or 1 (one specific physical unit). Setting it to 0
	// here means "out of stock, but keep the listing alive so we can
	// re-stock when another comes in" — distinct from the explicit
	// Retire action which means "this listing is dead forever".
	//
	// Reasons map to movement kinds:
	//   sold_external   → 'sale'    (sold off-platform, not via SS push)
	//   damaged         → 'scrap'   (broken / discarded)
	//   count_correction, found_extra, restocked, other → 'adjust'
	//
	// The movement.quantity stores the absolute delta; the note records
	// the before/after numbers so the ledger reads "Adjusted 7 → 4".

	adjustQty: async (event) => {
		const db = getDB(event);
		const item = await loadItemBySku(db, event.params.sku);
		if (!item) throw error(404);

		if (item.retired_at) {
			return fail(400, {
				adjustError:
					"This item is retired (discontinued). Bring it back first if you want to use it again — see the 'Retired' panel."
			});
		}

		const form = await event.request.formData();
		const newQtyRaw = form.get('new_qty')?.toString();
		const reason = (form.get('reason') ?? '').toString();
		const note = form.get('note')?.toString().trim() || null;

		if (!newQtyRaw) {
			return fail(400, { adjustError: 'New quantity is required.' });
		}
		const newQty = parseInt(newQtyRaw, 10);
		if (!Number.isInteger(newQty) || newQty < 0) {
			return fail(400, { adjustError: 'Quantity must be a non-negative integer.' });
		}
		// Serialized items are conceptually "one unique physical unit" —
		// qty stays in 0..1. If Dad needs to track multiples of the same
		// listing, the right move is to change tracking mode to stocked
		// via the Edit form. We block >1 here to keep the model honest.
		if (item.tracking_mode === 'serialized' && newQty > 1) {
			return fail(400, {
				adjustError:
					'Serialized items can only be 0 or 1. To track multiple, change tracking mode to Stocked first.'
			});
		}
		if (newQty === item.stock_qty) {
			return fail(400, { adjustError: `Already at ${newQty}. Nothing to adjust.` });
		}

		const allowedReasons = [
			'sold_external',
			'damaged',
			'count_correction',
			'found_extra',
			'restocked',
			'other'
		];
		if (!allowedReasons.includes(reason)) {
			return fail(400, { adjustError: 'Pick a reason for the adjustment.' });
		}

		// Reason → movement kind. Restocked is a 'receive' so it groups
		// with new incoming inventory in the audit ledger.
		const kind =
			reason === 'sold_external'
				? 'sale'
				: reason === 'damaged'
					? 'scrap'
					: reason === 'restocked'
						? 'receive'
						: 'adjust';

		const delta = newQty - item.stock_qty;
		const direction = delta > 0 ? 'up' : 'down';
		const reasonLabel: Record<string, string> = {
			sold_external: 'Sold off-platform',
			damaged: 'Damaged / discarded',
			count_correction: 'Count correction',
			found_extra: 'Found extra',
			restocked: 'Restocked (new unit of same listing)',
			other: 'Other'
		};
		const baseNote = `${reasonLabel[reason]}: ${item.stock_qty} → ${newQty} (${direction} ${Math.abs(delta)})`;
		const finalNote = note ? `${baseNote} · ${note}` : baseNote;

		// For sale/scrap movements we record the from_bin so the audit
		// trail shows where the stock came out of. Restocked / adjust
		// records to_bin instead (or current_bin if unchanged) so the
		// new unit's location is logged.
		const fromBinId =
			kind === 'sale' || kind === 'scrap' ? item.current_bin_id : null;
		const toBinId = kind === 'receive' ? item.current_bin_id : null;

		await db.batch([
			db
				.prepare(
					`INSERT INTO movement (item_id, kind, from_bin_id, to_bin_id, quantity, note, actor)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					item.id,
					kind,
					fromBinId,
					toBinId,
					Math.abs(delta),
					finalNote,
					event.locals?.userEmail ?? 'system'
				),

			db
				.prepare(
					`UPDATE item SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?`
				)
				.bind(newQty, item.id)
		]);

		throw redirect(303, `/items/${item.sku}`);
	},

	// ============================================================
	// Photo management
	// ============================================================
	//
	// Photos live in R2 under the key pattern `items/<id>/<random>.<ext>`
	// with a one-to-many DB row in item_photo. The bucket is private —
	// the /api/photos/<key> proxy is what actually returns image bytes
	// to <img> tags, so all access stays behind Cloudflare Access.
	//
	// Soft-delete only: setting deleted_at hides the photo from queries
	// but keeps the R2 object around. That's intentional — if Dad
	// accidentally deletes the only photo of a sold item we want a path
	// back. We'll add an actual purge job later when it matters.

	uploadPhotos: async (event) => {
		const db = getDB(event);
		const r2 = event.platform?.env?.PHOTOS;
		if (!r2) return fail(500, { photoError: 'R2 binding missing — server misconfig.' });

		const item = await loadItemBySku(db, event.params.sku);
		if (!item) throw error(404);

		const form = await event.request.formData();
		// File input is `name="photos"` with multiple — getAll() returns
		// every selected file in order.
		const files = form.getAll('photos').filter((v): v is File => v instanceof File);
		if (files.length === 0) {
			return fail(400, { photoError: 'Pick at least one photo to upload.' });
		}
		if (files.length > 20) {
			return fail(400, { photoError: 'Up to 20 photos at a time, please.' });
		}

		// Find the current max position so new uploads append to the end
		// of the gallery (preserve existing order, including primary).
		const maxRow = await db
			.prepare(
				`SELECT COALESCE(MAX(position), -1) AS max_pos
				 FROM item_photo
				 WHERE item_id = ? AND deleted_at IS NULL`
			)
			.bind(item.id)
			.first<{ max_pos: number }>();
		let nextPos = (maxRow?.max_pos ?? -1) + 1;

		// Accept the common web image types. HEIC/HEIF from iPhones is
		// excluded because browsers can't render it — Dad's phone should
		// convert at share time, but if it slips through we want a clean
		// error not a broken thumbnail.
		const ALLOWED: Record<string, string> = {
			'image/jpeg': 'jpg',
			'image/jpg': 'jpg',
			'image/png': 'png',
			'image/webp': 'webp',
			'image/gif': 'gif'
		};
		const MAX_BYTES = 15 * 1024 * 1024; // 15MB per photo

		const rejected: string[] = [];
		const accepted: Array<{ file: File; key: string; ext: string }> = [];

		for (const file of files) {
			const ctRaw = (file.type || '').toLowerCase();
			const ext = ALLOWED[ctRaw];
			if (!ext) {
				rejected.push(`${file.name}: unsupported type (${ctRaw || 'unknown'})`);
				continue;
			}
			if (file.size > MAX_BYTES) {
				rejected.push(`${file.name}: ${(file.size / (1024 * 1024)).toFixed(1)}MB > 15MB limit`);
				continue;
			}
			// crypto.randomUUID() is available on Cloudflare Workers.
			const key = `items/${item.id}/${crypto.randomUUID()}.${ext}`;
			accepted.push({ file, key, ext });
		}

		if (accepted.length === 0) {
			return fail(400, {
				photoError:
					'No photos uploaded. ' + (rejected.length ? rejected.join('; ') : 'Try jpg/png/webp.')
			});
		}

		// Sequential R2 puts — each one is a subrequest. Cloudflare Pages
		// caps at 50 subrequests per request on free, and we're well
		// under that with the 20-file ceiling above plus the DB writes.
		for (const a of accepted) {
			const bytes = await a.file.arrayBuffer();
			await r2.put(a.key, bytes, {
				httpMetadata: { contentType: a.file.type }
			});
		}

		// DB inserts in one batch — fewer round-trips than per-file.
		const inserts = accepted.map((a) =>
			db
				.prepare(
					`INSERT INTO item_photo
						(item_id, r2_key, position, alt_text, bytes, content_type)
					 VALUES (?, ?, ?, ?, ?, ?)`
				)
				.bind(
					item.id,
					a.key,
					nextPos++,
					null,
					a.file.size,
					a.file.type
				)
		);
		await db.batch(inserts);

		// If some files were rejected, redirect anyway but surface a
		// flash via search param — the page reads it and shows a banner.
		const flash =
			rejected.length > 0
				? `?photo_warn=${encodeURIComponent('Skipped: ' + rejected.join('; '))}`
				: '';
		throw redirect(303, `/items/${item.sku}${flash}`);
	},

	deletePhoto: async (event) => {
		const db = getDB(event);
		const item = await loadItemBySku(db, event.params.sku);
		if (!item) throw error(404);

		const form = await event.request.formData();
		const photoIdRaw = form.get('photo_id')?.toString();
		const photoId = photoIdRaw ? parseInt(photoIdRaw, 10) : NaN;
		if (!Number.isInteger(photoId)) {
			return fail(400, { photoError: 'Bad photo id.' });
		}

		// Soft-delete: keep the R2 object + DB row, just hide it. The
		// position is left intact so re-uploading later doesn't collide;
		// the gallery queries filter on deleted_at IS NULL anyway.
		await db
			.prepare(
				`UPDATE item_photo
				 SET deleted_at = datetime('now')
				 WHERE id = ? AND item_id = ? AND deleted_at IS NULL`
			)
			.bind(photoId, item.id)
			.run();

		throw redirect(303, `/items/${item.sku}`);
	},

	makePrimaryPhoto: async (event) => {
		const db = getDB(event);
		const item = await loadItemBySku(db, event.params.sku);
		if (!item) throw error(404);

		const form = await event.request.formData();
		const photoIdRaw = form.get('photo_id')?.toString();
		const photoId = photoIdRaw ? parseInt(photoIdRaw, 10) : NaN;
		if (!Number.isInteger(photoId)) {
			return fail(400, { photoError: 'Bad photo id.' });
		}

		// "Make primary" = compact-renumber the remaining photos so the
		// picked one becomes position 0 and the rest fill 1..N in their
		// current order. Cleaner than trying to swap a single pair —
		// avoids holes from past deletes.
		const { results: photos } = await db
			.prepare(
				`SELECT id FROM item_photo
				 WHERE item_id = ? AND deleted_at IS NULL
				 ORDER BY position, id`
			)
			.bind(item.id)
			.all<{ id: number }>();

		// Move the target to the front, drop duplicates.
		const reordered = [
			photoId,
			...photos.map((p) => p.id).filter((id) => id !== photoId)
		];

		// Only write the rows that actually need updating — D1 has a
		// hard cap on statements per batch, and this also makes the
		// audit cleaner.
		const writes = reordered.map((id, idx) =>
			db
				.prepare(`UPDATE item_photo SET position = ? WHERE id = ? AND item_id = ?`)
				.bind(idx, id, item.id)
		);
		if (writes.length > 0) await db.batch(writes);

		throw redirect(303, `/items/${item.sku}`);
	},

	// ============================================================
	// Split off as variant
	// ============================================================
	//
	// Dad's scenario: he has 12 strat bodies in stock, one has a paint
	// chip. The blemished one needs its own listing — different photo,
	// different price, different description — but it's not a "new
	// SKU from scratch" because it's the same body, just one with a
	// story.
	//
	// This action pulls one unit out of a stocked parent and creates a
	// linked serialized variant. The parent's stock_qty decrements by
	// 1; the variant gets:
	//   - same category / brand / model / year / attributes as parent
	//   - configurable condition (often the same — "Blemished but New")
	//   - parent_item_id back-link so the variants show on parent's page
	//   - title prefixed with the variant reason ("Blemished — …")
	//   - description carrying the user's specific note
	//   - draft marketplace_listing rows for ALL four platforms so the
	//     variant is ready to push to Squarespace today and to eBay /
	//     Reverb / Etsy as soon as those backends land. Each draft is
	//     pre-tagged with the variant reason (lowercased) plus "sale".
	//
	// Two movements on each side: source 'adjust' (qty out), variant
	// 'receive' (qty in). Both reference the other's SKU so the audit
	// ledger reads as a paired split.

	splitOff: async (event) => {
		const db = getDB(event);
		const source = await loadItemBySku(db, event.params.sku);
		if (!source) throw error(404);

		if (source.tracking_mode !== 'stocked') {
			return fail(400, {
				splitError:
					'Only stocked items can be split into variants. Serialized items are already one-off — list them directly.'
			});
		}
		if (source.stock_qty <= 0) {
			return fail(400, {
				splitError: 'Stock is 0 — nothing to pull off.'
			});
		}
		if (source.retired_at) {
			return fail(400, { splitError: "Can't split a retired item. Bring it back first." });
		}

		const form = await event.request.formData();
		const newCondition = (form.get('new_condition') ?? source.condition).toString();
		const variantReason = (form.get('variant_reason') ?? '').toString().trim();
		const variantNote = (form.get('variant_note') ?? '').toString().trim();
		const priceOverrideStr = form.get('variant_price')?.toString().trim();

		if (!isCondition(newCondition)) {
			return fail(400, { splitError: 'Pick a valid condition for the variant.' });
		}
		if (!variantReason) {
			return fail(400, {
				splitError:
					'Variant reason is required — e.g. "Blemished", "Demo", "Open Box". Becomes the title prefix and a listing tag.'
			});
		}
		if (variantReason.length > 30) {
			return fail(400, { splitError: 'Variant reason should be under 30 characters.' });
		}

		// New SKU under the same category/brand/model — sequence number
		// auto-increments. If condition changed the SKU's COND segment
		// shifts too so the codes stay readable.
		const newSku = await generateSku(db, {
			categoryCode: source.cat_code,
			brandCode: source.brand_code ?? 'XXX',
			modelCode: source.model ?? 'XXX',
			condition: newCondition as Condition,
			yearReceived: source.year_received,
			attr1: source.attr_1,
			attr2: source.attr_2,
			attr3: source.attr_3,
			attr4: source.attr_4,
			attr5: source.attr_5
		});

		// Build the variant's title — reason prefix on the parent title
		// keeps the relationship obvious in lists and on the storefront.
		// Cap total length so DYMO labels don't have to truncate aggressively.
		const variantTitle = `${variantReason} — ${source.title}`.slice(0, 200);

		// Description: the user's note if they wrote one; otherwise a
		// stub so the variant page isn't empty.
		const variantDescription =
			variantNote ||
			`${variantReason} variant of ${source.sku}. ${source.title}.`;

		const priceCents = priceOverrideStr
			? Math.round(parseFloat(priceOverrideStr) * 100)
			: source.price_cents;

		// ---- Insert the variant item (needs its own round-trip to get
		//      the new id back via RETURNING) ---------------------------
		const inserted = await db
			.prepare(
				`INSERT INTO item (
					sku, title, description,
					category_id, brand_id, model, condition,
					year_received, cost_cents, price_cents, current_bin_id,
					tracking_mode, stock_qty, parent_item_id,
					attr_1, attr_2, attr_3, attr_4, attr_5,
					attr_1_unique_desc, attr_2_unique_desc, attr_3_unique_desc,
					attr_4_unique_desc, attr_5_unique_desc
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'serialized', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				RETURNING id`
			)
			.bind(
				newSku,
				variantTitle,
				variantDescription,
				source.category_id,
				source.brand_id,
				source.model,
				newCondition,
				source.year_received,
				source.cost_cents,
				priceCents,
				source.current_bin_id,
				source.id, // parent_item_id
				source.attr_1,
				source.attr_2,
				source.attr_3,
				source.attr_4,
				source.attr_5,
				source.attr_1_unique_desc,
				source.attr_2_unique_desc,
				source.attr_3_unique_desc,
				source.attr_4_unique_desc,
				source.attr_5_unique_desc
			)
			.first<{ id: number }>();
		if (!inserted) throw error(500, 'splitOff: variant INSERT returned no row');
		const variantId = inserted.id;

		// ---- Build the marketplace_listing pre-fills for every platform
		// so each one is a one-click push when its backend is ready.
		// Tags carry the variant reason + a generic 'sale' marker so
		// the storefronts can route them into a Special Value collection.
		const reasonSlug = variantReason
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
		const tagsJson = JSON.stringify(
			Array.from(new Set([reasonSlug, 'sale'].filter(Boolean)))
		);
		const slug = defaultSlug(variantTitle);

		const PLATFORMS: Platform[] = ['squarespace', 'ebay', 'reverb', 'etsy'];

		const actor = event.locals?.userEmail ?? 'system';
		const splitNote =
			`Split off 1 unit as variant ${newSku} (${variantReason})` +
			(variantNote ? ` — ${variantNote}` : '');

		// ---- One batched write for everything else: decrement source,
		// log both movements, create four draft listings. Keeps the
		// split atomic from the user's perspective.
		const writes = [
			db
				.prepare(
					`UPDATE item SET stock_qty = stock_qty - 1, updated_at = datetime('now') WHERE id = ?`
				)
				.bind(source.id),

			// Source side: adjust (qty out), references the new variant SKU.
			db
				.prepare(
					`INSERT INTO movement (item_id, kind, from_bin_id, quantity, note, actor, reference)
					 VALUES (?, 'adjust', ?, 1, ?, ?, ?)`
				)
				.bind(source.id, source.current_bin_id, splitNote, actor, newSku),

			// Variant side: receive (qty in), references the source SKU.
			db
				.prepare(
					`INSERT INTO movement (item_id, kind, to_bin_id, quantity, note, actor, reference)
					 VALUES (?, 'receive', ?, 1, ?, ?, ?)`
				)
				.bind(
					variantId,
					source.current_bin_id,
					`Split off from parent ${source.sku} as ${variantReason}`,
					actor,
					source.sku
				)
		];

		// Pre-create draft listings for every platform. Inline INSERTs
		// rather than going through upsertListingContent so they batch
		// with the other writes — and ON CONFLICT DO NOTHING in case
		// some platform's listing already exists for this item somehow.
		for (const platform of PLATFORMS) {
			writes.push(
				db
					.prepare(
						`INSERT INTO marketplace_listing (
							item_id, platform,
							listing_title, listing_description_html, listing_url_slug,
							listing_tags_json, listing_price_cents, listing_visible,
							storefront_id, status, updated_at
						)
						 VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, 'draft', datetime('now'))
						 ON CONFLICT (item_id, platform) DO NOTHING`
					)
					.bind(
						variantId,
						platform,
						variantTitle,
						`<p>${escapeHtml(variantDescription)}</p>`,
						slug,
						tagsJson,
						priceCents
					)
			);
		}

		await db.batch(writes);

		// Land Dad on the new variant — it's where he'll add photos,
		// fine-tune the listing, and push to Squarespace.
		throw redirect(303, `/items/${newSku}`);
	}
};

/**
 * Minimal HTML escape for fitting the user's plain-text note into a
 * <p>...</p> wrapper for the listing's HTML description field. The
 * full rich-text editor takes over from there.
 */
function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
