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
	checkConnection,
	suggestCategory,
	listSellerPolicies,
	getItemAspectsForCategory,
	createOrReplaceInventoryItem,
	createOffer,
	getOffersBySku,
	updateOffer,
	publishOffer,
	mapInternalConditionToEbay,
	EbayError,
	type EbayCategorySuggestion,
	type EbayPolicy,
	type EbayInventoryItemPayload
} from '$lib/server/ebay';
import {
	mapItemToAspects,
	missingRequiredAspects,
	type AspectMapping
} from '$lib/server/ebay_aspect_mapper';
import { resolveItemAttributes } from '$lib/server/item_attributes';
import { resolveEbayCreds } from '$lib/server/ebay_credentials';
import { getProduct as getSquarespaceProduct } from '$lib/server/squarespace';
import { EBAY_GUITAR_FEES, grossUpForFees } from '$lib/marketplace_fees';

/**
 * /items/[sku]/listings/ebay — eBay listing editor.
 *
 * Loads:
 *   - item + photo URLs
 *   - marketplace_listing for (item, ebay)
 *   - marketplace_listing for (item, squarespace) as the photo source
 *     (eBay accepts public image URLs; SS CDN URLs work)
 *   - eBay connection status (app token, user token)
 *   - eBay category suggestions for the item title (best-effort)
 *   - seller policies (fulfillment/payment/return) when user token available
 *
 * Actions:
 *   - save: persist locally only.
 *   - push: persist + push to eBay (PUT inventory_item → POST offer →
 *           POST publish). Skips publish if `target_status === 'draft'`
 *           so Dad can stage without going live.
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
	brand_name: string | null;
	cat_code: string;
}

/** Parse form payload — eBay-specific extras live in platform_extras_json. */
interface ParsedForm {
	title: string;
	descriptionHtml: string;
	priceAmount: string;
	categoryId: string;
	conditionEnum: EbayInventoryItemPayload['condition'] | '';
	conditionDescription: string;
	brand: string;
	mpn: string;
	upc: string;
	fulfillmentPolicyId: string;
	paymentPolicyId: string;
	returnPolicyId: string;
	/**
	 * eBay item aspects keyed by aspect name → values. Collected from
	 * every `aspect:<Name>` form field. Stored as string[] (eBay's
	 * aspects are always arrays, even single-value ones).
	 */
	aspects: Record<string, string[]>;
	publish: boolean;
}

function parseFormData(form: FormData): ParsedForm {
	// Collect dynamic aspect fields. Each is named `aspect:<AspectName>`
	// (the name may contain spaces / slashes — we slice off the prefix
	// and keep the rest verbatim as the aspect key). Empty values are
	// dropped so they don't count as "filled" for required validation.
	const aspects: Record<string, string[]> = {};
	for (const [key, raw] of form.entries()) {
		if (!key.startsWith('aspect:')) continue;
		const name = key.slice('aspect:'.length);
		const value = raw.toString().trim();
		if (value === '') continue;
		// MULTI aspects could submit multiple values under the same key;
		// entries() yields them separately so we append.
		(aspects[name] ??= []).push(value);
	}

	return {
		title: (form.get('listing_title') ?? '').toString().trim(),
		descriptionHtml: (form.get('listing_description_html') ?? '').toString(),
		priceAmount: (form.get('listing_price') ?? '').toString().trim(),
		categoryId: (form.get('ebay_category_id') ?? '').toString().trim(),
		conditionEnum: ((form.get('ebay_condition') ?? '') as ParsedForm['conditionEnum']),
		conditionDescription: (form.get('ebay_condition_description') ?? '').toString().trim(),
		brand: (form.get('ebay_brand') ?? '').toString().trim(),
		mpn: (form.get('ebay_mpn') ?? '').toString().trim(),
		upc: (form.get('ebay_upc') ?? '').toString().trim(),
		fulfillmentPolicyId: (form.get('ebay_fulfillment_policy_id') ?? '').toString().trim(),
		paymentPolicyId: (form.get('ebay_payment_policy_id') ?? '').toString().trim(),
		returnPolicyId: (form.get('ebay_return_policy_id') ?? '').toString().trim(),
		aspects,
		publish: form.get('target_status') === 'live'
	};
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const sku = event.params.sku;
	const env = event.platform?.env;

	const item = await db
		.prepare(
			`SELECT i.id, i.sku, i.title, i.description, i.description_html,
			        i.price_cents, i.stock_qty, i.tracking_mode, i.condition, i.model,
			        c.code AS cat_code,
			        b.name AS brand_name
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 LEFT JOIN brand b ON b.id = i.brand_id
			 WHERE i.sku = ? AND i.deleted_at IS NULL`
		)
		.bind(sku)
		.first<ItemRow>();
	if (!item) throw error(404, `No item with SKU ${sku}`);

	const listing = await loadListing(db, item.id, 'ebay');
	const ssListing = await loadListing(db, item.id, 'squarespace');

	// Photo URLs come from the already-pushed SS listing. eBay's
	// inventory_item.product.imageUrls[] requires public URLs — our
	// R2 photos live behind Cloudflare Access, so we use SS CDN URLs
	// instead. This means pushing to SS is a prereq for photos on
	// eBay; we surface that on the UI.
	let photoUrls: string[] = [];
	let photoSourceError: string | null = null;
	// SS description to seed eBay from. Default to our locally-saved copy
	// of the SS listing (what Dad crafted in the SS editor), then prefer
	// the LIVE product description if the SS fetch below succeeds (covers
	// the case where it was edited on SS's side after our last save).
	let ssDescriptionHtml: string | null = ssListing?.listing_description_html ?? null;
	if (ssListing?.external_id && env?.SQUARESPACE_API_KEY) {
		try {
			const ssProduct = await getSquarespaceProduct(
				env.SQUARESPACE_API_KEY,
				ssListing.external_id
			);
			photoUrls = (ssProduct.images ?? []).map((img) => img.url).filter(Boolean);
			if (ssProduct.description && ssProduct.description.trim()) {
				ssDescriptionHtml = ssProduct.description;
			}
		} catch (err) {
			photoSourceError = err instanceof Error ? err.message : String(err);
		}
	}

	// Resolve eBay creds: D1-stored refresh token + location merged over
	// env. This is what makes the OAuth-minted user token + the
	// created location visible to the editor.
	const creds = await resolveEbayCreds(db, env);

	// Connection check + (optional) suggestions for the category picker
	// + seller policies. All best-effort — the page renders fine without
	// any of these populated.
	const conn = env
		? await checkConnection(creds)
		: { app: false, user: false, error: 'platform env missing' };

	let categorySuggestions: EbayCategorySuggestion[] = [];
	if (conn.app) {
		try {
			categorySuggestions = await suggestCategory(creds, item.title);
		} catch (err) {
			console.error('eBay category suggest failed (non-fatal):', err);
		}
	}

	// Item aspects (the listing-rejection killer). We fetch + auto-map
	// for whichever category is "current": the saved one, else the top
	// AI suggestion. The editor re-fetches client-side when Dad changes
	// the category. Pre-loading here avoids a flash of empty specifics
	// on the common path (returning to an item with a saved category).
	const savedExtras = (() => {
		const raw = listing?.platform_extras_json;
		if (!raw) return {} as Record<string, unknown>;
		try {
			return JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return {};
		}
	})();
	const initialCategoryId =
		(savedExtras.ebay_category_id as string | undefined) ??
		categorySuggestions[0]?.categoryId ??
		'';
	// Any aspect values Dad already chose + saved, so we re-apply them
	// over the auto-map on reload.
	const savedAspects = (savedExtras.ebay_aspects as Record<string, string[]> | undefined) ?? {};

	let aspectMappings: AspectMapping[] = [];
	let aspectError: string | null = null;
	if (conn.app && initialCategoryId) {
		try {
			const aspects = await getItemAspectsForCategory(creds, initialCategoryId);
			const attributes = await resolveItemAttributes(db, item.id);
			aspectMappings = mapItemToAspects(aspects, {
				brand: item.brand_name,
				model: item.model,
				title: item.title,
				attributes
			});
			// Overlay saved choices: if Dad already picked/edited a value,
			// it wins over the fresh auto-map suggestion.
			for (const m of aspectMappings) {
				const saved = savedAspects[m.aspect.name];
				if (saved && saved.length > 0 && saved[0].trim() !== '') {
					m.suggestedValue = saved[0];
					// Re-validate against the allowed list for the saved value.
					m.valueInAllowedList =
						m.aspect.mode === 'FREE_TEXT' ||
						m.aspect.allowedValues.length === 0 ||
						m.aspect.allowedValues.some(
							(v) => v.toLowerCase() === saved[0].toLowerCase()
						);
				}
			}
		} catch (err) {
			aspectError =
				err instanceof EbayError
					? `Couldn't load eBay item specifics for category ${initialCategoryId} (HTTP ${err.httpStatus}).`
					: err instanceof Error
						? err.message
						: String(err);
		}
	}

	let fulfillmentPolicies: EbayPolicy[] = [];
	let paymentPolicies: EbayPolicy[] = [];
	let returnPolicies: EbayPolicy[] = [];
	if (conn.user) {
		try {
			[fulfillmentPolicies, paymentPolicies, returnPolicies] = await Promise.all([
				listSellerPolicies(creds, 'fulfillment_policy'),
				listSellerPolicies(creds, 'payment_policy'),
				listSellerPolicies(creds, 'return_policy')
			]);
		} catch (err) {
			console.error('eBay seller policies fetch failed (non-fatal):', err);
		}
	}

	// Net-to-base price suggestion: same gross-up math as Reverb, with
	// eBay's 12% + $0.30 fees.
	const suggestedPriceCents = grossUpForFees(item.price_cents ?? 0, EBAY_GUITAR_FEES);

	return {
		item,
		listing,
		ssListing,
		photoUrls,
		photoSourceError,
		ssDescriptionHtml,
		conn,
		hasMerchantLocation: !!creds.EBAY_MERCHANT_LOCATION_KEY,
		merchantLocationKey: creds.EBAY_MERCHANT_LOCATION_KEY ?? null,
		categorySuggestions,
		fulfillmentPolicies,
		paymentPolicies,
		returnPolicies,
		suggestedPriceCents,
		feeLabel: EBAY_GUITAR_FEES.label,
		// Item-specifics auto-map for the initial category.
		initialCategoryId,
		aspectMappings,
		aspectError
	};
};

/**
 * Persist parsed form to marketplace_listing + platform_extras_json.
 * eBay has more platform-specific fields than fit in the generic
 * listings columns; the JSON blob holds the rest.
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
		ebay_category_id: parsed.categoryId || null,
		ebay_condition: parsed.conditionEnum || null,
		ebay_condition_description: parsed.conditionDescription || null,
		ebay_brand: parsed.brand || null,
		ebay_mpn: parsed.mpn || null,
		ebay_upc: parsed.upc || null,
		ebay_fulfillment_policy_id: parsed.fulfillmentPolicyId || null,
		ebay_payment_policy_id: parsed.paymentPolicyId || null,
		ebay_return_policy_id: parsed.returnPolicyId || null,
		// Persist the chosen item specifics so they survive reloads and
		// re-apply over the fresh auto-map on the next visit.
		ebay_aspects: parsed.aspects
	};

	await upsertListingContent(db, itemId, 'ebay', {
		listing_title: parsed.title || null,
		listing_description_html: parsed.descriptionHtml || null,
		listing_url_slug: null,
		listing_tags_json: null,
		listing_price_cents: priceCents,
		listing_visible: parsed.publish ? 1 : 0,
		storefront_id: null,
		status,
		listing_categories_json: null,
		listing_free_shipping: 0,
		listing_weight_oz: null,
		listing_seo_title: null,
		listing_seo_description: null
	});

	// Stash eBay-specific fields in platform_extras_json (separate
	// write because upsertListingContent doesn't cover it).
	await db
		.prepare(
			`UPDATE marketplace_listing
			 SET platform_extras_json = ?, updated_at = datetime('now')
			 WHERE item_id = ? AND platform = 'ebay'`
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

		throw redirect(303, `/items/${event.params.sku}/listings/ebay?saved=1`);
	},

	push: async (event) => {
		const db = getDB(event);
		const env = event.platform?.env;
		if (!env) return fail(500, { pushError: 'platform env missing' });

		// Resolve creds (D1 refresh token + location merged over env).
		const creds = await resolveEbayCreds(db, env);

		const conn = await checkConnection(creds);
		if (!conn.user) {
			return fail(400, {
				pushError:
					'eBay account not connected. Go to Settings → eBay → Connect to authorize listing. ' +
					(conn.error ?? '')
			});
		}
		if (!creds.EBAY_MERCHANT_LOCATION_KEY) {
			return fail(400, {
				pushError:
					'No eBay inventory location set. Go to Settings → eBay → Create inventory location first.'
			});
		}

		const item = await db
			.prepare(
				`SELECT i.id, i.sku, i.title, i.description, i.description_html,
				        i.price_cents, i.stock_qty, i.tracking_mode, i.condition, i.model,
				        c.code AS cat_code,
				        b.name AS brand_name
				 FROM item i
				 JOIN category c ON c.id = i.category_id
				 LEFT JOIN brand b ON b.id = i.brand_id
				 WHERE i.sku = ? AND i.deleted_at IS NULL`
			)
			.bind(event.params.sku)
			.first<ItemRow>();
		if (!item) throw error(404);

		const form = await event.request.formData();
		const parsed = parseFormData(form);

		await persistLocal(db, item.id, parsed, 'ready');

		// Photo URLs from SS listing (if available).
		const ssListing = await loadListing(db, item.id, 'squarespace');
		let photoUrls: string[] = [];
		if (ssListing?.external_id && env.SQUARESPACE_API_KEY) {
			try {
				const ssProduct = await getSquarespaceProduct(
					env.SQUARESPACE_API_KEY,
					ssListing.external_id
				);
				photoUrls = (ssProduct.images ?? []).map((img) => img.url).filter(Boolean);
			} catch {
				// non-fatal; eBay will fail later if it needs photos
			}
		}

		// Category is required to fetch aspects AND for the offer.
		// Check it up front so we fail with a clear message instead of
		// 400-ing deeper in.
		if (!parsed.categoryId) {
			return fail(400, {
				pushError: 'Pick an eBay category before pushing — item specifics depend on it.'
			});
		}

		// Validate the three policies up front too, so a missing one
		// doesn't leave a dangling inventory_item (which we'd create
		// before reaching the offer call otherwise). All three are
		// required by eBay on every offer.
		if (
			!parsed.fulfillmentPolicyId ||
			!parsed.paymentPolicyId ||
			!parsed.returnPolicyId
		) {
			return fail(400, {
				pushError:
					'All three eBay policies (fulfillment, payment, return) are required. Pick them below — they come from your eBay Seller Hub.'
			});
		}

		// Validate required item specifics against the live aspect list
		// for this category. This is the check that stops eBay from
		// rejecting the publish. Best-effort fetch — if the taxonomy
		// call fails we let the push proceed (eBay will give the
		// authoritative error) rather than hard-block on our own lookup.
		try {
			const aspects = await getItemAspectsForCategory(creds, parsed.categoryId);
			const missing = missingRequiredAspects(aspects, parsed.aspects);
			if (missing.length > 0) {
				return fail(400, {
					pushError: `eBay requires these item specifics for this category: ${missing.join(', ')}. Fill them in below and push again.`,
					missingAspects: missing
				});
			}
		} catch (err) {
			// Non-fatal: log + continue. eBay's own validation is the
			// backstop. We don't want our taxonomy hiccup to block a
			// listing whose aspects are actually fine.
			console.error('eBay aspect pre-validation failed (non-fatal):', err);
		}

		// Build eBay's product.aspects map. eBay wants every value as a
		// string array (even singles). Drop empties defensively.
		const aspectPayload: Record<string, string[]> = {};
		for (const [name, values] of Object.entries(parsed.aspects)) {
			const clean = values.map((v) => v.trim()).filter((v) => v.length > 0);
			if (clean.length > 0) aspectPayload[name] = clean;
		}

		try {
			// 1. PUT inventory_item
			const conditionEnum =
				parsed.conditionEnum || mapInternalConditionToEbay(item.condition);

			// eBay's product-identifier validation (the <BrandMPN> tag)
			// requires a Brand + MPN pair for most categories at PUBLISH
			// time. Used/custom guitars rarely have a manufacturer part
			// number, so the eBay-blessed convention is the literal
			// "Does Not Apply" — sending undefined 400s the publish.
			// Likewise eBay accepts "Unbranded" when there's genuinely
			// no brand. We only fall back to those when we have nothing
			// real to send.
			const ebayBrand = parsed.brand || item.brand_name || 'Unbranded';
			const ebayMpn = parsed.mpn || 'Does Not Apply';

			const inventoryPayload: EbayInventoryItemPayload = {
				availability: {
					shipToLocationAvailability: { quantity: item.stock_qty }
				},
				condition: conditionEnum,
				conditionDescription: parsed.conditionDescription || undefined,
				product: {
					title: parsed.title || item.title,
					description: parsed.descriptionHtml || item.description_html || '',
					brand: ebayBrand,
					mpn: ebayMpn,
					upc: parsed.upc ? [parsed.upc] : undefined,
					aspects: Object.keys(aspectPayload).length > 0 ? aspectPayload : undefined,
					imageUrls: photoUrls.length > 0 ? photoUrls : undefined
				}
			};
			await createOrReplaceInventoryItem(creds, item.sku, inventoryPayload);

			// 2. Create-or-update the offer. eBay allows exactly one
			// offer per (sku, marketplace, format), so a re-push must
			// UPDATE the existing one — calling create again 400s with
			// "Offer entity already exists" (errorId 25002). We query by
			// SKU (robust even if we lost track of the offerId) and
			// branch accordingly.
			const priceCents = parsed.priceAmount
				? Math.round(parseFloat(parsed.priceAmount) * 100)
				: (item.price_cents ?? 0);

			const offerPayload = {
				sku: item.sku,
				marketplaceId: 'EBAY_US' as const,
				format: 'FIXED_PRICE' as const,
				availableQuantity: item.stock_qty,
				categoryId: parsed.categoryId,
				listingDescription: parsed.descriptionHtml || item.description_html || '',
				listingPolicies: {
					fulfillmentPolicyId: parsed.fulfillmentPolicyId,
					paymentPolicyId: parsed.paymentPolicyId,
					returnPolicyId: parsed.returnPolicyId
				},
				pricingSummary: {
					price: { value: (priceCents / 100).toFixed(2), currency: 'USD' as const }
				},
				merchantLocationKey: creds.EBAY_MERCHANT_LOCATION_KEY
			};

			const existingOffers = await getOffersBySku(creds, item.sku);
			const existingOffer = existingOffers.find((o) => o.marketplaceId === 'EBAY_US');

			let offerId: string;
			if (existingOffer) {
				// Update path — strip the immutable create-time fields.
				const { sku: _s, marketplaceId: _m, format: _f, ...updatePayload } = offerPayload;
				await updateOffer(creds, existingOffer.offerId, updatePayload);
				offerId = existingOffer.offerId;
			} else {
				const created = await createOffer(creds, offerPayload);
				offerId = created.offerId;
			}

			// 3. Publish (if Dad wants it live). An already-published
			// offer can be re-published safely (eBay treats it as a
			// revise), so we don't special-case the existing-listing case.
			let listingId: string | null = existingOffer?.listingId ?? null;
			if (parsed.publish) {
				const pub = await publishOffer(creds, offerId);
				listingId = pub.listingId;
			}

			await recordSyncResult(db, item.id, 'ebay', {
				externalId: offerId,
				externalVariantId: listingId,
				externalUrl: listingId
					? `https://www.ebay.com/itm/${encodeURIComponent(listingId)}`
					: null,
				status: parsed.publish ? 'live' : 'ready',
				syncStatus: 'ok',
				syncError: null
			});

			const params = new URLSearchParams({ pushed: '1' });
			if (parsed.publish) params.set('published', '1');
			throw redirect(303, `/items/${event.params.sku}/listings/ebay?${params.toString()}`);
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			const message =
				err instanceof EbayError
					? `HTTP ${err.httpStatus} from eBay: ${err.body.slice(0, 500)}`
					: err instanceof Error
						? err.message
						: String(err);
			await recordSyncResult(db, item.id, 'ebay', {
				status: 'error',
				syncStatus: 'error',
				syncError: message
			});
			return fail(500, { pushError: message });
		}
	}
};
