import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { generateSku, isCondition, normaliseAttr, ATTR_UNIQUE } from '$lib/server/sku';
import { adoptGroupListings } from '$lib/server/reconcile';
import { publishItemAsSellable } from '$lib/server/ss_auto_sync';
import { importItemPhotosFromAnySource } from '$lib/server/squarespace_import';
import { resolveEbayCreds } from '$lib/server/ebay_credentials';

/** Resolved prefill the reconcile wizard stashes on a group before
 *  handing off to this form. Mirrors GroupPrefill + qty/decision. */
interface ReconcilePrefill {
	title?: string;
	description?: string;
	categoryId?: number | null;
	categoryLabel?: string | null;
	brandId?: number | null;
	brandCode?: string | null;
	brandName?: string | null;
	model?: string;
	condition?: 'N' | 'U' | 'R' | 'B';
	priceCents?: number | null;
	attrCodes?: string[];
	attrLabels?: string[];
	descriptors?: string;
	qty?: number;
	decision?: 'have' | 'future';
}

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
	attr_1_context_key: string | null;
	attr_2_context_key: string | null;
	attr_3_context_key: string | null;
	attr_4_context_key: string | null;
	attr_5_context_key: string | null;
}

interface AttributeValueRow {
	id: number;
	context_key: string;
	code: string;
	label: string;
	sort_order: number;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	const [categories, brands, bins, attrValues] = await db.batch([
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
			// Tree-aware bin list with full path strings ("GAR / Main
			// Cabinet / Drawer 1 / Bin 3") suitable for the picker.
			// Recursive CTE walks from each location root outward.
			`WITH RECURSIVE bin_tree(id, location_id, parent_bin_id, code, name, depth, path) AS (
				SELECT b.id, b.location_id, b.parent_bin_id, b.code, b.name,
				       0 AS depth,
				       loc.code || ' / ' || b.code AS path
				FROM bin b
				JOIN location loc ON loc.id = b.location_id
				WHERE b.parent_bin_id IS NULL
				  AND b.deleted_at IS NULL AND loc.deleted_at IS NULL

				UNION ALL

				SELECT b.id, b.location_id, b.parent_bin_id, b.code, b.name,
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
			`SELECT id, context_key, code, label, sort_order
			 FROM attribute_value
			 WHERE is_active = 1
			 ORDER BY context_key, sort_order, label`
		)
	]);

	// When the reconcile wizard sends us here ("Have it"), load the AI
	// prefill it stashed on the group + the listing photos so the form
	// arrives populated AND shows the product graphics.
	let reconcile: {
		groupId: number;
		prefill: ReconcilePrefill;
		photos: Array<{ platform: string; image_url: string; url: string | null }>;
	} | null = null;
	const rg = event.url.searchParams.get('reconcile_group');
	if (rg && /^\d+$/.test(rg)) {
		const groupId = parseInt(rg, 10);
		const row = await db
			.prepare(`SELECT prefill_json FROM reconcile_group WHERE id = ?`)
			.bind(groupId)
			.first<{ prefill_json: string | null }>();
		if (row?.prefill_json) {
			try {
				const prefill = JSON.parse(row.prefill_json) as ReconcilePrefill;
				const { results: photos } = await db
					.prepare(
						`SELECT platform, image_url, url FROM reconcile_listing
						 WHERE group_id = ? AND image_url IS NOT NULL
						 ORDER BY platform, id`
					)
					.bind(groupId)
					.all<{ platform: string; image_url: string; url: string | null }>();
				reconcile = { groupId, prefill, photos };
			} catch {
				reconcile = null;
			}
		}
	}

	return {
		categories: categories.results as CategoryRow[],
		brands: brands.results as Array<{ id: number; code: string; name: string }>,
		bins: bins.results as Array<{ id: number; bin_code: string; depth: number; path: string }>,
		attrValues: attrValues.results as AttributeValueRow[],
		reconcile
	};
};

export const actions: Actions = {
	default: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();

		const title = (form.get('title') ?? '').toString().trim();
		// For now: if no description was given, copy the title into it so the
		// item is never blank (a baseline; can be refined later).
		const description = (form.get('description') ?? '').toString().trim() || title || null;
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

		// Reconcile onboarding: if we arrived from the wizard's "Have it",
		// link every platform listing in the group to this new item (with
		// the correct external ids + URLs) and mark the group resolved, then
		// return to the wizard for the next product.
		const reconcileGroupRaw = form.get('reconcile_group_id')?.toString();
		if (reconcileGroupRaw && /^\d+$/.test(reconcileGroupRaw)) {
			const groupId = parseInt(reconcileGroupRaw, 10);
			const decision = stockQty === 0 ? 'future' : 'have';
			await adoptGroupListings(db, groupId, itemRow.id, title, priceCents);
			await db
				.prepare(
					`UPDATE reconcile_group
					 SET decision = ?, item_id = ?, resolved_at = datetime('now'),
					     updated_at = datetime('now')
					 WHERE id = ?`
				)
				.bind(decision, itemRow.id, groupId)
				.run();

			const ssKey = event.platform?.env?.SQUARESPACE_API_KEY;
			const r2 = event.platform?.env?.PHOTOS;
			const params = new URLSearchParams();

			// ALWAYS pull photos from whatever the item is linked to — Squarespace,
			// Reverb, or eBay (the adopt step only links the listings, it doesn't
			// copy images). Runs on every "Have it" onboard regardless of the
			// sellable toggle, so items that live only on Reverb/eBay still get
			// template images. Best-effort + bounded; no-op when there's no source.
			if (r2) {
				try {
					let ebayCreds;
					try {
						ebayCreds = await resolveEbayCreds(db, event.platform?.env);
					} catch {
						ebayCreds = undefined;
					}
					const n = (
						await importItemPhotosFromAnySource(
							db,
							r2,
							{ ssKey, reverbKey: event.platform?.env?.REVERB_API_KEY, ebayCreds },
							itemRow.id,
							8
						)
					).added;
					if (n > 0) params.set('photos', String(n));
				} catch {
					/* non-fatal */
				}
			}

			// "Sell on Squarespace" ticked → mark sellable + publish.
			if (form.get('make_sellable') === 'on') {
				const r = await publishItemAsSellable(db, ssKey, itemRow.id);

				// Not on Squarespace yet (nothing to sync) → send Dad to the full
				// listing editor to BUILD + push it: add photos, AI description,
				// title, storefront. He returns to the wizard from there.
				if (r.sync.status === 'skipped') {
					throw redirect(
						303,
						`/items/${encodeURIComponent(sku)}/listings/squarespace?from=reconcile`
					);
				}

				if (r.sku) params.set('published', r.sku);
				params.set('pub', r.sync.status === 'ok' ? 'ok' : 'err');
				if (r.sync.status === 'error') params.set('pubmsg', r.sync.message.slice(0, 160));
				if (r.seoMissing) params.set('seo', '1');
			}

			const qs = params.toString();
			throw redirect(303, `/reconcile/wizard${qs ? `?${qs}` : ''}`);
		}

		throw redirect(303, `/items?just_added=${encodeURIComponent(sku)}`);
	}
};
