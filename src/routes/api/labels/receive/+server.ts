import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { generateSku, isCondition, normaliseAttr, ATTR_UNIQUE, type Condition } from '$lib/server/sku';
import { buildLabelsPdf, type Label, type LabelTemplateCode } from '$lib/server/labels';

/**
 * POST /api/labels/receive
 *
 * Receive workflow: Dad pastes the box on his bench, fills out the
 * form, and we both
 *
 *   (a) create the inventory item rows (with their SKUs allocated
 *       from sku_sequence under the correct category prefix), and
 *   (b) return a PDF with N labels ready to print on the DYMO.
 *
 * Body (multipart/form-data):
 *   category_id, brand_id?, brand_code?, model, condition,
 *   year_received, tracking_mode, stock_qty (for stocked),
 *   quantity (number of physical items received),
 *   labels_per_item (how many copies of each SKU's label to print —
 *                    typically 1 for serialized, N for stocked-bin),
 *   bin_id?, cost?, price?, title, description?,
 *   attr_1..attr_5, attr_*_unique_desc?,
 *   template? (label template code)
 *
 * For serialized tracking, creates `quantity` items each with its
 * own SKU. For stocked tracking, creates one item with stock_qty
 * set to quantity. In both cases, the PDF contains
 * (items.length × labels_per_item) labels.
 */
export const POST: RequestHandler = async (event) => {
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
	const quantityRaw = form.get('quantity')?.toString();
	const labelsPerItemRaw = form.get('labels_per_item')?.toString();
	const templateCode = (form.get('template') ?? 'LW_DURABLE_19x64').toString() as LabelTemplateCode;

	// ---- validation ---------------------------------------------------
	if (!title) throw error(400, 'Title is required.');
	if (!categoryIdRaw) throw error(400, 'Category required.');
	if (!model) throw error(400, 'Model required (used in the SKU).');
	if (!isCondition(condition)) throw error(400, 'Pick a valid condition.');

	const year = yearRaw ? parseInt(yearRaw, 10) : new Date().getFullYear();
	if (!year || year < 2000 || year > 2100) throw error(400, 'Year looks off.');

	if (trackingMode !== 'serialized' && trackingMode !== 'stocked') {
		throw error(400, 'tracking_mode must be serialized or stocked.');
	}

	const quantity = quantityRaw ? parseInt(quantityRaw, 10) : 1;
	if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) {
		throw error(400, 'Quantity must be 1-200.');
	}

	const labelsPerItem = labelsPerItemRaw ? parseInt(labelsPerItemRaw, 10) : 1;
	if (!Number.isInteger(labelsPerItem) || labelsPerItem < 1 || labelsPerItem > 50) {
		throw error(400, 'Labels per item must be 1-50.');
	}

	const categoryId = parseInt(categoryIdRaw, 10);
	const category = await db
		.prepare(`SELECT id, code FROM category WHERE id = ?`)
		.bind(categoryId)
		.first<{ id: number; code: string }>();
	if (!category) throw error(400, 'Category not found.');

	// Brand: either pick an existing one or use a free-text 3-char code.
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

	const attrRaw = [1, 2, 3, 4, 5].map((n) => ({
		value: normaliseAttr((form.get(`attr_${n}`) ?? '').toString()),
		uniqueDesc: (form.get(`attr_${n}_unique_desc`) ?? '').toString().trim() || null
	}));

	const costCents = costStr ? Math.round(parseFloat(costStr) * 100) : null;
	const priceCents = priceStr ? Math.round(parseFloat(priceStr) * 100) : null;
	const binId = binIdRaw ? parseInt(binIdRaw, 10) : null;
	const actor = event.locals?.userEmail ?? 'system';

	// ---- create items + record receive movements ---------------------
	const createdItems: Array<{ id: number; sku: string; title: string }> = [];

	if (trackingMode === 'serialized') {
		// One row per physical object; each gets its own SKU.
		for (let i = 0; i < quantity; i++) {
			const sku = await generateSku(db, {
				categoryCode: category.code,
				brandCode,
				modelCode: model,
				condition: condition as Condition,
				yearReceived: year,
				attr1: attrRaw[0].value,
				attr2: attrRaw[1].value,
				attr3: attrRaw[2].value,
				attr4: attrRaw[3].value,
				attr5: attrRaw[4].value
			});
			const inserted = await db
				.prepare(
					`INSERT INTO item (
						sku, title, description,
						category_id, brand_id, model, condition,
						year_received, cost_cents, price_cents, current_bin_id,
						tracking_mode, stock_qty,
						attr_1, attr_2, attr_3, attr_4, attr_5,
						attr_1_unique_desc, attr_2_unique_desc, attr_3_unique_desc,
						attr_4_unique_desc, attr_5_unique_desc
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
					'serialized',
					1,
					attrRaw[0].value,
					attrRaw[1].value,
					attrRaw[2].value,
					attrRaw[3].value,
					attrRaw[4].value,
					attrRaw[0].value === ATTR_UNIQUE ? attrRaw[0].uniqueDesc : null,
					attrRaw[1].value === ATTR_UNIQUE ? attrRaw[1].uniqueDesc : null,
					attrRaw[2].value === ATTR_UNIQUE ? attrRaw[2].uniqueDesc : null,
					attrRaw[3].value === ATTR_UNIQUE ? attrRaw[3].uniqueDesc : null,
					attrRaw[4].value === ATTR_UNIQUE ? attrRaw[4].uniqueDesc : null
				)
				.first<{ id: number }>();
			if (!inserted) throw error(500, 'item INSERT returned no row');

			await db
				.prepare(
					`INSERT INTO movement (item_id, kind, to_bin_id, quantity, note, actor)
					 VALUES (?, 'receive', ?, 1, 'Received', ?)`
				)
				.bind(inserted.id, binId, actor)
				.run();

			createdItems.push({ id: inserted.id, sku, title });
		}
	} else {
		// Stocked: one row, stock_qty = quantity.
		const sku = await generateSku(db, {
			categoryCode: category.code,
			brandCode,
			modelCode: model,
			condition: condition as Condition,
			yearReceived: year,
			attr1: attrRaw[0].value,
			attr2: attrRaw[1].value,
			attr3: attrRaw[2].value,
			attr4: attrRaw[3].value,
			attr5: attrRaw[4].value
		});
		const inserted = await db
			.prepare(
				`INSERT INTO item (
					sku, title, description,
					category_id, brand_id, model, condition,
					year_received, cost_cents, price_cents, current_bin_id,
					tracking_mode, stock_qty,
					attr_1, attr_2, attr_3, attr_4, attr_5,
					attr_1_unique_desc, attr_2_unique_desc, attr_3_unique_desc,
					attr_4_unique_desc, attr_5_unique_desc
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
				'stocked',
				quantity,
				attrRaw[0].value,
				attrRaw[1].value,
				attrRaw[2].value,
				attrRaw[3].value,
				attrRaw[4].value,
				attrRaw[0].value === ATTR_UNIQUE ? attrRaw[0].uniqueDesc : null,
				attrRaw[1].value === ATTR_UNIQUE ? attrRaw[1].uniqueDesc : null,
				attrRaw[2].value === ATTR_UNIQUE ? attrRaw[2].uniqueDesc : null,
				attrRaw[3].value === ATTR_UNIQUE ? attrRaw[3].uniqueDesc : null,
				attrRaw[4].value === ATTR_UNIQUE ? attrRaw[4].uniqueDesc : null
			)
			.first<{ id: number }>();
		if (!inserted) throw error(500, 'item INSERT returned no row');

		await db
			.prepare(
				`INSERT INTO movement (item_id, kind, to_bin_id, quantity, note, actor)
				 VALUES (?, 'receive', ?, ?, 'Initial stock', ?)`
			)
			.bind(inserted.id, binId, quantity, actor)
			.run();

		createdItems.push({ id: inserted.id, sku, title });
	}

	// ---- build PDF ----------------------------------------------------
	const labels: Label[] = createdItems.map((it) => ({
		kind: 'item',
		sku: it.sku,
		title: it.title,
		url: `${event.url.origin}/items/${encodeURIComponent(it.sku)}`
	}));

	const pdf = await buildLabelsPdf(labels, {
		template: templateCode,
		copiesPerLabel: labelsPerItem
	});

	// Wrap as Blob so the Response constructor's BodyInit typing accepts
	// it (Uint8Array works at runtime in the Workers runtime but SvelteKit
	// uses DOM Response types that don't include it).
	// TS infers Uint8Array<ArrayBufferLike> which doesn't structurally
	// match BlobPart's narrower ArrayBuffer requirement. Cast through
	// unknown — runtime is the same.
	return new Response(new Blob([pdf as unknown as ArrayBuffer], { type: 'application/pdf' }), {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': 'inline; filename="sw-acoustics-labels.pdf"',
			// Custom header so the client can read the new SKUs without
			// re-parsing the PDF — used by the form to clear/redirect.
			'x-skus-created': createdItems.map((i) => i.sku).join(',')
		}
	});
};
