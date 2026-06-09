import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { deleteProduct, SquarespaceError } from '$lib/server/squarespace';
import { endListing as endReverbListing, ReverbError } from '$lib/server/reverb';

/**
 * Dead-listings teardown — stage two of "no longer have".
 *
 * The wizard QUEUES every listing Dad marks gone/retired into
 * dead_listing (nothing is deleted live during the wizard). Here he works
 * the queue deliberately: "Remove" actually pushes the delete to
 * Squarespace / Reverb via API; eBay classic listings can't be ended via
 * API so they're flagged 'manual' with a link to end by hand (then
 * "Mark done"). Nothing leaves the live stores without an explicit click.
 */

interface DeadRow {
	id: number;
	platform: string;
	external_id: string;
	external_url: string | null;
	title: string | null;
	item_id: number | null;
	source: string;
	status: string;
	error: string | null;
}

type Env = App.Platform['env'] | undefined;

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const { results } = await db
		.prepare(
			`SELECT id, platform, external_id, external_url, title, item_id, source, status, error
			 FROM dead_listing
			 ORDER BY
			   CASE status WHEN 'pending' THEN 0 WHEN 'failed' THEN 1 WHEN 'manual' THEN 2
			               WHEN 'removed' THEN 3 ELSE 4 END,
			   platform, id`
		)
		.all<DeadRow>();

	const counts = {
		pending: results.filter((r) => r.status === 'pending').length,
		manual: results.filter((r) => r.status === 'manual').length,
		failed: results.filter((r) => r.status === 'failed').length,
		removed: results.filter((r) => r.status === 'removed').length,
		dismissed: results.filter((r) => r.status === 'dismissed').length
	};
	// Are there API-removable (SS/Reverb) listings still to do?
	const apiRemovable = results.filter(
		(r) => (r.status === 'pending' || r.status === 'failed') && r.platform !== 'ebay'
	).length;

	return { dead: results, counts, apiRemovable };
};

/** Push the actual platform delete for one queued listing + record the
 *  outcome. Returns ok/err so callers can batch. */
async function removeOne(
	db: ReturnType<typeof getDB>,
	env: Env,
	dead: DeadRow
): Promise<{ ok: boolean; error?: string }> {
	try {
		if (dead.platform === 'squarespace') {
			const key = env?.SQUARESPACE_API_KEY;
			if (!key) throw new Error('SQUARESPACE_API_KEY not configured.');
			await deleteProduct(key, dead.external_id);
		} else if (dead.platform === 'reverb') {
			const key = env?.REVERB_API_KEY;
			if (!key) throw new Error('REVERB_API_KEY not configured.');
			await endReverbListing(key, dead.external_id);
		} else {
			return { ok: false, error: 'eBay listings must be ended manually.' };
		}

		await db
			.prepare(
				`UPDATE dead_listing SET status = 'removed', removed_at = datetime('now'), error = NULL
				 WHERE id = ?`
			)
			.bind(dead.id)
			.run();
		// If this came from a tracked item, blank that platform's link.
		if (dead.item_id) {
			await db
				.prepare(
					`UPDATE marketplace_listing
					 SET external_id = NULL, external_variant_id = NULL, external_url = NULL,
					     status = 'paused', last_sync_status = 'ok',
					     last_sync_error = 'Listing removed during go-live teardown.',
					     updated_at = datetime('now')
					 WHERE item_id = ? AND platform = ?`
				)
				.bind(dead.item_id, dead.platform)
				.run();
		}
		return { ok: true };
	} catch (err) {
		const msg =
			err instanceof SquarespaceError
				? `Squarespace HTTP ${err.httpStatus}`
				: err instanceof ReverbError
					? `Reverb HTTP ${err.httpStatus}`
					: err instanceof Error
						? err.message
						: String(err);
		await db
			.prepare(`UPDATE dead_listing SET status = 'failed', error = ? WHERE id = ?`)
			.bind(msg, dead.id)
			.run();
		return { ok: false, error: msg };
	}
}

async function loadDead(db: ReturnType<typeof getDB>, id: number): Promise<DeadRow | null> {
	return await db
		.prepare(
			`SELECT id, platform, external_id, external_url, title, item_id, source, status, error
			 FROM dead_listing WHERE id = ?`
		)
		.bind(id)
		.first<DeadRow>();
}

// Bulk removals are capped so a huge queue can't blow the Worker's
// subrequest budget; Dad just clicks again to do the next batch.
const BULK_CAP = 30;

export const actions: Actions = {
	// Remove one SS/Reverb listing via API.
	remove: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const id = parseInt((form.get('dead_id') ?? '').toString(), 10);
		if (!Number.isInteger(id)) return fail(400, { error: 'Bad id.' });
		const dead = await loadDead(db, id);
		if (!dead) return fail(404, { error: 'Not found.' });
		await removeOne(db, event.platform?.env, dead);
		throw redirect(303, '/reconcile/dead');
	},

	// Remove ALL pending/failed SS+Reverb listings (up to the cap).
	removeAll: async (event) => {
		const db = getDB(event);
		const { results } = await db
			.prepare(
				`SELECT id, platform, external_id, external_url, title, item_id, source, status, error
				 FROM dead_listing
				 WHERE platform != 'ebay' AND status IN ('pending','failed')
				 ORDER BY id
				 LIMIT ${BULK_CAP}`
			)
			.all<DeadRow>();
		let ok = 0;
		let failed = 0;
		for (const d of results) {
			const r = await removeOne(db, event.platform?.env, d);
			if (r.ok) ok++;
			else failed++;
		}
		const params = new URLSearchParams({ removed: String(ok) });
		if (failed > 0) params.set('failed', String(failed));
		throw redirect(303, `/reconcile/dead?${params.toString()}`);
	},

	// eBay (or anything) Dad ended by hand → mark it done.
	markDone: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const id = parseInt((form.get('dead_id') ?? '').toString(), 10);
		if (!Number.isInteger(id)) return fail(400, { error: 'Bad id.' });
		const dead = await loadDead(db, id);
		await db
			.prepare(
				`UPDATE dead_listing SET status = 'removed', removed_at = datetime('now') WHERE id = ?`
			)
			.bind(id)
			.run();
		if (dead?.item_id) {
			await db
				.prepare(
					`UPDATE marketplace_listing
					 SET external_id = NULL, external_variant_id = NULL, external_url = NULL,
					     status = 'paused', updated_at = datetime('now')
					 WHERE item_id = ? AND platform = ?`
				)
				.bind(dead.item_id, dead.platform)
				.run();
		}
		throw redirect(303, '/reconcile/dead');
	},

	// Changed his mind — keep the listing live, drop it from the queue.
	dismiss: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const id = parseInt((form.get('dead_id') ?? '').toString(), 10);
		if (!Number.isInteger(id)) return fail(400, { error: 'Bad id.' });
		await db
			.prepare(`UPDATE dead_listing SET status = 'dismissed' WHERE id = ?`)
			.bind(id)
			.run();
		throw redirect(303, '/reconcile/dead');
	}
};
