import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { generateSku, isCondition, normaliseAttr, ATTR_UNIQUE } from '$lib/server/sku';

/**
 * New-item form.
 *
 * Load: gather everything the form needs in one batched D1 round-trip —
 * categories (with their per-slot attribute labels), brands, and bins.
 *
 * Action: validate + generate the VIN-style SKU + INSERT the item with
 * its 5 attribute slots + unique descriptions + initial receive movement.
 * Attribute slots are read positionally from form fields `attr_1`..`attr_5`,
 * and if any of them comes back as the reserved `UNQ` value the matching
 * `attr_N_unique_desc` text is captured too.
 */

interface CategoryRow {
	id: number;
	code: string;
	name: string;
	attr_1_label: string | null;
	attr_2_label: string | null;
	attr_3_label: string | null;
	attr_4_label: string | null;
	attr_5_label: string | null;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	const [categories, brands, bins] = await db.batch([
		db.prepare(
			`SELECT id, code, name,
			        attr_1_label, attr_2_label, attr_3_label, attr_4_label, attr_5_label
			 FROM category
			 ORDER BY name`
		),
		db.prepare(`SELECT id, code, name FROM brand ORDER BY name`),
		db.prepare(
			`SELECT bin.id, bin.code AS bin_code, loc.code AS loc_code, loc.name AS loc_name
			 FROM bin
			 JOIN location loc ON loc.id = bin.location_id
			 WHERE bin.deleted_at IS NULL AND loc.deleted_at IS NULL
			 ORDER BY loc.code, bin.code`
		)
	]);

	return {
		categories: categories.results as CategoryRow[],
		brands: brands.results as Array<{ id: number; code: string; name: string }>,
		bins: bins.results as Array<{ id: number; bin_code: string; loc_code: string; loc_name: string }>
	};
};

export const actions: Actions = {
	default: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();

		const title = (form.get('title') ?? '').toString().trim();
		const description = (form.get('description') ?? '').toString().trim() || null;
		const categoryIdRaw = form.get('category_id')?.toString();
		const brandIdRaw = form.get('brand_id')?.toString();
		const brandCodeRaw = form.get('brand_code')?.toString().trim();
		const model = (form.get('model') ?? '').toString().trim();
		const condition = (form.get('condition') ?? '').toString();
		const yearRaw = form.get('year_received')?.toString();
		const binIdRaw = form.get('bin_id')?.toString();
		const costStr = form.get('cost')?.toString().trim();
		const priceStr = form.get('price')?.toString().trim();
		const trackingMode = (form.get('tracking_mode') ?? 'serialized').toString();
		const stockQtyRaw = form.get('stock_qty')?.toString();

		// Five attribute slots — read each one's value + optional unique
		// description. The form may or may not include a given slot
		// depending on the selected category's labels, but reading
		// non-present fields just gives back empty string.
		const attrRaw = [1, 2, 3, 4, 5].map((n) => ({
			slot: n,
			value: (form.get(`attr_${n}`) ?? '').toString().trim(),
			uniqueDesc: (form.get(`attr_${n}_unique_desc`) ?? '').toString().trim() || null
		}));

		// ---- validation -------------------------------------------------
		const errors: Record<string, string> = {};
		if (!title) errors.title = 'Title is required.';
		if (!categoryIdRaw) errors.category_id = 'Pick a category.';
		if (!model) errors.model = 'Model is required (used in the SKU).';
		if (!condition || !isCondition(condition)) errors.condition = 'Pick a condition.';
		const year = yearRaw ? parseInt(yearRaw, 10) : new Date().getFullYear();
		if (!year || year < 2000 || year > 2100) errors.year_received = 'Year looks off.';
		if (trackingMode !== 'serialized' && trackingMode !== 'stocked') {
			errors.tracking_mode = 'Tracking mode must be serialized or stocked.';
		}
		const stockQty = stockQtyRaw ? parseInt(stockQtyRaw, 10) : 1;
		if (trackingMode === 'stocked' && (!Number.isInteger(stockQty) || stockQty < 0)) {
			errors.stock_qty = 'Stock quantity must be a non-negative integer.';
		}

		const values = {
			title,
			description: description ?? '',
			model,
			condition,
			year_received: year,
			tracking_mode: trackingMode,
			stock_qty: stockQty
		};

		if (Object.keys(errors).length > 0) {
			return fail(400, { errors, values });
		}

		const categoryId = parseInt(categoryIdRaw!, 10);
		const category = await db
			.prepare(`SELECT code FROM category WHERE id = ?`)
			.bind(categoryId)
			.first<{ code: string }>();
		if (!category) {
			const notFound: Record<string, string> = { category_id: 'Category not found.' };
			return fail(400, { errors: notFound, values });
		}

		let brandId: number | null = null;
		let brandCode = 'XXX';
		if (brandIdRaw) {
			brandId = parseInt(brandIdRaw, 10);
			const row = await db
				.prepare(`SELECT code FROM brand WHERE id = ?`)
				.bind(brandId)
				.first<{ code: string }>();
			if (row) brandCode = row.code;
		} else if (brandCodeRaw) {
			brandCode = brandCodeRaw;
		}

		// Normalise each attribute slot. UNQ values stay as 'UNQ' in the
		// SKU + column; their freeform descriptions land in attr_N_unique_desc.
		const attrs = attrRaw.map((a) => ({
			value: normaliseAttr(a.value),
			uniqueDesc: a.uniqueDesc
		}));

		const sku = await generateSku(db, {
			categoryCode: category.code,
			brandCode,
			modelCode: model,
			condition: condition as 'N' | 'U' | 'R' | 'B',
			yearReceived: year,
			attr1: attrs[0].value,
			attr2: attrs[1].value,
			attr3: attrs[2].value,
			attr4: attrs[3].value,
			attr5: attrs[4].value
		});

		const costCents = costStr ? Math.round(parseFloat(costStr) * 100) : null;
		const priceCents = priceStr ? Math.round(parseFloat(priceStr) * 100) : null;
		const binId = binIdRaw ? parseInt(binIdRaw, 10) : null;

		// One D1 batch: insert the item with all attribute slots, then the
		// initial 'receive' movement. Atomic.
		const inserts = await db.batch([
			db
				.prepare(
					`INSERT INTO item (
						sku, title, description,
						category_id, brand_id, model, condition,
						year_received, cost_cents, price_cents, current_bin_id,
						tracking_mode, stock_qty,
						attr_1, attr_2, attr_3, attr_4, attr_5,
						attr_1_unique_desc, attr_2_unique_desc, attr_3_unique_desc,
						attr_4_unique_desc, attr_5_unique_desc
					)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					 RETURNING id`
				)
				.bind(
					sku,
					title,
					description,
					categoryId,
					brandId,
					model.toUpperCase(),
					condition,
					year,
					costCents,
					priceCents,
					binId,
					trackingMode,
					trackingMode === 'serialized' ? 1 : stockQty,
					attrs[0].value,
					attrs[1].value,
					attrs[2].value,
					attrs[3].value,
					attrs[4].value,
					// Only persist a unique_desc if the slot is actually UNQ
					attrs[0].value === ATTR_UNIQUE ? attrs[0].uniqueDesc : null,
					attrs[1].value === ATTR_UNIQUE ? attrs[1].uniqueDesc : null,
					attrs[2].value === ATTR_UNIQUE ? attrs[2].uniqueDesc : null,
					attrs[3].value === ATTR_UNIQUE ? attrs[3].uniqueDesc : null,
					attrs[4].value === ATTR_UNIQUE ? attrs[4].uniqueDesc : null
				)
		]);
		const itemRow = inserts[0].results[0] as { id: number };

		await db
			.prepare(
				`INSERT INTO movement (item_id, kind, to_bin_id, quantity, note, actor)
				 VALUES (?, 'receive', ?, ?, ?, ?)`
			)
			.bind(
				itemRow.id,
				binId,
				trackingMode === 'serialized' ? 1 : stockQty,
				'Initial receive',
				event.locals?.userEmail ?? 'system'
			)
			.run();

		throw redirect(303, `/items?just_added=${encodeURIComponent(sku)}`);
	}
};
