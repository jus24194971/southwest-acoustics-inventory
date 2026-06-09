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
	updateProductFull,
	getProduct,
	findProductBySku,
	findProductBySlug,
	SquarespaceError,
	type SquarespaceProduct,
	type SquarespaceProductWritePayload
} from '$lib/server/squarespace';
import { saveUploadedItemPhotos, MAX_PHOTOS_PER_UPLOAD } from '$lib/server/item_photos';
import { importItemPhotosFromAnySource } from '$lib/server/squarespace_import';
import { resolveEbayCreds } from '$lib/server/ebay_credentials';
// Category suggestion engine + per-listing category/shipping pickers
// were removed once we confirmed the SS Products API rejects both
// the `categories` and shipping-cost fields on writes. The DB columns
// (`listing_categories_json`, `listing_free_shipping`, `listing_weight_oz`)
// stay in the schema as dead columns and the engine code in
// `$lib/server/category_suggestions` is still there for the day SS
// opens those endpoints up.

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
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const sku = event.params.sku;

	const item = await db
		.prepare(
			`SELECT id, sku, title, description, description_html,
			        price_cents, stock_qty, tracking_mode, condition
			 FROM item
			 WHERE sku = ? AND deleted_at IS NULL`
		)
		.bind(sku)
		.first<ItemRow>();
	if (!item) throw error(404, `No item with SKU ${sku}`);

	const listing = await loadListing(db, item.id, 'squarespace');

	// Photo keys for the CLIENT-SIDE photo upload. We no longer transcode
	// images inside the Worker (Photon WASM blew the per-request CPU /
	// memory limit on multi-photo pushes). Instead the browser fetches
	// each photo, transcodes to JPEG on a canvas (no CPU cap there), and
	// uploads them one at a time to a thin relay endpoint.
	const { results: photoRows } = await db
		.prepare(
			`SELECT id, r2_key FROM item_photo
			 WHERE item_id = ? AND deleted_at IS NULL
			 ORDER BY position, id LIMIT 20`
		)
		.bind(item.id)
		.all<{ id: number; r2_key: string }>();

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
		photos: photoRows
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
	seoTitle: string | null;
	seoDescription: string | null;
}

/** SS hard cap for the SEO TITLE input. SS admin enforces this; we
 *  truncate proactively so the API never has to reject a too-long
 *  string at push time. */
const SEO_TITLE_MAX = 100;
/** SS hard cap for the SEO DESCRIPTION input. Same rationale. */
const SEO_DESCRIPTION_MAX = 400;

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

	// SEO fields. Empty string → null (meaning "let SS auto-derive").
	// Truncate to SS hard caps server-side so we don't fail at push
	// time on a too-long string the UI counter missed.
	const seoTitleRaw = (form.get('listing_seo_title') ?? '').toString().trim();
	const seoDescRaw = (form.get('listing_seo_description') ?? '').toString().trim();
	const seoTitle = seoTitleRaw ? seoTitleRaw.slice(0, SEO_TITLE_MAX) : null;
	const seoDescription = seoDescRaw ? seoDescRaw.slice(0, SEO_DESCRIPTION_MAX) : null;

	return {
		title,
		descriptionHtml,
		urlSlug,
		tags,
		priceCents,
		visible,
		storefrontId,
		seoTitle,
		seoDescription
	};
}

/**
 * Run a create-or-update product call, retrying on
 * URL_SLUG_UNAVAILABLE with progressively-unique slugs.
 *
 * Squarespace reserves a slug for a grace window after a product is
 * deleted, AND a push that crashed mid-flight can leave ORPHAN products
 * on SS holding the slug. (Concretely: the old in-Worker photo transcode
 * blew the resource limit AFTER createProduct succeeded but BEFORE we
 * saved the external_id, so each retried push made a fresh duplicate.)
 * When several orphans exist, both the base slug and the first
 * id-suffixed slug can already be taken — so a single retry isn't
 * enough. We walk a short list of candidate slugs until one is free.
 *
 * `call` is the actual API call (create OR update); it must read the
 * slug from `payload`, which we mutate before each attempt. On success
 * `payload.urlSlug` holds the winning slug so the caller can persist it
 * back to marketplace_listing. Non-slug errors (e.g. a 404 from an
 * update against a deleted product) bubble up unchanged on the first
 * attempt so the caller's own recovery logic still fires.
 */
async function pushWithSlugRetry<T>(
	payload: SquarespaceProductWritePayload,
	fallbackSuffix: string | number,
	call: () => Promise<T>
): Promise<{ result: T; slugWasSuffixed: boolean }> {
	const base = (payload.urlSlug ?? '').replace(/-+$/g, '');
	const suffix = String(fallbackSuffix);
	// First the original slug, then the clean id-suffixed slug, then a
	// few numbered fallbacks for the multi-orphan case.
	const candidates = base
		? [base, `${base}-${suffix}`, `${base}-${suffix}-2`, `${base}-${suffix}-3`, `${base}-${suffix}-4`]
		: [suffix, `${suffix}-2`, `${suffix}-3`, `${suffix}-4`];

	let lastErr: unknown;
	for (let i = 0; i < candidates.length; i++) {
		payload.urlSlug = candidates[i];
		try {
			const result = await call();
			return { result, slugWasSuffixed: i > 0 };
		} catch (err) {
			const slugTaken =
				err instanceof SquarespaceError &&
				err.httpStatus === 409 &&
				err.body.includes('URL_SLUG_UNAVAILABLE');
			// Only the slug-conflict is retryable. Anything else (404/405
			// missing product, auth, validation) bubbles immediately.
			if (!slugTaken) throw err;
			lastErr = err;
		}
	}
	throw lastErr;
}

/**
 * Create a product — but if Squarespace says the slug is already taken
 * (URL_SLUG_UNAVAILABLE), ADOPT the product that owns that slug instead
 * of creating a suffixed duplicate. The slug being in use means the
 * product already exists (commonly one of Dad's original listings, whose
 * own SKU doesn't match ours so adopt-by-SKU missed it). We update it in
 * place and link to it. Only if we genuinely can't find the owner do we
 * fall back to the suffixed-slug create.
 */
async function createOrAdoptBySlug(
	apiKey: string,
	payload: SquarespaceProductWritePayload,
	itemId: number
): Promise<{ result: SquarespaceProduct; adopted: boolean; adoptedHasImages: boolean }> {
	try {
		const result = await createProduct(apiKey, payload);
		return { result, adopted: false, adoptedHasImages: false };
	} catch (err) {
		const slugTaken =
			err instanceof SquarespaceError &&
			err.httpStatus === 409 &&
			err.body.includes('URL_SLUG_UNAVAILABLE');
		if (!slugTaken) throw err;

		const owner = await findProductBySlug(apiKey, payload.urlSlug ?? '');
		if (owner) {
			const result = await updateProductFull(apiKey, owner.id, payload);
			return { result, adopted: true, adoptedHasImages: (owner.images?.length ?? 0) > 0 };
		}
		// Couldn't locate the slug's owner — fall back to a suffixed create.
		const r = await pushWithSlugRetry(payload, itemId, () => createProduct(apiKey, payload));
		return { result: r.result, adopted: false, adoptedHasImages: false };
	}
}

export const actions: Actions = {
	// Link this item to an EXISTING Squarespace listing by URL — for products
	// the auto-match missed (title/slug/SKU all diverge from ours). Paste the
	// listing URL; we find the product by its slug, wire up the link, and pull
	// its photos in. (The reverse of "push", which creates/updates on SS.)
	linkExisting: async (event) => {
		const db = getDB(event);
		const env = event.platform?.env;
		const apiKey = env?.SQUARESPACE_API_KEY;
		if (!apiKey) return fail(400, { linkError: 'SQUARESPACE_API_KEY not configured.' });
		const item = await db
			.prepare(`SELECT id FROM item WHERE sku = ? AND deleted_at IS NULL`)
			.bind(event.params.sku)
			.first<{ id: number }>();
		if (!item) throw error(404);

		const form = await event.request.formData();
		const raw = (form.get('ss_url') ?? '').toString().trim();
		// Accept a full URL or a bare slug — the slug is the last path segment.
		const slug = (raw.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() ?? '').trim();
		if (!slug) return fail(400, { linkError: 'Paste the Squarespace listing URL (or its slug).' });

		let product: SquarespaceProduct | null;
		try {
			product = await findProductBySlug(apiKey, slug, 50);
		} catch (err) {
			return fail(500, {
				linkError: `Squarespace lookup failed: ${err instanceof Error ? err.message : 'unknown error'}`
			});
		}
		if (!product) {
			return fail(404, {
				linkError: `Couldn’t find a Squarespace product for “${slug}”. Double-check the URL.`
			});
		}

		const url = product.url ?? `https://www.southwestacousticproducts.com/shop/p/${slug}`;
		await db
			.prepare(
				`INSERT INTO marketplace_listing
				   (item_id, platform, status, external_id, external_variant_id, external_url,
				    listing_url_slug, last_synced_at, last_sync_status)
				 VALUES (?, 'squarespace', 'live', ?, ?, ?, ?, datetime('now'), 'ok')
				 ON CONFLICT (item_id, platform) DO UPDATE SET
				   external_id = excluded.external_id,
				   external_variant_id = excluded.external_variant_id,
				   external_url = excluded.external_url,
				   listing_url_slug = excluded.listing_url_slug,
				   status = 'live', last_synced_at = datetime('now'),
				   last_sync_status = 'ok', last_sync_error = NULL, updated_at = datetime('now')`
			)
			.bind(item.id, product.id, product.variants?.[0]?.id ?? null, url, slug)
			.run();

		// Pull the now-linked product's photos in too (best-effort).
		const sp = new URLSearchParams({ linked: '1' });
		const r2 = env?.PHOTOS;
		if (r2) {
			try {
				let ebayCreds;
				try {
					ebayCreds = await resolveEbayCreds(db, env);
				} catch {
					ebayCreds = undefined;
				}
				const n = (
					await importItemPhotosFromAnySource(
						db,
						r2,
						{ ssKey: apiKey, reverbKey: env?.REVERB_API_KEY, ebayCreds },
						item.id,
						12
					)
				).added;
				if (n > 0) sp.set('photos', String(n));
			} catch {
				/* non-fatal */
			}
		}
		throw redirect(303, `/items/${event.params.sku}/listings/squarespace?${sp.toString()}`);
	},

	// Add photos to the ITEM right from the listing editor, so this page is a
	// one-stop "list it on Squarespace" surface (photos + title + AI
	// description + push). The reconcile wizard routes here for sellable items
	// that aren't on Squarespace yet, and those often arrive photoless. Same
	// store/validate path as the item detail page (shared helper).
	uploadPhotos: async (event) => {
		const db = getDB(event);
		const r2 = event.platform?.env?.PHOTOS;
		if (!r2) return fail(500, { photoError: 'R2 binding missing — server misconfig.' });
		const item = await db
			.prepare(`SELECT id FROM item WHERE sku = ? AND deleted_at IS NULL`)
			.bind(event.params.sku)
			.first<{ id: number }>();
		if (!item) throw error(404);

		const form = await event.request.formData();
		const files = form.getAll('photos').filter((v): v is File => v instanceof File);
		if (files.length === 0) return fail(400, { photoError: 'Pick at least one photo to upload.' });
		if (files.length > MAX_PHOTOS_PER_UPLOAD) {
			return fail(400, { photoError: `Up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time, please.` });
		}

		const { added, rejected } = await saveUploadedItemPhotos(db, r2, item.id, files);
		if (added === 0) {
			return fail(400, {
				photoError:
					'No photos uploaded. ' + (rejected.length ? rejected.join('; ') : 'Try jpg/png/webp.')
			});
		}

		const sp = new URLSearchParams({ photos_added: String(added) });
		if (rejected.length > 0) sp.set('photo_warn', 'Skipped: ' + rejected.join('; '));
		// Keep the wizard context (carried in a hidden field, since the
		// `?/uploadPhotos` action URL drops the page's query string) so the
		// "back to review" link survives an upload.
		if ((form.get('from') ?? '').toString() === 'reconcile') sp.set('from', 'reconcile');
		throw redirect(303, `/items/${event.params.sku}/listings/squarespace?${sp.toString()}`);
	},

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
			// Sub-shop categories + per-listing shipping aren't exposed
			// on the SS API; the editor used to collect them, the inputs
			// were removed once we confirmed the push payload rejects
			// both fields. Columns kept in the schema as dead columns.
			listing_categories_json: null,
			listing_free_shipping: 0,
			listing_weight_oz: null,
			listing_seo_title: parsed.seoTitle,
			listing_seo_description: parsed.seoDescription
		});

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
			listing_categories_json: null,
			listing_free_shipping: 0,
			listing_weight_oz: null,
			listing_seo_title: parsed.seoTitle,
			listing_seo_description: parsed.seoDescription
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

		// Tags pushed to SS = user-typed tags only. We used to merge in
		// category slugs (for sub-shop URL filtering) and a
		// "free-shipping" marker; both went away with the editor
		// cleanup since Dad doesn't use the tag-driven shipping rule
		// and the category routing is handled by SS admin's manual
		// Categories assignment.
		const effectiveTags = Array.from(
			new Set(parsed.tags.filter((t) => t.length > 0))
		);

		const variantPayload: SquarespaceProductWritePayload['variants'][number] = {
			sku: item.sku,
			pricing: {
				basePrice: { value: (finalPriceCents / 100).toFixed(2), currency: 'USD' }
			},
			stock: { quantity: finalQty, unlimited: false }
		};

		const payload: SquarespaceProductWritePayload = {
			type: 'PHYSICAL',
			name: finalName,
			description: finalDesc,
			urlSlug: finalSlug,
			tags: effectiveTags,
			isVisible: parsed.visible === 1,
			variants: [variantPayload]
		};

		// SEO override is intentionally NOT pushed.
		//
		// Both candidate write field names (`seoData` and `seoOptions`)
		// are rejected by the Products API with HTTP 400 "unknown or
		// readonly fields". Same dead-end as Categories and Fulfillment
		// Profile — the field is exposed on reads (the GET response
		// includes `seoOptions: null`) but writes are admin-UI only.
		//
		// We still PERSIST the SEO title + description locally (the
		// upsertListingContent call above wrote them) so:
		//   1. The AI-generated copy survives a page refresh.
		//   2. The post-push reminder banner shows them with Copy
		//      buttons — one click + paste into SS admin's SEO panel
		//      is the workflow until SS exposes this on writes.
		//   3. The next Pull from Squarespace round-trips them back if
		//      Dad sets them in SS admin instead.
		void parsed.seoTitle;
		void parsed.seoDescription;

		// Decide which SS product this push targets, in order of preference:
		//   1. The product our DB already links to (external_id).
		//   2. An ORPHAN already on SS that carries this item's unique
		//      variant SKU — ADOPT it in place rather than create a
		//      duplicate. This recovers from products left behind by
		//      earlier pushes that crashed before saving the link (the
		//      exact "it keeps recreating" symptom).
		//   3. Otherwise create a brand-new product.
		//
		// We match orphans by SKU, never by slug: the read-side urlSlug
		// carries a `p/` prefix the write side doesn't, and a wrong slug
		// match could clobber an unrelated product. The SKU is ours and
		// exact. `didCreate` is the source of truth afterward for whether
		// the product still needs its photos uploaded.
		try {
			let result: SquarespaceProduct;
			let didCreate = false;
			let wasRecreated = false;
			let wasAdopted = false;
			let adoptedHasImages = false;

			let targetId: string | null = existing?.external_id ?? null;

			// No tracked link? Hunt for an orphan to adopt before creating.
			if (!targetId) {
				const orphan = await findProductBySku(apiKey, item.sku);
				if (orphan) {
					targetId = orphan.product.id;
					wasAdopted = true;
					adoptedHasImages = (orphan.product.images?.length ?? 0) > 0;
				}
			}

			if (targetId) {
				try {
					// Update the tracked-or-adopted product. The slug retry
					// only matters if the name/slug changed to one another
					// product owns; a 404/405 (deleted) drops to recovery.
					const updated = await pushWithSlugRetry(payload, item.id, () =>
						updateProductFull(apiKey, targetId!, payload)
					);
					result = updated.result;
				} catch (err) {
					const isMissingProduct =
						err instanceof SquarespaceError &&
						(err.httpStatus === 404 || err.httpStatus === 405);
					if (!isMissingProduct) throw err;

					// The product we targeted is gone (Dad deleted it). Before
					// recreating, try to adopt ANOTHER orphan with our SKU —
					// crashed pushes may have left several duplicates.
					const orphan = await findProductBySku(apiKey, item.sku);
					if (orphan && orphan.product.id !== targetId) {
						const updated = await pushWithSlugRetry(payload, item.id, () =>
							updateProductFull(apiKey, orphan.product.id, payload)
						);
						result = updated.result;
						targetId = orphan.product.id;
						wasAdopted = true;
						adoptedHasImages = (orphan.product.images?.length ?? 0) > 0;
					} else {
						// Nothing left on SS to adopt — recreate from scratch.
						if (!parsed.storefrontId) {
							await db
								.prepare(
									`UPDATE marketplace_listing
									 SET external_id = NULL, external_variant_id = NULL, external_url = NULL,
									     last_sync_error = ?, updated_at = datetime('now')
									 WHERE item_id = ? AND platform = 'squarespace'`
								)
								.bind(
									'Squarespace product was deleted. Pick a storefront and push again to recreate.',
									item.id
								)
								.run();
							return fail(400, {
								pushError:
									'Squarespace product was deleted on their side. Pick a storefront below and click Push to recreate it as a fresh listing.'
							});
						}

						// Clear the stale link first so a failed create
						// doesn't leave us pointing at the dead product.
						await db
							.prepare(
								`UPDATE marketplace_listing
								 SET external_id = NULL, external_variant_id = NULL, external_url = NULL,
								     updated_at = datetime('now')
								 WHERE item_id = ? AND platform = 'squarespace'`
							)
							.bind(item.id)
							.run();

						payload.storePageId = parsed.storefrontId;
						const made = await createOrAdoptBySlug(apiKey, payload, item.id);
						result = made.result;
						if (made.adopted) {
							wasAdopted = true;
							adoptedHasImages = made.adoptedHasImages;
						} else {
							didCreate = true;
							wasRecreated = true;
						}
					}
				}
			} else {
				// No tracked product and no orphan to adopt — create fresh.
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
				const made = await createOrAdoptBySlug(apiKey, payload, item.id);
				result = made.result;
				if (made.adopted) {
					wasAdopted = true;
					adoptedHasImages = made.adoptedHasImages;
				} else {
					didCreate = true;
				}
			}

			// ---- Photos ----
			// We DON'T upload photos here anymore. Decoding + re-encoding
			// WebP→JPEG with Photon inside this request exceeded the
			// Worker's CPU/memory limit on multi-photo listings. Photos
			// now upload AFTER the redirect, one at a time, transcoded in
			// the browser (see the client loop + /upload-photo endpoint).
			//
			// Here we just count how many the product needs, so the page can
			// kick off that client upload. We upload when:
			//   - we created/recreated the product (didCreate), OR
			//   - we adopted an orphan that has NO images yet (a push that
			//     crashed before its photos finished).
			// A plain update, or adopting an orphan that already has images,
			// skips upload — re-pushing would duplicate images on SS.
			let needsPhotoCount = 0;
			if (didCreate || (wasAdopted && !adoptedHasImages)) {
				const cnt = await db
					.prepare(
						`SELECT COUNT(*) AS n FROM item_photo WHERE item_id = ? AND deleted_at IS NULL`
					)
					.bind(item.id)
					.first<{ n: number }>();
				needsPhotoCount = cnt?.n ?? 0;
			}

			const firstVariant = result.variants?.[0];
			// Sync status reflects the product push only — photo
			// failures get separately surfaced via the redirect param
			// so the listing isn't marked "error" just because one
			// photo failed.
			// External URL: prefer SS's own `url` field (which carries
			// Dad's custom domain like southwestacousticproducts.com
			// AND the right /shop/ store-page prefix), fall back to
			// constructing from the slug + hardcoded storefront if SS
			// didn't include it.
			//
			// Format observed from the scope-tool dump:
			//   url     = "https://www.southwestacousticproducts.com/shop/p/ivy-ijz-300-..."
			//   urlSlug = "p/ivy-ijz-300-..."
			// So the urlSlug is just the trailing path under the store
			// page, NOT including /shop/. Fallback prepends /shop/.
			const finalExternalUrl =
				result.url ??
				(result.urlSlug
					? `https://www.southwestacousticproducts.com/shop/${result.urlSlug.replace(/^\/+/, '')}`
					: null);

			// If the create path suffixed the slug to dodge a URL_SLUG_UNAVAILABLE
			// 409, the payload.urlSlug we sent is now the canonical one. Update
			// the local listing copy so the next push uses it directly instead
			// of re-triggering the same retry. payload.urlSlug is always set at
			// this point (the input form parser supplies it or defaults).
			if (payload.urlSlug && payload.urlSlug !== parsed.urlSlug) {
				await db
					.prepare(
						`UPDATE marketplace_listing
						 SET listing_url_slug = ?, updated_at = datetime('now')
						 WHERE item_id = ? AND platform = 'squarespace'`
					)
					.bind(payload.urlSlug, item.id)
					.run();
			}

			await recordSyncResult(db, item.id, 'squarespace', {
				externalId: result.id,
				externalVariantId: firstVariant?.id ?? null,
				externalUrl: finalExternalUrl,
				status: parsed.visible === 1 ? 'live' : 'paused',
				syncStatus: 'ok',
				syncError: null
			});

			const params = new URLSearchParams({ pushed: '1' });
			// Tell the page to kick off the client-side photo upload for a
			// freshly created/recreated product (browser transcodes +
			// uploads one at a time — keeps the Worker under its limits).
			if (needsPhotoCount > 0) params.set('needs_photos', String(needsPhotoCount));
			// Surface the recreate path to the UI so the success banner
			// can read "Recreated on Squarespace" instead of the default
			// "Pushed successfully" — clearer about what just happened.
			if (wasRecreated) params.set('recreated', '1');
			// Surface adoption so the banner can explain we reused an
			// existing listing (and saved the link) instead of duplicating.
			if (wasAdopted) params.set('adopted', '1');
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
	//
	// This action no longer uploads anything itself — it just verifies
	// the product exists and has photos, then redirects to
	// `?needs_photos=N&photo_action=repush`. The page's client loop does
	// the real work: transcode each R2 photo to JPEG in the browser and
	// POST them one at a time. (Doing the transcode in the Worker blew
	// the CPU/memory limit on multi-photo items.)
	//
	// Caveat: SS doesn't deduplicate. If photos are already on the SS
	// product, this run will add them again — for the missing-photos
	// recovery case that's exactly what's wanted; for a full refresh
	// Dad would delete them on SS first.

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

		const cnt = await db
			.prepare(`SELECT COUNT(*) AS n FROM item_photo WHERE item_id = ? AND deleted_at IS NULL`)
			.bind(item.id)
			.first<{ n: number }>();
		const photoCount = cnt?.n ?? 0;
		if (photoCount === 0) {
			return fail(400, {
				pushError: 'This item has no photos in inventory. Add photos first, then re-push.'
			});
		}

		// Don't upload here — the actual upload (with browser-side
		// transcoding, one image per request) runs after the redirect via
		// the client loop. We just signal it to start in repush mode.
		const params = new URLSearchParams({
			pushed: '1',
			needs_photos: String(photoCount),
			photo_action: 'repush'
		});
		throw redirect(303, `/items/${event.params.sku}/listings/squarespace?${params.toString()}`);
	},

	// ============================================================
	// Unlink from Squarespace
	// ============================================================
	//
	// Clears the external_id / external_variant_id / external_url
	// on the marketplace_listing without touching the SS-side product.
	// Use cases:
	//   - The SS product was deleted out from under us and we want
	//     to force the next push to create fresh (push auto-handles
	//     this too via 404/405 detection — this is the manual lever).
	//   - The SS product is being relinked to a different one (Dad
	//     wants to point this listing at a manually-created SS
	//     product, or a sibling listing).
	//   - Sandbox / debugging.
	//
	// Does NOT delete the SS-side product. That stays as-is. We just
	// forget about it locally.

	// ============================================================
	// Pull from Squarespace (Phase 1 of bidirectional sync)
	// ============================================================
	//
	// Manual per-item refresh: fetches the current state of THIS
	// listing's SS product and writes back to our local copy.
	// Overwrites listing_title / listing_description_html /
	// listing_price_cents with whatever SS has, and updates
	// item.stock_qty (writing a 'sale' or 'adjust' movement for
	// any delta) so the next push from us doesn't undo Dad's
	// SS-side edits.
	//
	// Eventual goal is webhook-driven real-time sync (Phase 2).
	// This button is the manual lever in the meantime — useful
	// even after webhooks land for "pull latest right now" cases.

	pullFromSquarespace: async (event) => {
		const db = getDB(event);
		const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
		if (!apiKey) return fail(400, { pushError: 'SQUARESPACE_API_KEY not configured.' });

		const item = await db
			.prepare(
				`SELECT id, sku, title, stock_qty, current_bin_id
				 FROM item WHERE sku = ? AND deleted_at IS NULL`
			)
			.bind(event.params.sku)
			.first<{
				id: number;
				sku: string;
				title: string;
				stock_qty: number;
				current_bin_id: number | null;
			}>();
		if (!item) throw error(404);

		const existing = await loadListing(db, item.id, 'squarespace');
		if (!existing?.external_id) {
			return fail(400, {
				pushError:
					'No Squarespace product to pull from. Push the listing first to create one.'
			});
		}

		try {
			const ssProduct = await getProduct(apiKey, existing.external_id);

			// Extract the canonical fields. SS wraps variants in an array
			// even when there's just one — single-variant is the only
			// case we currently push, so [0] is sufficient.
			const ssVariant = ssProduct.variants?.[0];
			const ssPriceCents = ssVariant?.pricing?.basePrice
				? Math.round(parseFloat(ssVariant.pricing.basePrice.value) * 100)
				: null;
			const ssStock =
				ssVariant?.stock && !ssVariant.stock.unlimited
					? ssVariant.stock.quantity
					: null;
			const ssUrl =
				ssProduct.url ??
				(ssProduct.urlSlug
					? `https://www.southwestacousticproducts.com/shop/${ssProduct.urlSlug.replace(/^\/+/, '')}`
					: null);

			// SEO round-trip: if Dad set the SEO TITLE / DESCRIPTION in
			// SS admin (rather than here), pull those back so the local
			// copy mirrors them and a subsequent push from us doesn't
			// blank them out. `seoOptions` is null when both are unset.
			const ssSeoTitle = ssProduct.seoOptions?.title?.trim() || null;
			const ssSeoDesc = ssProduct.seoOptions?.description?.trim() || null;

			// Refresh the local marketplace_listing copy with what SS has.
			await db
				.prepare(
					`UPDATE marketplace_listing
					 SET listing_title = ?,
					     listing_description_html = ?,
					     listing_price_cents = COALESCE(?, listing_price_cents),
					     listing_seo_title = ?,
					     listing_seo_description = ?,
					     external_url = COALESCE(?, external_url),
					     last_synced_at = datetime('now'),
					     last_sync_status = 'ok',
					     last_sync_error = NULL,
					     updated_at = datetime('now')
					 WHERE item_id = ? AND platform = 'squarespace'`
				)
				.bind(
					ssProduct.name,
					ssProduct.description ?? null,
					ssPriceCents,
					ssSeoTitle,
					ssSeoDesc,
					ssUrl,
					item.id
				)
				.run();

			// Stock delta — write a movement so the provenance ledger
			// shows where the change came from. Default to 'adjust'; if
			// stock went DOWN that's almost always a sale, so use 'sale'
			// kind for that specific direction (lets the dashboard's
			// recent-activity feed read it correctly).
			let stockDelta = 0;
			if (ssStock !== null && ssStock !== item.stock_qty) {
				stockDelta = ssStock - item.stock_qty;
				const kind: 'sale' | 'receive' | 'adjust' =
					stockDelta < 0 ? 'sale' : stockDelta > 0 ? 'receive' : 'adjust';
				const dir = stockDelta > 0 ? 'up' : 'down';
				const fromBin = kind === 'sale' ? item.current_bin_id : null;
				const toBin = kind === 'receive' ? item.current_bin_id : null;

				await db.batch([
					db
						.prepare(
							`UPDATE item SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?`
						)
						.bind(ssStock, item.id),
					db
						.prepare(
							`INSERT INTO movement (item_id, kind, from_bin_id, to_bin_id, quantity, note, actor, reference)
							 VALUES (?, ?, ?, ?, ?, ?, 'squarespace-pull', ?)`
						)
						.bind(
							item.id,
							kind,
							fromBin,
							toBin,
							Math.abs(stockDelta),
							`Pulled from Squarespace: ${item.stock_qty} → ${ssStock} (${dir} ${Math.abs(stockDelta)})`,
							existing.external_id
						)
				]);
			}

			const params = new URLSearchParams({ pulled: '1' });
			if (stockDelta !== 0) {
				params.set('stock_from', String(item.stock_qty));
				params.set('stock_to', String(ssStock));
			}
			throw redirect(
				303,
				`/items/${event.params.sku}/listings/squarespace?${params.toString()}`
			);
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			const message =
				err instanceof SquarespaceError
					? `HTTP ${err.httpStatus} from Squarespace: ${err.body.slice(0, 400)}`
					: err instanceof Error
						? err.message
						: String(err);
			return fail(500, { pushError: message });
		}
	},

	unlinkFromSquarespace: async (event) => {
		const db = getDB(event);
		const item = await db
			.prepare(`SELECT id FROM item WHERE sku = ? AND deleted_at IS NULL`)
			.bind(event.params.sku)
			.first<{ id: number }>();
		if (!item) throw error(404);

		await db
			.prepare(
				`UPDATE marketplace_listing
				 SET external_id = NULL,
				     external_variant_id = NULL,
				     external_url = NULL,
				     status = 'draft',
				     last_synced_at = NULL,
				     last_sync_status = NULL,
				     last_sync_error = NULL,
				     updated_at = datetime('now')
				 WHERE item_id = ? AND platform = 'squarespace'`
			)
			.bind(item.id)
			.run();

		throw redirect(
			303,
			`/items/${event.params.sku}/listings/squarespace?unlinked=1`
		);
	}
};
