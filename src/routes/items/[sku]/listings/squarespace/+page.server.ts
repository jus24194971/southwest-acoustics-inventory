import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import {
	loadListing,
	upsertListingContent,
	recordSyncResult,
	defaultSlug,
	type ListingStatus
} from '$lib/server/listings';
import {
	listStorePages,
	createProduct,
	updateProduct,
	uploadProductImage,
	SquarespaceError,
	type SquarespaceProductWritePayload
} from '$lib/server/squarespace';
import {
	suggestCategoriesForItem,
	recordCategoryUsage,
	suggestFreeShipping,
	AUTO_CHECK_SCORE,
	type CategorySuggestion
} from '$lib/server/category_suggestions';

/**
 * /items/[sku]/listings/squarespace — Squarespace listing editor.
 *
 * Loads:
 *   - the item itself + photo URLs (read-only context)
 *   - the marketplace_listing row for this (item, squarespace) pair
 *     (created on first save if absent)
 *   - Dad's storefronts from SS, IF the API key is configured.
 *     Failure is non-fatal — the storefront picker just falls back to
 *     "type the ID manually".
 *
 * Actions:
 *   - `save`  → persist the listing content locally. Status optionally
 *               flips to draft / ready / paused based on the form's
 *               Save button.
 *   - `push`  → save AND push to Squarespace. Create on first push,
 *               update thereafter. Stores external_id + last_synced_at.
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
	cat_code: string;
	brand_code: string | null;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const sku = event.params.sku;

	// Pull the extra fields the suggestion engine needs (condition,
	// model, internal category code, brand code) so suggestions are
	// computable without a second query.
	const item = await db
		.prepare(
			`SELECT i.id, i.sku, i.title, i.description, i.description_html,
			        i.price_cents, i.stock_qty, i.tracking_mode, i.condition, i.model,
			        c.code AS cat_code, b.code AS brand_code
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 LEFT JOIN brand b ON b.id = i.brand_id
			 WHERE i.sku = ? AND i.deleted_at IS NULL`
		)
		.bind(sku)
		.first<ItemRow>();
	if (!item) throw error(404, `No item with SKU ${sku}`);

	const listing = await loadListing(db, item.id, 'squarespace');

	// Compute suggestions for this item. Always returned — the page
	// uses them as defaults when the listing has no manual categories
	// yet, and surfaces them as "✨" hints when the user has already
	// picked their own set.
	const suggestions: CategorySuggestion[] = await suggestCategoriesForItem(db, {
		cat_code: item.cat_code,
		brand_code: item.brand_code,
		model: item.model,
		condition: item.condition,
		tracking_mode: item.tracking_mode,
		stock_qty: item.stock_qty,
		title: item.title
	});
	const autoCheckedSlugs = suggestions
		.filter((s) => s.score >= AUTO_CHECK_SCORE)
		.map((s) => s.slug);

	const freeShippingSuggestion = suggestFreeShipping({
		cat_code: item.cat_code,
		brand_code: item.brand_code,
		model: item.model,
		condition: item.condition,
		tracking_mode: item.tracking_mode,
		stock_qty: item.stock_qty,
		title: item.title
	});

	// Try to fetch Squarespace storefronts so the picker is populated.
	// We swallow errors — if the API key isn't there or SS is down,
	// the picker falls back to a manual text input.
	let storefronts: Array<{ id: string; title: string }> = [];
	let storefrontsError: string | null = null;
	const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
	if (apiKey) {
		try {
			storefronts = await listStorePages(apiKey);
		} catch (err) {
			storefrontsError = err instanceof Error ? err.message : String(err);
		}
	} else {
		storefrontsError = 'SQUARESPACE_API_KEY not set on this environment.';
	}

	return {
		item,
		listing,
		storefronts,
		storefrontsError,
		hasApiKey: !!apiKey,
		hasAiKey: !!event.platform?.env?.ANTHROPIC_API_KEY,
		// Suggestion-engine output for the categories multi-select.
		suggestions,
		autoCheckedSlugs,
		freeShippingSuggestion
	};
};

// ---------- shared form-parsing helper -------------------------------

interface ParsedForm {
	title: string;
	descriptionHtml: string;
	urlSlug: string;
	tags: string[];
	priceCents: number | null;
	visible: number;
	storefrontId: string | null;
	categories: string[]; // SS sub-shop slugs (tag-driven)
	freeShipping: number; // 0/1
	weightOz: number | null;
}

function parseFormData(form: FormData): ParsedForm {
	const title = (form.get('listing_title') ?? '').toString().trim();
	const descriptionHtml = (form.get('listing_description_html') ?? '').toString();
	const urlSlug = (form.get('listing_url_slug') ?? '').toString().trim();
	const tagsRaw = (form.get('listing_tags') ?? '').toString();
	const tags = tagsRaw
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
	const priceStr = form.get('listing_price')?.toString().trim();
	const priceCents = priceStr ? Math.round(parseFloat(priceStr) * 100) : null;
	const visible = form.get('listing_visible') === 'on' ? 1 : 0;
	const storefrontId = (form.get('storefront_id') ?? '').toString().trim() || null;
	// Categories are submitted as multiple form values named "listing_category"
	// (one per checked checkbox). getAll preserves order.
	const categories = form
		.getAll('listing_category')
		.map((v) => v.toString().trim())
		.filter(Boolean);
	const freeShipping = form.get('listing_free_shipping') === 'on' ? 1 : 0;
	const weightStr = form.get('listing_weight_oz')?.toString().trim();
	const weightOz = weightStr ? parseFloat(weightStr) : null;

	return {
		title,
		descriptionHtml,
		urlSlug,
		tags,
		priceCents,
		visible,
		storefrontId,
		categories,
		freeShipping,
		weightOz: Number.isFinite(weightOz) ? weightOz : null
	};
}

/**
 * Merge user-typed tags with category slugs and the optional
 * free-shipping marker. Categories and free-shipping become tags on
 * Squarespace since SS doesn't expose them as first-class fields.
 * Deduplicates so a category that's also in manual tags doesn't
 * double up.
 */
function buildEffectiveTags(
	manualTags: string[],
	categories: string[],
	freeShipping: number
): string[] {
	const all = [...manualTags, ...categories];
	if (freeShipping === 1) all.push('free-shipping');
	return Array.from(new Set(all.filter((t) => t.length > 0)));
}

/**
 * Pull the item's internal category code + condition (the keys the
 * learning table uses) and record each picked SS category against
 * them. Called from save() and push() — every confirmed selection
 * sharpens the suggestion engine for future items of the same type.
 *
 * Best-effort: a learning failure shouldn't block the listing save.
 */
async function recordCategoryUsageForItem(
	db: import('@cloudflare/workers-types').D1Database,
	itemId: number,
	pickedCategorySlugs: string[]
): Promise<void> {
	if (pickedCategorySlugs.length === 0) return;
	try {
		const row = await db
			.prepare(
				`SELECT c.code AS cat_code, i.condition
				 FROM item i JOIN category c ON c.id = i.category_id
				 WHERE i.id = ?`
			)
			.bind(itemId)
			.first<{ cat_code: string; condition: string }>();
		if (!row) return;
		for (const slug of pickedCategorySlugs) {
			await recordCategoryUsage(db, row.cat_code, row.condition, slug);
		}
	} catch (err) {
		console.error('recordCategoryUsageForItem failed (non-fatal):', err);
	}
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

		await upsertListingContent(db, item.id, 'squarespace', {
			listing_title: parsed.title || null,
			listing_description_html: parsed.descriptionHtml || null,
			listing_url_slug: parsed.urlSlug || null,
			listing_tags_json: parsed.tags.length > 0 ? JSON.stringify(parsed.tags) : null,
			listing_price_cents: parsed.priceCents,
			listing_visible: parsed.visible,
			storefront_id: parsed.storefrontId,
			status: targetStatus,
			listing_categories_json:
				parsed.categories.length > 0 ? JSON.stringify(parsed.categories) : null,
			listing_free_shipping: parsed.freeShipping,
			listing_weight_oz: parsed.weightOz
		});

		// Feed the suggestion learning loop — every category Dad
		// confirms by saving gets a count bump for this item's
		// (internal category, condition) tuple.
		await recordCategoryUsageForItem(db, item.id, parsed.categories);

		throw redirect(303, `/items/${event.params.sku}/listings/squarespace?saved=1`);
	},

	push: async (event) => {
		const db = getDB(event);
		const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
		if (!apiKey) return fail(400, { pushError: 'SQUARESPACE_API_KEY not configured.' });

		const item = await db
			.prepare(
				`SELECT id, sku, title, description, description_html, price_cents,
				        stock_qty, tracking_mode
				 FROM item WHERE sku = ? AND deleted_at IS NULL`
			)
			.bind(event.params.sku)
			.first<ItemRow>();
		if (!item) throw error(404);

		const form = await event.request.formData();
		const parsed = parseFormData(form);
		const existing = await loadListing(db, item.id, 'squarespace');

		// Push is the strongest "I really mean it" signal — also feed
		// the learning loop with the picked categories.
		await recordCategoryUsageForItem(db, item.id, parsed.categories);

		// Persist the form first so the local copy reflects what we tried
		// to push, even if the push itself fails. Status stays 'ready'
		// here — recordSyncResult flips it to 'live' or 'error' after.
		await upsertListingContent(db, item.id, 'squarespace', {
			listing_title: parsed.title || null,
			listing_description_html: parsed.descriptionHtml || null,
			listing_url_slug: parsed.urlSlug || null,
			listing_tags_json: parsed.tags.length > 0 ? JSON.stringify(parsed.tags) : null,
			listing_price_cents: parsed.priceCents,
			listing_visible: parsed.visible,
			storefront_id: parsed.storefrontId,
			status: 'ready',
			listing_categories_json:
				parsed.categories.length > 0 ? JSON.stringify(parsed.categories) : null,
			listing_free_shipping: parsed.freeShipping,
			listing_weight_oz: parsed.weightOz
		});

		// Compose the SS payload using listing fields with fallback to
		// item fields (the "inherit from item" semantic).
		const finalName = parsed.title || item.title;
		const finalDesc = parsed.descriptionHtml || item.description_html || '';
		const finalSlug = parsed.urlSlug || defaultSlug(finalName);
		const finalPriceCents = parsed.priceCents ?? item.price_cents ?? 0;
		// Stock comes from the item's actual stock_qty for BOTH tracking
		// modes — serialized listings now live in 0..1, where 0 means
		// "out of stock, keep listing visible as Sold Out". Squarespace's
		// default storefront behavior with isVisible=true + qty=0 is to
		// render a "Sold Out" badge, which is exactly Dad's collection
		// display use case. (Previously we always pushed 1 for serialized
		// — bug that hid out-of-stock listings from the storefront.)
		const finalQty = item.stock_qty;

		// Tags pushed to SS = user-typed tags + chosen category slugs +
		// "free-shipping" if checked. The categories drive sub-shop
		// routing (e.g. "leo-jaymz-guitars" → /shop/leo-jaymz-guitars
		// page on Dad's storefront) and the free-shipping tag fires
		// his SS-side shipping rule.
		const effectiveTags = buildEffectiveTags(
			parsed.tags,
			parsed.categories,
			parsed.freeShipping
		);

		// Variant shipping measurements — weight only for now. SS uses
		// it for weight-based rate calculation. Skip the whole block
		// when no weight is set so we don't push a zero (which would
		// look like "this is weightless" rather than "we don't know").
		const variantPayload: SquarespaceProductWritePayload['variants'][number] = {
			sku: item.sku,
			pricing: {
				basePrice: { value: (finalPriceCents / 100).toFixed(2), currency: 'USD' }
			},
			stock: { quantity: finalQty, unlimited: false }
		};
		if (parsed.weightOz != null && parsed.weightOz > 0) {
			// SS only accepts POUND / KILOGRAM as the unit literal
			// (their API enum). We store oz in the DB for Dad's
			// convenience and convert here. Round to 3 decimals so
			// fractional ounces stay precise without floating-point
			// noise in the payload.
			const weightLb = Math.round((parsed.weightOz / 16) * 1000) / 1000;
			variantPayload.shippingMeasurements = {
				weight: { value: weightLb, unit: 'POUND' }
			};
		}

		const payload: SquarespaceProductWritePayload = {
			type: 'PHYSICAL',
			name: finalName,
			description: finalDesc,
			urlSlug: finalSlug,
			tags: effectiveTags,
			isVisible: parsed.visible === 1,
			variants: [variantPayload]
		};

		// New product needs storePageId; updates re-use whatever's there
		// (SS doesn't let you change storePageId via the API anyway).
		const isUpdate = !!existing?.external_id;
		if (!isUpdate) {
			if (!parsed.storefrontId) {
				await recordSyncResult(db, item.id, 'squarespace', {
					status: 'error',
					syncStatus: 'error',
					syncError: 'Storefront is required when creating a new Squarespace product.'
				});
				return fail(400, {
					pushError: 'Storefront is required when creating a new Squarespace product.'
				});
			}
			payload.storePageId = parsed.storefrontId;
		}

		try {
			const result = isUpdate
				? await updateProduct(apiKey, existing!.external_id!, payload)
				: await createProduct(apiKey, payload);

			// ---- Photo upload (new products only) -----------------
			// SS doesn't accept image URLs in the product payload, and
			// our R2 photos live behind Cloudflare Access — even if it
			// did, SS couldn't fetch them. So new products need their
			// photos uploaded explicitly as multipart binary.
			//
			// Updates skip this step: re-uploading on every update
			// would create duplicates on SS. If photos need refreshing
			// later we'll add a dedicated "Re-push photos" action.
			//
			// Best-effort: a photo failure logs an error but doesn't
			// fail the whole push. The product is already created at
			// this point, and partial photos beats no listing.
			const photoUploadErrors: string[] = [];
			let photosUploaded = 0;
			if (!isUpdate) {
				const r2 = event.platform?.env?.PHOTOS;
				const photoRows = await db
					.prepare(
						`SELECT r2_key, content_type
						 FROM item_photo
						 WHERE item_id = ? AND deleted_at IS NULL
						 ORDER BY position, id
						 LIMIT 20`
					)
					.bind(item.id)
					.all<{ r2_key: string; content_type: string | null }>();

				if (r2 && photoRows.results.length > 0) {
					for (const photo of photoRows.results) {
						try {
							const obj = await r2.get(photo.r2_key);
							if (!obj) {
								photoUploadErrors.push(`${photo.r2_key}: not in R2`);
								continue;
							}
							const bytes = await obj.arrayBuffer();
							const ct =
								photo.content_type ??
								obj.httpMetadata?.contentType ??
								'image/jpeg';
							const filename =
								photo.r2_key.split('/').pop() ?? 'photo.jpg';
							await uploadProductImage(apiKey, result.id, bytes, ct, filename);
							photosUploaded++;
						} catch (err) {
							const msg = err instanceof SquarespaceError
								? `HTTP ${err.httpStatus}: ${err.body.slice(0, 120)}`
								: err instanceof Error
									? err.message
									: String(err);
							photoUploadErrors.push(`${photo.r2_key}: ${msg}`);
						}
					}
				}
			}

			const firstVariant = result.variants?.[0];
			// Sync status reflects the product push only — photo
			// failures get separately surfaced via the redirect param
			// so the listing isn't marked "error" just because one
			// photo failed.
			await recordSyncResult(db, item.id, 'squarespace', {
				externalId: result.id,
				externalVariantId: firstVariant?.id ?? null,
				externalUrl: result.urlSlug
					? `https://${new URL(event.url).hostname.replace('sw-acoustics-inventory.pages.dev', 'squarespace.com')}/${result.urlSlug}`
					: null,
				status: parsed.visible === 1 ? 'live' : 'paused',
				syncStatus: 'ok',
				syncError:
					photoUploadErrors.length > 0
						? `Listing pushed ok, but ${photoUploadErrors.length} photo(s) failed: ${photoUploadErrors.slice(0, 3).join('; ')}`
						: null
			});

			const params = new URLSearchParams({ pushed: '1' });
			if (photosUploaded > 0) params.set('photos', String(photosUploaded));
			if (photoUploadErrors.length > 0)
				params.set(
					'photo_warn',
					`${photoUploadErrors.length} of ${photosUploaded + photoUploadErrors.length} photos failed to upload`
				);
			throw redirect(
				303,
				`/items/${event.params.sku}/listings/squarespace?${params.toString()}`
			);
		} catch (err) {
			// SvelteKit's `redirect` throws a control-flow object — let it
			// bubble. Real errors get recorded + returned.
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;

			const message =
				err instanceof SquarespaceError
					? `HTTP ${err.httpStatus} from Squarespace: ${err.body.slice(0, 400)}`
					: err instanceof Error
						? err.message
						: String(err);

			await recordSyncResult(db, item.id, 'squarespace', {
				status: 'error',
				syncStatus: 'error',
				syncError: message
			});
			return fail(500, { pushError: message });
		}
	},

	// ============================================================
	// Re-push photos to an existing SS listing
	// ============================================================
	//
	// Use case: the listing was pushed before photo support was wired,
	// or photos were added in the inventory app after the initial push,
	// or some photos failed during the create step and need a retry.
	// This action targets the existing SS product (by external_id) and
	// uploads every current R2 photo via the multipart endpoint.
	//
	// Caveat: SS doesn't deduplicate. If photos are already on the SS
	// product, this run will add them again. The UI warns Dad about
	// that — for the missing-photos recovery case it's exactly what's
	// wanted; for a full refresh he'd want to delete on SS first.

	repushPhotos: async (event) => {
		const db = getDB(event);
		const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
		if (!apiKey) return fail(400, { pushError: 'SQUARESPACE_API_KEY not configured.' });

		const item = await db
			.prepare(`SELECT id, sku FROM item WHERE sku = ? AND deleted_at IS NULL`)
			.bind(event.params.sku)
			.first<{ id: number; sku: string }>();
		if (!item) throw error(404);

		const listing = await loadListing(db, item.id, 'squarespace');
		if (!listing?.external_id) {
			return fail(400, {
				pushError: 'No Squarespace product yet — push the listing first to create it.'
			});
		}

		const r2 = event.platform?.env?.PHOTOS;
		if (!r2) return fail(500, { pushError: 'R2 binding missing.' });

		const photoRows = await db
			.prepare(
				`SELECT r2_key, content_type
				 FROM item_photo
				 WHERE item_id = ? AND deleted_at IS NULL
				 ORDER BY position, id
				 LIMIT 20`
			)
			.bind(item.id)
			.all<{ r2_key: string; content_type: string | null }>();

		if (photoRows.results.length === 0) {
			return fail(400, {
				pushError: 'This item has no photos in inventory. Add photos first, then re-push.'
			});
		}

		const errors: string[] = [];
		let uploaded = 0;
		for (const photo of photoRows.results) {
			try {
				const obj = await r2.get(photo.r2_key);
				if (!obj) {
					errors.push(`${photo.r2_key}: not in R2`);
					continue;
				}
				const bytes = await obj.arrayBuffer();
				const ct = photo.content_type ?? obj.httpMetadata?.contentType ?? 'image/jpeg';
				const filename = photo.r2_key.split('/').pop() ?? 'photo.jpg';
				await uploadProductImage(apiKey, listing.external_id, bytes, ct, filename);
				uploaded++;
			} catch (err) {
				const msg =
					err instanceof SquarespaceError
						? `HTTP ${err.httpStatus}: ${err.body.slice(0, 120)}`
						: err instanceof Error
							? err.message
							: String(err);
				errors.push(`${photo.r2_key}: ${msg}`);
			}
		}

		// Surface a sync note about the photo refresh — listing status
		// stays live (the product itself is fine; this is a side action).
		if (errors.length > 0) {
			await recordSyncResult(db, item.id, 'squarespace', {
				status: listing.status,
				syncStatus: 'ok',
				syncError: `Photo re-push: ${uploaded} uploaded, ${errors.length} failed: ${errors.slice(0, 3).join('; ')}`
			});
		} else if (uploaded > 0) {
			await recordSyncResult(db, item.id, 'squarespace', {
				status: listing.status,
				syncStatus: 'ok',
				syncError: null
			});
		}

		const params = new URLSearchParams({
			pushed: '1',
			photos: String(uploaded),
			photo_action: 'repush'
		});
		if (errors.length > 0) {
			params.set(
				'photo_warn',
				`${errors.length} of ${uploaded + errors.length} photos failed to upload`
			);
		}
		throw redirect(303, `/items/${event.params.sku}/listings/squarespace?${params.toString()}`);
	}
};
