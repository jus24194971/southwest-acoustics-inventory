import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import {
	loadListing,
	upsertListingContent,
	recordSyncResult,
	type ListingStatus
} from '$lib/server/listings';
import {
	listCategories,
	listConditions,
	createListing,
	updateListing,
	mapInternalConditionToReverbUuid,
	ReverbError,
	type ReverbListingCreatePayload,
	type ReverbCategory,
	type ReverbCondition
} from '$lib/server/reverb';
import { getProduct as getSquarespaceProduct } from '$lib/server/squarespace';

/**
 * /items/[sku]/listings/reverb — Reverb listing editor.
 *
 * Loads:
 *   - the item itself + photo URLs
 *   - the marketplace_listing row for (item, reverb)
 *   - the marketplace_listing row for (item, squarespace) if any —
 *     used as a SECONDARY source of prefill defaults (Dad usually
 *     pushes SS first, then mirrors to Reverb)
 *   - Reverb's categories + conditions taxonomy (fetched live; small
 *     enough at ~700 entries to send to the client)
 *
 * Push path:
 *   1. If a SS listing exists with external_id, GET the SS product
 *      to extract public CDN image URLs. Reverb fetches images by
 *      URL, so we skip ImageBB / public R2 entirely.
 *   2. Build the Reverb create payload from form values + item data.
 *   3. POST /api/listings (or PUT /api/my/listings/{id} on update).
 *   4. Store the returned id + slug + url back in marketplace_listing.
 */

interface ItemRow {
	id: number;
	sku: string;
	title: string;
	description: string | null;
	description_html: string | null;
	price_cents: number | null;
	stock_qty: number;
	tracking_mode: 'serialized' | 'stocked';
	condition: string;
	model: string | null;
	year_received: number;
	brand_name: string | null;
	brand_code: string | null;
	cat_code: string;
	cat_name: string;
}

interface PhotoRow {
	r2_key: string;
	source_url: string | null;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const sku = event.params.sku;

	const item = await db
		.prepare(
			`SELECT i.id, i.sku, i.title, i.description, i.description_html,
			        i.price_cents, i.stock_qty, i.tracking_mode, i.condition,
			        i.model, i.year_received,
			        b.name AS brand_name, b.code AS brand_code,
			        c.code AS cat_code, c.name AS cat_name
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 LEFT JOIN brand b ON b.id = i.brand_id
			 WHERE i.sku = ? AND i.deleted_at IS NULL`
		)
		.bind(sku)
		.first<ItemRow>();
	if (!item) throw error(404, `No item with SKU ${sku}`);

	// Our own Reverb listing row (may not exist yet — the splitOff flow
	// pre-creates drafts for all platforms, but item-create doesn't).
	const reverbListing = await loadListing(db, item.id, 'reverb');

	// Squarespace listing for prefill — title / description / price /
	// images all live there once Dad's pushed to SS.
	const ssListing = await loadListing(db, item.id, 'squarespace');

	// Local photo list as a fallback when SS hasn't been pushed yet.
	const { results: photoRows } = await db
		.prepare(
			`SELECT r2_key, source_url FROM item_photo
			 WHERE item_id = ? AND deleted_at IS NULL
			 ORDER BY position, id`
		)
		.bind(item.id)
		.all<PhotoRow>();

	// Reverb taxonomy. Two parallel fetches when the key's present;
	// degrades to empty arrays + a banner if missing/failing.
	let categories: ReverbCategory[] = [];
	let conditions: ReverbCondition[] = [];
	let taxonomyError: string | null = null;
	const apiKey = event.platform?.env?.REVERB_API_KEY;
	if (apiKey) {
		try {
			[categories, conditions] = await Promise.all([
				listCategories(apiKey),
				listConditions(apiKey)
			]);
		} catch (err) {
			taxonomyError = err instanceof Error ? err.message : String(err);
		}
	} else {
		taxonomyError = 'REVERB_API_KEY not set on this environment.';
	}

	return {
		item,
		reverbListing,
		ssListing,
		photoCount: photoRows.length,
		hasSquarespacePhotos:
			!!ssListing?.external_id && !!event.platform?.env?.SQUARESPACE_API_KEY,
		categories,
		conditions,
		taxonomyError,
		hasApiKey: !!apiKey
	};
};

// ---------- Form parsing ----------------------------------------------

interface ParsedForm {
	title: string;
	descriptionHtml: string;
	priceAmount: string; // decimal string for Reverb's Money type
	make: string;
	model: string;
	year: string;
	finish: string;
	categoryUuid: string;
	conditionUuid: string;
	shippingAmount: string; // decimal string or empty for free
	freeShipping: boolean;
	publish: boolean;
	upc: string;
	upcDoesNotApply: boolean;
}

function parseFormData(form: FormData): ParsedForm {
	return {
		title: (form.get('listing_title') ?? '').toString().trim(),
		descriptionHtml: (form.get('listing_description_html') ?? '').toString(),
		priceAmount: (form.get('listing_price') ?? '').toString().trim(),
		make: (form.get('reverb_make') ?? '').toString().trim(),
		model: (form.get('reverb_model') ?? '').toString().trim(),
		year: (form.get('reverb_year') ?? '').toString().trim(),
		finish: (form.get('reverb_finish') ?? '').toString().trim(),
		categoryUuid: (form.get('reverb_category_uuid') ?? '').toString().trim(),
		conditionUuid: (form.get('reverb_condition_uuid') ?? '').toString().trim(),
		shippingAmount: (form.get('reverb_shipping_amount') ?? '').toString().trim(),
		freeShipping: form.get('reverb_free_shipping') === 'on',
		publish: form.get('reverb_publish') === 'on',
		upc: (form.get('reverb_upc') ?? '').toString().trim(),
		upcDoesNotApply: form.get('reverb_upc_does_not_apply') === 'on'
	};
}

/**
 * Persist the locally-editable fields. Reverb-specific values
 * (category, condition, make/model/year/finish, shipping amount)
 * live in marketplace_listing.platform_extras_json since they don't
 * fit the platform-agnostic columns.
 */
async function persistLocal(
	db: import('@cloudflare/workers-types').D1Database,
	itemId: number,
	parsed: ParsedForm,
	status: ListingStatus
): Promise<void> {
	const priceCents = parsed.priceAmount
		? Math.round(parseFloat(parsed.priceAmount) * 100)
		: null;

	const extras = {
		reverb_make: parsed.make || null,
		reverb_model: parsed.model || null,
		reverb_year: parsed.year || null,
		reverb_finish: parsed.finish || null,
		reverb_category_uuid: parsed.categoryUuid || null,
		reverb_condition_uuid: parsed.conditionUuid || null,
		reverb_shipping_amount: parsed.shippingAmount || null,
		reverb_free_shipping: parsed.freeShipping,
		reverb_upc: parsed.upc || null,
		reverb_upc_does_not_apply: parsed.upcDoesNotApply
	};

	await upsertListingContent(db, itemId, 'reverb', {
		listing_title: parsed.title || null,
		listing_description_html: parsed.descriptionHtml || null,
		listing_url_slug: null,
		listing_tags_json: null,
		listing_price_cents: priceCents,
		listing_visible: parsed.publish ? 1 : 0,
		storefront_id: null,
		status,
		listing_categories_json: null,
		listing_free_shipping: parsed.freeShipping ? 1 : 0,
		listing_weight_oz: null
	});

	// platform_extras_json gets a separate write since upsertListingContent
	// doesn't include it (it's a Reverb-only field for now).
	await db
		.prepare(
			`UPDATE marketplace_listing
			 SET platform_extras_json = ?, updated_at = datetime('now')
			 WHERE item_id = ? AND platform = 'reverb'`
		)
		.bind(JSON.stringify(extras), itemId)
		.run();
}

export const actions: Actions = {
	save: async (event) => {
		const db = getDB(event);
		const item = await db
			.prepare(`SELECT id FROM item WHERE sku = ? AND deleted_at IS NULL`)
			.bind(event.params.sku)
			.first<{ id: number }>();
		if (!item) throw error(404);

		const form = await event.request.formData();
		const parsed = parseFormData(form);
		const targetStatus = (form.get('target_status') ?? 'draft').toString() as ListingStatus;

		await persistLocal(db, item.id, parsed, targetStatus);
		throw redirect(303, `/items/${event.params.sku}/listings/reverb?saved=1`);
	},

	push: async (event) => {
		const db = getDB(event);
		const reverbKey = event.platform?.env?.REVERB_API_KEY;
		if (!reverbKey)
			return fail(400, { pushError: 'REVERB_API_KEY not configured.' });

		const item = await db
			.prepare(
				`SELECT i.id, i.sku, i.title, i.description, i.description_html,
				        i.price_cents, i.condition, i.model, i.year_received,
				        b.name AS brand_name, b.code AS brand_code,
				        c.code AS cat_code
				 FROM item i
				 JOIN category c ON c.id = i.category_id
				 LEFT JOIN brand b ON b.id = i.brand_id
				 WHERE i.sku = ? AND i.deleted_at IS NULL`
			)
			.bind(event.params.sku)
			.first<{
				id: number;
				sku: string;
				title: string;
				description: string | null;
				description_html: string | null;
				price_cents: number | null;
				condition: string;
				model: string | null;
				year_received: number;
				brand_name: string | null;
				brand_code: string | null;
				cat_code: string;
			}>();
		if (!item) throw error(404);

		const form = await event.request.formData();
		const parsed = parseFormData(form);

		// Persist locally first so failures don't drop user input.
		await persistLocal(db, item.id, parsed, 'ready');

		// Required-field checks before hitting Reverb.
		if (!parsed.title && !item.title) {
			return fail(400, { pushError: 'Title required.' });
		}
		if (!parsed.categoryUuid) {
			return fail(400, { pushError: 'Reverb category is required.' });
		}
		if (!parsed.conditionUuid) {
			return fail(400, {
				pushError: 'Reverb condition is required. Pick one from the dropdown.'
			});
		}
		const priceAmount = parsed.priceAmount
			? parsed.priceAmount
			: item.price_cents != null
				? (item.price_cents / 100).toFixed(2)
				: '';
		if (!priceAmount) {
			return fail(400, { pushError: 'Price required.' });
		}

		// ---- Image URLs ------------------------------------------------
		// Pull from the SS product if available; that gives us public
		// CDN URLs Reverb can fetch. Without SS, Reverb has no usable
		// source for our R2-hosted photos (Cloudflare Access blocks
		// SS / Reverb / anyone else from reading them).
		let photoUrls: string[] = [];
		const ssApiKey = event.platform?.env?.SQUARESPACE_API_KEY;
		const ssListing = await loadListing(db, item.id, 'squarespace');
		if (ssListing?.external_id && ssApiKey) {
			try {
				const ssProduct = await getSquarespaceProduct(ssApiKey, ssListing.external_id);
				photoUrls = (ssProduct.images ?? [])
					.map((img) => img.url)
					.filter((u): u is string => typeof u === 'string' && u.length > 0);
			} catch (err) {
				// Photo failure shouldn't block the listing create — Reverb
				// still accepts listings without photos, just with reduced
				// visibility. Log and continue.
				console.error('Reverb push: failed to fetch SS product photos', err);
			}
		}

		// ---- Build Reverb payload --------------------------------------
		const finalTitle = parsed.title || item.title;
		// Reverb wants plain or HTML description — they render it. Use
		// the rich-text field if there is one, else fall back to the
		// item's description_html, then plain description.
		const finalDescription =
			parsed.descriptionHtml ||
			item.description_html ||
			item.description ||
			'';
		const make = parsed.make || item.brand_name || 'Unknown';
		const model = parsed.model || item.model || finalTitle.slice(0, 40);
		const year = parsed.year || String(item.year_received);

		// UPC handling. Reverb requires Brand New items to either carry
		// a valid UPC/EAN string OR set upc_does_not_apply=true; without
		// either, the create call 400s with a "UPC required" error. For
		// other conditions UPC is optional, but for safety we always
		// send one of the two fields when the form provides them.
		const upcTrimmed = parsed.upc.trim();
		const hasUpc = upcTrimmed.length > 0 && !parsed.upcDoesNotApply;
		// If neither toggle nor a UPC string is provided, surface a
		// clean error rather than letting Reverb reject it for us.
		if (!hasUpc && !parsed.upcDoesNotApply) {
			return fail(400, {
				pushError:
					'Reverb requires either a UPC/EAN value OR the "UPC does not apply" checkbox to be set. Most of Dad\'s custom builds and used items qualify as "does not apply" — leave it checked unless this product has a real UPC.'
			});
		}

		const payload: ReverbListingCreatePayload = {
			make,
			model,
			title: finalTitle,
			description: finalDescription,
			condition: { uuid: parsed.conditionUuid },
			categories: [{ uuid: parsed.categoryUuid }],
			price: { amount: priceAmount, currency: 'USD' },
			sku: item.sku,
			year: year || undefined,
			finish: parsed.finish || undefined,
			photos: photoUrls.length > 0 ? photoUrls : undefined,
			publish: parsed.publish,
			// Exactly one of upc / upc_does_not_apply gets sent — never
			// both. Reverb's docs say "or", behaviour confirms that
			// sending both is what triggers the validation error.
			...(hasUpc
				? { upc: upcTrimmed }
				: { upc_does_not_apply: true })
		};

		// Shipping — free or flat rate. Default region is continental US
		// per Reverb conventions; XX (everywhere else) gets the same rate
		// for simplicity.
		if (parsed.freeShipping) {
			payload.shipping = {
				rates: [
					{
						rate: { amount: '0.00', currency: 'USD' },
						region_code: 'US_CON'
					}
				]
			};
		} else if (parsed.shippingAmount) {
			payload.shipping = {
				rates: [
					{
						rate: { amount: parsed.shippingAmount, currency: 'USD' },
						region_code: 'US_CON'
					}
				]
			};
		}

		// ---- Hit Reverb ------------------------------------------------
		const existingReverb = await loadListing(db, item.id, 'reverb');
		const isUpdate = !!existingReverb?.external_id;

		try {
			const result = isUpdate
				? await updateListing(reverbKey, existingReverb!.external_id!, payload)
				: await createListing(reverbKey, payload);

			const externalUrl =
				result._links?.web?.href ??
				(result.slug
					? `https://reverb.com/item/${result.slug}`
					: undefined);

			await recordSyncResult(db, item.id, 'reverb', {
				externalId: String(result.id),
				externalUrl: externalUrl ?? null,
				status: parsed.publish ? 'live' : 'draft',
				syncStatus: 'ok',
				syncError: null
			});

			const params = new URLSearchParams({ pushed: '1' });
			if (photoUrls.length > 0) params.set('photos', String(photoUrls.length));
			throw redirect(
				303,
				`/items/${event.params.sku}/listings/reverb?${params.toString()}`
			);
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			const message =
				err instanceof ReverbError
					? `HTTP ${err.httpStatus} from Reverb: ${err.body.slice(0, 500)}`
					: err instanceof Error
						? err.message
						: String(err);
			await recordSyncResult(db, item.id, 'reverb', {
				status: 'error',
				syncStatus: 'error',
				syncError: message
			});
			return fail(500, { pushError: message });
		}
	},

	unlinkFromReverb: async (event) => {
		const db = getDB(event);
		const item = await db
			.prepare(`SELECT id FROM item WHERE sku = ? AND deleted_at IS NULL`)
			.bind(event.params.sku)
			.first<{ id: number }>();
		if (!item) throw error(404);

		await db
			.prepare(
				`UPDATE marketplace_listing
				 SET external_id = NULL, external_variant_id = NULL, external_url = NULL,
				     status = 'draft',
				     last_synced_at = NULL,
				     last_sync_status = NULL,
				     last_sync_error = NULL,
				     updated_at = datetime('now')
				 WHERE item_id = ? AND platform = 'reverb'`
			)
			.bind(item.id)
			.run();

		throw redirect(303, `/items/${event.params.sku}/listings/reverb?unlinked=1`);
	}
};
