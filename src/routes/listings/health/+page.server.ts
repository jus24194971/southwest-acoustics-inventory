import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import {
	validateSquarespaceListings,
	bulkRelinkSquarespace,
	bulkPullSquarespaceDescriptions
} from '$lib/server/listing_health';

/**
 * Squarespace listing health — validate every tracked link, surface
 * orphans + errors, and keep them honest with a periodic heartbeat.
 *
 * The load is a fast DB snapshot (no API calls). "Check now" runs the
 * live validation pass (one Squarespace fetch per listing), refreshing
 * live ones and clearing orphaned links so they relist on next push.
 */

interface Row {
	item_id: number;
	sku: string;
	title: string;
	external_id: string | null;
	external_url: string | null;
	status: string;
	last_synced_at: string | null;
	last_sync_status: string | null;
	last_sync_error: string | null;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const empty = { total: 0, linked: 0, unlinked: 0, errored: 0 };
	try {
		const { results } = await db
			.prepare(
				`SELECT ml.item_id, i.sku, i.title, ml.external_id, ml.external_url,
				        ml.status, ml.last_synced_at, ml.last_sync_status, ml.last_sync_error
				 FROM marketplace_listing ml
				 JOIN item i ON i.id = ml.item_id
				 WHERE ml.platform = 'squarespace' AND i.deleted_at IS NULL
				 ORDER BY
				   CASE ml.last_sync_status WHEN 'error' THEN 0 ELSE 1 END,
				   ml.last_synced_at IS NULL DESC, ml.last_synced_at ASC`
			)
			.all<Row>();

		const linked = results.filter((r) => r.external_id);
		const counts = {
			total: results.length,
			linked: linked.length,
			unlinked: results.length - linked.length,
			errored: results.filter((r) => r.last_sync_status === 'error').length
		};

		return { rows: results, counts, loadError: null as string | null };
	} catch (err) {
		// Surface the real reason instead of a blank 500 while we diagnose.
		const msg =
			err instanceof Error ? `${err.message}${err.stack ? ' :: ' + err.stack.slice(0, 400) : ''}` : String(err);
		return { rows: [] as Row[], counts: empty, loadError: msg };
	}
};

export const actions: Actions = {
	check: async (event) => {
		const db = getDB(event);
		const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
		if (!apiKey) return fail(400, { error: 'SQUARESPACE_API_KEY not configured.' });
		// Verify the WHOLE catalog in one pass, cheaply: the validator pulls
		// the entire Squarespace catalog with a few paginated calls and matches
		// every link locally, instead of one fetch per listing (which blew the
		// 50-subrequest cap). Cost is ~(catalog pages) + a couple batched writes.
		try {
			const summary = await validateSquarespaceListings(db, apiKey);
			const params = new URLSearchParams({
				checked: String(summary.checked),
				live: String(summary.live),
				orphaned: String(summary.orphaned),
				errors: String(summary.errors)
			});
			throw redirect(303, `/listings/health?${params.toString()}`);
		} catch (err) {
			// Let SvelteKit's redirect bubble; surface real errors inline.
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			return fail(500, {
				error: err instanceof Error ? err.message : 'Health check failed unexpectedly.'
			});
		}
	},

	// Catalog-wide relink: scan all SS products once and link every
	// unlinked item to its real product (by slug, then SKU).
	relink: async (event) => {
		const db = getDB(event);
		const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
		if (!apiKey) return fail(400, { error: 'SQUARESPACE_API_KEY not configured.' });
		try {
			const s = await bulkRelinkSquarespace(db, apiKey, event.platform?.env?.ANTHROPIC_API_KEY, 50);
			const params = new URLSearchParams({
				relinked: String(s.relinked),
				aimatched: String(s.aiMatched),
				already: String(s.alreadyLinked),
				unmatched: String(s.unmatched),
				scanned: String(s.productsScanned)
			});
			throw redirect(303, `/listings/health?${params.toString()}`);
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			return fail(500, { error: err instanceof Error ? err.message : 'Relink failed.' });
		}
	},

	// Baseline-fill item descriptions from the live Squarespace copy (one
	// cheap catalog scan), for every SS-linked item that has no description
	// yet — never overwrites existing copy. Gives items not on eBay/Reverb
	// something to prefill from when they get listed there.
	pullDescriptions: async (event) => {
		const db = getDB(event);
		const apiKey = event.platform?.env?.SQUARESPACE_API_KEY;
		if (!apiKey) return fail(400, { error: 'SQUARESPACE_API_KEY not configured.' });
		try {
			const s = await bulkPullSquarespaceDescriptions(db, apiKey);
			const params = new URLSearchParams({
				desc_filled: String(s.filled),
				desc_had: String(s.alreadyHad),
				desc_nosrc: String(s.noSource),
				desc_items: String(s.ssLinkedItems)
			});
			throw redirect(303, `/listings/health?${params.toString()}`);
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
			return fail(500, { error: err instanceof Error ? err.message : 'Description pull failed.' });
		}
	}
};
