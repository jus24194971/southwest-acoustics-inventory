import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { generateSku, isCondition } from '$lib/server/sku';

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	// Categories drive the SKU prefix, so we always need them for the form.
	const categories = await db
		.prepare(`SELECT id, code, name FROM category ORDER BY name`)
		.all<{ id: number; code: string; name: string }>();

	// Brands are optional — first-run will be empty, that's fine.
	const brands = await db
		.prepare(`SELECT id, code, name FROM brand ORDER BY name`)
		.all<{ id: number; code: string; name: string }>();

	// Bins for the "where does this live" picker. Joined with location for label clarity.
	const bins = await db
		.prepare(
			`SELECT bin.id, bin.code AS bin_code, loc.code AS loc_code, loc.name AS loc_name
			 FROM bin
			 JOIN location loc ON loc.id = bin.location_id
			 WHERE bin.deleted_at IS NULL AND loc.deleted_at IS NULL
			 ORDER BY loc.code, bin.code`
		)
		.all<{ id: number; bin_code: string; loc_code: string; loc_name: string }>();

	return {
		categories: categories.results,
		brands: brands.results,
		bins: bins.results
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

		// ---- validation -------------------------------------------------
		const errors: Record<string, string> = {};
		if (!title) errors.title = 'Title is required.';
		if (!categoryIdRaw) errors.category_id = 'Pick a category.';
		if (!model) errors.model = 'Model is required (used in the SKU).';
		if (!condition || !isCondition(condition)) errors.condition = 'Pick a condition.';
		const year = yearRaw ? parseInt(yearRaw, 10) : new Date().getFullYear();
		if (!year || year < 2000 || year > 2100) errors.year_received = 'Year looks off.';

		// Always include `values` in the fail() return so the form action's
		// inferred type is consistent — keeps the .svelte type-narrowing happy.
		const values = {
			title,
			description: description ?? '',
			model,
			condition,
			year_received: year
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

		// Brand: either pick existing (brand_id), or supply a free-text 3-char code.
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

		const sku = await generateSku(db, {
			categoryCode: category.code,
			brandCode,
			modelCode: model,
			condition: condition as 'N' | 'U' | 'R' | 'B',
			yearReceived: year
		});

		const costCents = costStr ? Math.round(parseFloat(costStr) * 100) : null;
		const priceCents = priceStr ? Math.round(parseFloat(priceStr) * 100) : null;
		const binId = binIdRaw ? parseInt(binIdRaw, 10) : null;

		// Insert the item, then record the initial 'receive' movement, then
		// (if a bin was picked) snap the current_bin_id cache. We do it as
		// a D1 batch so it's atomic.
		const inserts = await db.batch([
			db
				.prepare(
					`INSERT INTO item
						(sku, title, description, category_id, brand_id, model, condition,
						 year_received, cost_cents, price_cents, current_bin_id)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
					binId
				)
		]);
		const itemRow = inserts[0].results[0] as { id: number };

		await db
			.prepare(
				`INSERT INTO movement (item_id, kind, to_bin_id, note, actor)
				 VALUES (?, 'receive', ?, ?, ?)`
			)
			.bind(itemRow.id, binId, 'Initial receive', event.locals?.userEmail ?? 'system')
			.run();

		throw redirect(303, `/items?just_added=${encodeURIComponent(sku)}`);
	}
};
