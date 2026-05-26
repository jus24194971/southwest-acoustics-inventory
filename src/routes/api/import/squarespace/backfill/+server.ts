import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { backfillMissingPhotos } from '$lib/server/squarespace_import';
import { getDB } from '$lib/server/db';

/**
 * POST /api/import/squarespace/backfill
 *
 * Walks SS catalog, finds items that have fewer photos than the SS
 * product, fetches the missing ones. Same polling pattern as the
 * main importer's /batch endpoint — call until `hasMore` is false.
 */
export const POST: RequestHandler = async (event) => {
	const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
	if (!apiKey) throw error(400, 'SQUARESPACE_API_KEY is not set.');

	const r2 = event.platform?.env?.PHOTOS;
	if (!r2) throw error(500, 'R2 binding PHOTOS missing — check wrangler.toml.');

	const db = getDB(event);

	try {
		const result = await backfillMissingPhotos(db, r2, apiKey);
		return json({ ok: true, result });
	} catch (err) {
		throw error(500, err instanceof Error ? err.message : String(err));
	}
};
