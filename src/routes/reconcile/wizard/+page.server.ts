import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { prefillGroup } from '$lib/server/reconcile_prefill';
import { publishItemAsSellable } from '$lib/server/ss_auto_sync';
import { importItemPhotosFromSquarespace } from '$lib/server/squarespace_import';

/**
 * Go-live review wizard.
 *
 *   Stage 1 — onboard the NEW product groups from the scrape into unified
 *             inventory items (AI pre-fills the form; adopting links every
 *             platform listing with the right ids).
 *   Stage 2 — walk EVERY existing item to keep / retire / clear out.
 *
 * The wizard shows groups first (decision still pending), then existing
 * items, one unit at a time, with combined progress.
 */

interface WizardItem {
	id: number;
	sku: string;
	title: string;
	stock_qty: number;
	tracking_mode: string;
	price_cents: number | null;
	sellable: number;
	cat_name: string;
	cat_code: string;
	photo_key: string | null;
}

interface WizardListing {
	platform: string;
	status: string;
	external_id: string | null;
	external_url: string | null;
	last_sync_status: string | null;
}

interface GroupListing {
	id: number;
	platform: string;
	title: string;
	price_cents: number | null;
	qty: number | null;
	image_url: string | null;
	url: string | null;
}

async function latestRunId(db: ReturnType<typeof getDB>): Promise<number | null> {
	const run = await db
		.prepare(`SELECT id FROM reconcile_run ORDER BY id DESC LIMIT 1`)
		.first<{ id: number }>();
	return run?.id ?? null;
}

async function count(db: ReturnType<typeof getDB>, sql: string, ...binds: unknown[]): Promise<number> {
	const r = await db
		.prepare(sql)
		.bind(...binds)
		.first<{ n: number }>();
	return r?.n ?? 0;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const runId = await latestRunId(db);
	if (runId == null) throw redirect(303, '/reconcile');

	// Combined progress.
	const groupsTotal = await count(
		db,
		`SELECT COUNT(*) AS n FROM reconcile_group
		 WHERE run_id = ? AND (decision IS NULL OR decision IN ('have','future','gone'))`,
		runId
	);
	const groupsDone = await count(
		db,
		`SELECT COUNT(*) AS n FROM reconcile_group
		 WHERE run_id = ? AND decision IN ('have','future','gone')`,
		runId
	);
	const itemsDone = await count(
		db,
		`SELECT COUNT(*) AS n FROM reconcile_item_review WHERE run_id = ?`,
		runId
	);
	const itemsRemaining = await count(
		db,
		`SELECT COUNT(*) AS n FROM item
		 WHERE deleted_at IS NULL AND retired_at IS NULL
		   AND id NOT IN (SELECT item_id FROM reconcile_item_review WHERE run_id = ?)`,
		runId
	);
	const progress = { groupsDone, groupsTotal, itemsDone, itemsTotal: itemsDone + itemsRemaining };

	// eBay listings in "gone" groups that Dad must end by hand (no API).
	const { results: ebayToDelete } = await db
		.prepare(
			`SELECT title, url FROM reconcile_listing
			 WHERE platform = 'ebay'
			   AND group_id IN (SELECT id FROM reconcile_group WHERE run_id = ? AND decision = 'gone')
			 ORDER BY title`
		)
		.bind(runId)
		.all<{ title: string; url: string | null }>();

	// 1) Next pending group — validated ones first.
	const group = await db
		.prepare(
			`SELECT id, title FROM reconcile_group
			 WHERE run_id = ? AND decision IS NULL
			 ORDER BY (validated_at IS NOT NULL) DESC, id
			 LIMIT 1`
		)
		.bind(runId)
		.first<{ id: number; title: string }>();
	if (group) {
		const { results: groupListings } = await db
			.prepare(
				`SELECT id, platform, title, price_cents, qty, image_url, url
				 FROM reconcile_listing WHERE group_id = ? ORDER BY platform, id`
			)
			.bind(group.id)
			.all<GroupListing>();
		return {
			mode: 'group' as const,
			runId,
			group,
			groupListings,
			item: null as WizardItem | null,
			listings: [] as WizardListing[],
			progress,
			ebayToDelete
		};
	}

	// 2) Next existing item — out-of-stock first.
	const item = await db
		.prepare(
			`SELECT i.id, i.sku, i.title, i.stock_qty, i.tracking_mode, i.price_cents, i.sellable,
			        c.name AS cat_name, c.code AS cat_code,
			        (SELECT r2_key FROM item_photo
			         WHERE item_id = i.id AND deleted_at IS NULL
			         ORDER BY position, id LIMIT 1) AS photo_key
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 WHERE i.deleted_at IS NULL AND i.retired_at IS NULL
			   AND i.id NOT IN (SELECT item_id FROM reconcile_item_review WHERE run_id = ?)
			 ORDER BY (i.stock_qty = 0) DESC, i.id
			 LIMIT 1`
		)
		.bind(runId)
		.first<WizardItem>();
	if (item) {
		const res = await db
			.prepare(
				`SELECT platform, status, external_id, external_url, last_sync_status
				 FROM marketplace_listing WHERE item_id = ?`
			)
			.bind(item.id)
			.all<WizardListing>();
		return {
			mode: 'item' as const,
			runId,
			group: null as { id: number; title: string } | null,
			groupListings: [] as GroupListing[],
			item,
			listings: res.results,
			progress,
			ebayToDelete
		};
	}

	// 3) Everything reviewed.
	return {
		mode: 'done' as const,
		runId,
		group: null as { id: number; title: string } | null,
		groupListings: [] as GroupListing[],
		item: null as WizardItem | null,
		listings: [] as WizardListing[],
		progress,
		ebayToDelete
	};
};

async function markReviewed(
	db: ReturnType<typeof getDB>,
	runId: number,
	itemId: number,
	decision: string
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO reconcile_item_review (run_id, item_id, decision)
			 VALUES (?, ?, ?)
			 ON CONFLICT (run_id, item_id) DO UPDATE SET decision = excluded.decision`
		)
		.bind(runId, itemId, decision)
		.run();
}

/** Record a live listing as "dead" (pending removal) without touching the
 *  store yet — the dead-listings page does the actual deletes. eBay
 *  classic listings can't be ended via API, so they go straight to
 *  'manual'. No-op when there's no external id (not actually listed). */
async function queueDeadListing(
	db: ReturnType<typeof getDB>,
	runId: number | null,
	d: {
		platform: string;
		externalId: string | null;
		url: string | null;
		title: string | null;
		itemId: number | null;
		source: string;
	}
): Promise<void> {
	if (!d.externalId) return;
	const status = d.platform === 'ebay' ? 'manual' : 'pending';
	await db
		.prepare(
			`INSERT OR IGNORE INTO dead_listing
			   (run_id, platform, external_id, external_url, title, item_id, source, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(runId, d.platform, d.externalId, d.url, d.title, d.itemId, d.source, status)
		.run();
}

/** "Have it" / "Future" → AI pre-fill the group, stash it, hand off to a
 *  pre-filled /items/new. The form's save adopts the listings + resolves
 *  the group (see /items/new). */
async function startGroupOnboard(event: RequestEvent, decision: 'have' | 'future') {
	const db = getDB(event);
	const form = await event.request.formData();
	const groupId = parseInt((form.get('group_id') ?? '').toString(), 10);
	if (!Number.isInteger(groupId)) return fail(400, { wizardError: 'Bad group id.' });
	const qtyRaw = form.get('qty')?.toString();
	const qty =
		decision === 'future' ? 0 : qtyRaw && parseInt(qtyRaw, 10) >= 0 ? parseInt(qtyRaw, 10) : 1;

	const { results: listings } = await db
		.prepare(
			`SELECT platform, title, price_cents, image_url FROM reconcile_listing
			 WHERE group_id = ? ORDER BY platform, id`
		)
		.bind(groupId)
		.all<{ platform: string; title: string; price_cents: number | null; image_url: string | null }>();

	// First available photo → fed to the vision model to tell guitar-vs-part.
	const primaryImage = listings.find((l) => l.image_url)?.image_url ?? null;

	const apiKey = event.platform?.env?.ANTHROPIC_API_KEY;
	let prefill: Record<string, unknown> = {};
	if (apiKey && listings.length > 0) {
		try {
			prefill = (await prefillGroup(
				db,
				apiKey,
				listings,
				primaryImage
			)) as unknown as Record<string, unknown>;
		} catch {
			prefill = {};
		}
	}
	const stored = { ...prefill, qty, decision };
	await db
		.prepare(`UPDATE reconcile_group SET prefill_json = ?, updated_at = datetime('now') WHERE id = ?`)
		.bind(JSON.stringify(stored), groupId)
		.run();

	throw redirect(303, `/items/new?reconcile_group=${groupId}`);
}

export const actions: Actions = {
	haveIt: (event) => startGroupOnboard(event, 'have'),
	future: (event) => startGroupOnboard(event, 'future'),

	// "No longer have" for a whole group — mark it gone and QUEUE each of
	// its listings for removal (no live delete now; that happens later on
	// the dead-listings page). eBay classic listings go straight to
	// 'manual' since the API can't end them.
	groupGone: async (event) => {
		const db = getDB(event);
		const runId = await latestRunId(db);
		const form = await event.request.formData();
		const groupId = parseInt((form.get('group_id') ?? '').toString(), 10);
		if (!Number.isInteger(groupId)) return fail(400, { wizardError: 'Bad group id.' });

		const { results: gl } = await db
			.prepare(
				`SELECT platform, external_id, url, title FROM reconcile_listing WHERE group_id = ?`
			)
			.bind(groupId)
			.all<{ platform: string; external_id: string; url: string | null; title: string }>();
		for (const l of gl) {
			await queueDeadListing(db, runId, {
				platform: l.platform,
				externalId: l.external_id,
				url: l.url,
				title: l.title,
				itemId: null,
				source: 'group_gone'
			});
		}

		await db
			.prepare(
				`UPDATE reconcile_group
				 SET decision = 'gone', resolved_at = datetime('now'), updated_at = datetime('now')
				 WHERE id = ?`
			)
			.bind(groupId)
			.run();
		throw redirect(303, '/reconcile/wizard');
	},

	// ---- Existing-item review (stage 2) --------------------------------
	keep: async (event) => {
		const db = getDB(event);
		const runId = await latestRunId(db);
		if (runId == null) throw redirect(303, '/reconcile');
		const form = await event.request.formData();
		const itemId = parseInt((form.get('item_id') ?? '').toString(), 10);
		if (!Number.isInteger(itemId)) return fail(400, { reviewError: 'Bad item id.' });
		await markReviewed(db, runId, itemId, 'keep');
		throw redirect(303, '/reconcile/wizard');
	},

	// "Keep & sell" → confirm we still carry it, mark it sellable, and push
	// it live to Squarespace (publish/refresh the listing + turn on ongoing
	// auto-sync). An item not yet on Squarespace just gets the flag flipped;
	// the next-screen banner tells Dad to list it from the editor. SEO +
	// shipping live only in SS admin, so we nudge (softly) when SEO is blank.
	keepSellable: async (event) => {
		const db = getDB(event);
		const runId = await latestRunId(db);
		if (runId == null) throw redirect(303, '/reconcile');
		const form = await event.request.formData();
		const itemId = parseInt((form.get('item_id') ?? '').toString(), 10);
		if (!Number.isInteger(itemId)) return fail(400, { reviewError: 'Bad item id.' });

		await markReviewed(db, runId, itemId, 'keep_sellable');
		const ssKey = event.platform?.env?.SQUARESPACE_API_KEY;
		const r = await publishItemAsSellable(db, ssKey, itemId);

		const params = new URLSearchParams();
		if (r.sku) params.set('published', r.sku);
		params.set(
			'pub',
			r.sync.status === 'ok' ? 'ok' : r.sync.status === 'skipped' ? 'nolisting' : 'err'
		);
		if (r.sync.status === 'error') params.set('pubmsg', r.sync.message.slice(0, 160));
		if (r.seoMissing) params.set('seo', '1');

		// Pull the SS product's photos into our gallery if any are missing
		// (best-effort, idempotent, bounded).
		const r2 = event.platform?.env?.PHOTOS;
		if (r2 && ssKey) {
			try {
				const n = (await importItemPhotosFromSquarespace(db, r2, ssKey, itemId, 8)).added;
				if (n > 0) params.set('photos', String(n));
			} catch {
				/* non-fatal */
			}
		}
		throw redirect(303, `/reconcile/wizard?${params.toString()}`);
	},

	skip: async (event) => {
		const db = getDB(event);
		const runId = await latestRunId(db);
		if (runId == null) throw redirect(303, '/reconcile');
		const form = await event.request.formData();
		const itemId = parseInt((form.get('item_id') ?? '').toString(), 10);
		if (!Number.isInteger(itemId)) return fail(400, { reviewError: 'Bad item id.' });
		await markReviewed(db, runId, itemId, 'skip');
		throw redirect(303, '/reconcile/wizard');
	},

	retire: async (event) => {
		const db = getDB(event);
		const runId = await latestRunId(db);
		if (runId == null) throw redirect(303, '/reconcile');
		const form = await event.request.formData();
		const itemId = parseInt((form.get('item_id') ?? '').toString(), 10);
		if (!Number.isInteger(itemId)) return fail(400, { reviewError: 'Bad item id.' });

		const item = await db
			.prepare(`SELECT id, title, current_bin_id FROM item WHERE id = ? AND deleted_at IS NULL`)
			.bind(itemId)
			.first<{ id: number; title: string; current_bin_id: number | null }>();
		if (!item) throw error(404);

		await db.batch([
			db
				.prepare(
					`INSERT INTO movement (item_id, kind, from_bin_id, note, actor)
					 VALUES (?, 'scrap', ?, ?, ?)`
				)
				.bind(
					itemId,
					item.current_bin_id,
					'Discontinued (never carried) — retired during go-live review',
					event.locals?.userEmail ?? 'system'
				),
			db
				.prepare(
					`UPDATE item
					 SET retired_at = datetime('now'), retired_reason = 'discontinued',
					     current_bin_id = NULL, sellable = 0, updated_at = datetime('now')
					 WHERE id = ?`
				)
				.bind(itemId)
		]);

		// Queue its live marketplace listings for removal (the deliberate
		// teardown pass deletes them — we don't touch the live stores here).
		const { results: ml } = await db
			.prepare(
				`SELECT platform, external_id, external_variant_id, external_url, listing_title
				 FROM marketplace_listing WHERE item_id = ?`
			)
			.bind(itemId)
			.all<{
				platform: string;
				external_id: string | null;
				external_variant_id: string | null;
				external_url: string | null;
				listing_title: string | null;
			}>();
		for (const l of ml) {
			const extId = l.platform === 'ebay' ? (l.external_variant_id ?? l.external_id) : l.external_id;
			await queueDeadListing(db, runId, {
				platform: l.platform,
				externalId: extId,
				url: l.external_url,
				title: l.listing_title ?? item.title,
				itemId,
				source: 'item_retired'
			});
		}

		await markReviewed(db, runId, itemId, 'retired');
		throw redirect(303, '/reconcile/wizard');
	}
};
