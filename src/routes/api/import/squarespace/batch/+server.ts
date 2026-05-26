import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { importBatch } from '$lib/server/squarespace_import';
import { getDB } from '$lib/server/db';

/**
 * POST /api/import/squarespace/batch
 *
 * Process up to 10 un-imported Squarespace variants and return progress.
 * The client (the import page) polls this in a loop until `hasMore` is
 * false.
 *
 * Returning plain JSON (instead of using a SvelteKit form action) keeps
 * the client-side polling loop trivial — no devalue parsing, no
 * action-result envelope.
 */
export const POST: RequestHandler = async (event) => {
	const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
	if (!apiKey) {
		throw error(400, 'SQUARESPACE_API_KEY is not set on this environment.');
	}

	const r2 = event.platform?.env?.PHOTOS;
	if (!r2) {
		throw error(500, 'R2 binding PHOTOS missing — check wrangler.toml.');
	}

	const db = getDB(event);

	try {
		const batch = await importBatch(db, r2, apiKey, 10);
		return json({ ok: true, batch });
	} catch (err) {
		throw error(500, err instanceof Error ? err.message : String(err));
	}
};
