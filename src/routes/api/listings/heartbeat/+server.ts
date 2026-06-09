import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { validateSquarespaceListings } from '$lib/server/listing_health';

/**
 * GET /api/listings/heartbeat?key=…
 *
 * Periodic listing health check, meant to be hit by a scheduler (an
 * external cron like cron-job.org, or a Cloudflare Cron Worker). Each call
 * verifies the whole Squarespace catalog (one cheap paginated scan) and
 * keeps orphans / errors flagged without a person clicking anything.
 *
 * Auth: gated by a shared secret in the `LISTING_HEARTBEAT_KEY` env var
 * (a Pages secret). The endpoint is disabled (403) until that's set. To
 * let an outside scheduler reach it, add a Cloudflare Access *bypass*
 * policy for the path `api/listings/heartbeat` (same as the eBay
 * notifications endpoint) — the key still protects it from random hits.
 */
export const GET: RequestHandler = async (event) => {
	const expected = event.platform?.env?.LISTING_HEARTBEAT_KEY;
	if (!expected) {
		throw error(403, 'Heartbeat disabled — set LISTING_HEARTBEAT_KEY to enable.');
	}
	const provided = event.url.searchParams.get('key');
	if (!provided || provided !== expected) {
		throw error(401, 'Bad or missing key.');
	}

	const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
	if (!apiKey) throw error(400, 'SQUARESPACE_API_KEY not configured.');

	const db = getDB(event);
	// Verifies the WHOLE catalog every run — it's cheap now (one paginated
	// catalog scan + batched writes, not a fetch per listing), so there's no
	// reason to rotate through a subset.
	const summary = await validateSquarespaceListings(db, apiKey);
	return json({
		ok: true,
		checked: summary.checked,
		live: summary.live,
		orphaned: summary.orphaned,
		errors: summary.errors
	});
};
