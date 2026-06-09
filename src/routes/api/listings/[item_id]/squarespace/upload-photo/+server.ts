import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { loadListing } from '$lib/server/listings';
import { uploadProductImage, SquarespaceError } from '$lib/server/squarespace';

/**
 * POST /api/listings/<item_id>/squarespace/upload-photo
 *
 * Relays ONE already-transcoded image (the browser sends a JPEG it made
 * on a canvas) to the item's Squarespace product. The Worker does NO
 * image processing here — it just forwards the bytes — so it stays well
 * under the per-request CPU/memory limits even on the free plan.
 *
 * Why: the old approach decoded + re-encoded every WebP photo with the
 * Photon WASM library inside the push request, which exceeded the
 * Worker's resource limits on multi-photo listings. Transcoding now
 * happens client-side (no CPU cap in the browser), one image per
 * request, and this endpoint is a thin pass-through.
 *
 * Body: multipart/form-data with `file` (image/jpeg).
 * Returns: { ok: true } or { ok: false, error } (always HTTP 200 so the
 * client can handle per-photo failures without aborting the batch).
 */
export const POST: RequestHandler = async (event) => {
	const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
	if (!apiKey) throw error(400, 'SQUARESPACE_API_KEY not configured.');

	const itemId = parseInt(event.params.item_id, 10);
	if (!Number.isInteger(itemId)) throw error(400, 'Bad item id');

	const db = getDB(event);
	const listing = await loadListing(db, itemId, 'squarespace');
	if (!listing?.external_id) {
		throw error(400, 'No Squarespace product yet — push the listing first to create it.');
	}

	const form = await event.request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) throw error(400, 'Expected a `file` field with the image.');

	try {
		const bytes = await file.arrayBuffer();
		const contentType = file.type || 'image/jpeg';
		const filename = file.name || 'photo.jpg';
		// The browser already transcoded to JPEG, so uploadProductImage's
		// normalize step is a no-op (no Photon) — this is a pure relay.
		await uploadProductImage(apiKey, listing.external_id, bytes, contentType, filename);
		return json({ ok: true });
	} catch (err) {
		const message =
			err instanceof SquarespaceError
				? `HTTP ${err.httpStatus}: ${err.body.slice(0, 300)}`
				: err instanceof Error
					? err.message
					: String(err);
		// 200 with ok:false so the client batch can record + continue.
		return json({ ok: false, error: message });
	}
};
