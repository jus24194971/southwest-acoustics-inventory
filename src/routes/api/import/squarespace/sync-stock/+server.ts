import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { syncStockFromSquarespace } from '$lib/server/squarespace_import';

/**
 * POST /api/import/squarespace/sync-stock
 *
 * Pulls current stock from Squarespace's Inventory API and updates
 * matching items in our DB. Writes an audit movement for each change.
 *
 * This is intentionally separate from the full Products importer:
 *   - The Products endpoint returns big payloads (descriptions, images)
 *     and we already do photo fetches there, so it churns the
 *     subrequest budget.
 *   - The Inventory endpoint is a thin per-variant feed — perfect for
 *     a "just refresh the numbers" pass that runs in well under a
 *     second and stays comfortably under the Workers limit.
 *
 * Returns JSON counts so the UI can show "X updated, Y unchanged, Z
 * unknown" in a single response.
 */
export const POST: RequestHandler = async (event) => {
	const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
	if (!apiKey) {
		throw error(
			400,
			'SQUARESPACE_API_KEY is not configured. Set it via `wrangler pages secret put SQUARESPACE_API_KEY` and redeploy.'
		);
	}

	const db = getDB(event);
	const result = await syncStockFromSquarespace(db, apiKey);
	return json(result);
};
