import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { getDB } from '$lib/server/db';
import { resolveEbayCreds, setEbaySellerUsername } from '$lib/server/ebay_credentials';
import {
	scrapeSquarespace,
	scrapeReverb,
	scrapeEbay,
	detectModelFamily,
	type ScrapedListing
} from '$lib/server/reconcile';

/**
 * Cross-platform reconciliation — the go-live onboarding flow.
 *
 * Phase 1 (this file for now): scrape every listing from Squarespace,
 * Reverb, and eBay into the reconcile_* staging tables, deduping against
 * items we already track. The page shows the raw results + per-platform
 * errors so we can confirm the scrape (esp. eBay) before layering on the
 * AI matching + review wizard.
 */

interface RunRow {
	id: number;
	status: string;
	ss_count: number;
	ebay_count: number;
	reverb_count: number;
	ss_error: string | null;
	ebay_error: string | null;
	reverb_error: string | null;
	created_at: string;
}

interface ListingRow {
	id: number;
	platform: string;
	external_id: string;
	title: string;
	sku: string | null;
	price_cents: number | null;
	qty: number | null;
	image_url: string | null;
	url: string | null;
	existing_item_id: number | null;
	existing_item_sku: string | null;
	group_id: number | null;
	group_title: string | null;
	group_decision: string | null;
	group_validated: string | null;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	// eBay: are we connected, and what store link / username is stored?
	const ebayCreds = await resolveEbayCreds(db, event.platform?.env);
	const ebay = {
		connected: ebayCreds.hasRefreshToken,
		seller: ebayCreds.ebaySellerUsername ?? ebayCreds.accountLabel ?? ''
	};

	const run = await db
		.prepare(`SELECT * FROM reconcile_run ORDER BY id DESC LIMIT 1`)
		.first<RunRow>();

	if (!run) {
		return { run: null, listings: [] as ListingRow[], ebay, matched: false };
	}

	const { results: listings } = await db
		.prepare(
			`SELECT rl.id, rl.platform, rl.external_id, rl.title, rl.sku,
			        rl.price_cents, rl.qty, rl.image_url, rl.url, rl.existing_item_id,
			        i.sku AS existing_item_sku,
			        rl.group_id, g.title AS group_title, g.decision AS group_decision,
			        g.validated_at AS group_validated
			 FROM reconcile_listing rl
			 LEFT JOIN item i ON i.id = rl.existing_item_id
			 LEFT JOIN reconcile_group g ON g.id = rl.group_id
			 WHERE rl.run_id = ?
			 ORDER BY rl.group_id, rl.platform, rl.title`
		)
		.bind(run.id)
		.all<ListingRow>();

	const matched = listings.some((l) => l.group_id != null);

	return { run, listings, ebay, matched };
};

export const actions: Actions = {
	scrape: async (event) => {
		const db = getDB(event);
		const env = event.platform?.env;

		// New run row up front so even a partial scrape is recorded.
		const runRes = await db
			.prepare(`INSERT INTO reconcile_run (status) VALUES ('scraping')`)
			.run();
		const runId = runRes.meta.last_row_id as number;

		// --- Scrape each platform independently, capturing errors. ----
		const errors: { ss: string | null; ebay: string | null; reverb: string | null } = {
			ss: null,
			ebay: null,
			reverb: null
		};
		let ss: ScrapedListing[] = [];
		let reverb: ScrapedListing[] = [];
		let ebay: ScrapedListing[] = [];

		const ssKey = env?.SQUARESPACE_API_KEY;
		if (ssKey) {
			try {
				ss = await scrapeSquarespace(ssKey);
			} catch (err) {
				errors.ss = err instanceof Error ? err.message : String(err);
			}
		} else {
			errors.ss = 'Squarespace API key not configured.';
		}

		const reverbKey = env?.REVERB_API_KEY;
		if (reverbKey) {
			try {
				reverb = await scrapeReverb(reverbKey);
			} catch (err) {
				errors.reverb = err instanceof Error ? err.message : String(err);
			}
		} else {
			errors.reverb = 'Reverb API key not configured.';
		}

		try {
			const creds = await resolveEbayCreds(db, env);
			ebay = await scrapeEbay(creds);
		} catch (err) {
			errors.ebay = err instanceof Error ? err.message : String(err);
		}

		// --- Persist all scraped listings under this run. -------------
		const all = [...ss, ...reverb, ...ebay];
		const stmts = all.map((l) =>
			db
				.prepare(
					`INSERT INTO reconcile_listing
					   (run_id, platform, external_id, title, sku, price_cents, qty, image_url, url)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					runId,
					l.platform,
					l.externalId,
					l.title,
					l.sku,
					l.priceCents,
					l.qty,
					l.imageUrl,
					l.url
				)
		);
		// D1 batches are capped in size — chunk the inserts.
		for (let i = 0; i < stmts.length; i += 50) {
			await db.batch(stmts.slice(i, i + 50));
		}

		// --- Dedupe: link rows that already map to one of our items. --
		// Squarespace: by marketplace_listing.external_id, then by the
		// legacy item.squarespace_product_id column.
		await db
			.prepare(
				`UPDATE reconcile_listing
				 SET existing_item_id = (
				   SELECT ml.item_id FROM marketplace_listing ml
				   WHERE ml.platform = 'squarespace' AND ml.external_id = reconcile_listing.external_id
				 )
				 WHERE run_id = ? AND platform = 'squarespace' AND existing_item_id IS NULL`
			)
			.bind(runId)
			.run();
		await db
			.prepare(
				`UPDATE reconcile_listing
				 SET existing_item_id = (
				   SELECT i.id FROM item i
				   WHERE i.squarespace_product_id = reconcile_listing.external_id AND i.deleted_at IS NULL
				 )
				 WHERE run_id = ? AND platform = 'squarespace' AND existing_item_id IS NULL`
			)
			.bind(runId)
			.run();
		// Reverb: marketplace_listing.external_id.
		await db
			.prepare(
				`UPDATE reconcile_listing
				 SET existing_item_id = (
				   SELECT ml.item_id FROM marketplace_listing ml
				   WHERE ml.platform = 'reverb' AND ml.external_id = reconcile_listing.external_id
				 )
				 WHERE run_id = ? AND platform = 'reverb' AND existing_item_id IS NULL`
			)
			.bind(runId)
			.run();
		// eBay: our stored id may be the offer id (external_id) or the
		// listing id (external_variant_id); the scrape captured the legacy
		// item id, which equals the listing id — match either column.
		await db
			.prepare(
				`UPDATE reconcile_listing
				 SET existing_item_id = (
				   SELECT ml.item_id FROM marketplace_listing ml
				   WHERE ml.platform = 'ebay'
				     AND (ml.external_variant_id = reconcile_listing.external_id
				          OR ml.external_id = reconcile_listing.external_id)
				 )
				 WHERE run_id = ? AND platform = 'ebay' AND existing_item_id IS NULL`
			)
			.bind(runId)
			.run();

		// --- Finalize the run. ----------------------------------------
		await db
			.prepare(
				`UPDATE reconcile_run
				 SET status = 'reviewing',
				     ss_count = ?, reverb_count = ?, ebay_count = ?,
				     ss_error = ?, reverb_error = ?, ebay_error = ?,
				     updated_at = datetime('now')
				 WHERE id = ?`
			)
			.bind(
				ss.length,
				reverb.length,
				ebay.length,
				errors.ss,
				errors.reverb,
				errors.ebay,
				runId
			)
			.run();

		throw redirect(303, '/reconcile');
	},

	match: async (event) => {
		const db = getDB(event);
		const apiKey = event.platform?.env?.ANTHROPIC_API_KEY;
		if (!apiKey) return fail(400, { matchError: 'ANTHROPIC_API_KEY is not configured.' });

		const run = await db
			.prepare(`SELECT id FROM reconcile_run ORDER BY id DESC LIMIT 1`)
			.first<{ id: number }>();
		if (!run) return fail(400, { matchError: 'Run a scrape first.' });

		// Reset any prior grouping so re-matching is idempotent.
		await db.prepare(`UPDATE reconcile_listing SET group_id = NULL WHERE run_id = ?`).bind(run.id).run();
		await db.prepare(`DELETE FROM reconcile_group WHERE run_id = ?`).bind(run.id).run();

		const { results: listings } = await db
			.prepare(
				`SELECT id, platform, title, price_cents, sku, existing_item_id
				 FROM reconcile_listing WHERE run_id = ?`
			)
			.bind(run.id)
			.all<{
				id: number;
				platform: string;
				title: string;
				price_cents: number | null;
				sku: string | null;
				existing_item_id: number | null;
			}>();

		// Helper: assign a set of listing ids to a group id (chunked).
		const assignGroup = async (groupId: number, ids: number[]) => {
			for (let i = 0; i < ids.length; i += 40) {
				const chunk = ids.slice(i, i + 40);
				await db
					.prepare(
						`UPDATE reconcile_listing SET group_id = ?
						 WHERE id IN (${chunk.map(() => '?').join(',')})`
					)
					.bind(groupId, ...chunk)
					.run();
			}
		};

		// 1) Listings already tied to an item → one resolved 'skipped'
		//    group per item (they're done; no review needed).
		const linkedByItem = new Map<number, number[]>();
		const unlinked: typeof listings = [];
		for (const l of listings) {
			if (l.existing_item_id != null) {
				const a = linkedByItem.get(l.existing_item_id);
				if (a) a.push(l.id);
				else linkedByItem.set(l.existing_item_id, [l.id]);
			} else {
				unlinked.push(l);
			}
		}
		for (const [itemId, ids] of linkedByItem) {
			const rep = listings.find((l) => l.id === ids[0]);
			const gid = (
				await db
					.prepare(
						`INSERT INTO reconcile_group (run_id, title, decision, item_id, resolved_at)
						 VALUES (?, ?, 'skipped', ?, datetime('now'))`
					)
					.bind(run.id, rep?.title ?? 'Linked item', itemId)
					.run()
			).meta.last_row_id as number;
			await assignGroup(gid, ids);
		}

		// 2) AI-cluster the unlinked listings across platforms.
		const groups: Array<{ ids: number[]; title: string }> = [];
		if (unlinked.length > 0) {
			const lines = unlinked
				.map(
					(l) =>
						`#${l.id} [${l.platform}] "${l.title}"${
							l.price_cents != null ? ` $${(l.price_cents / 100).toFixed(2)}` : ''
						}${l.sku ? ` sku:${l.sku}` : ''}`
				)
				.join('\n');

			// Learning loop: past "detach" corrections tell the AI which
			// look-alikes to keep apart this time.
			const { results: fb } = await db
				.prepare(
					`SELECT listing_title, sibling_titles, reason
					 FROM reconcile_feedback ORDER BY id DESC LIMIT 40`
				)
				.all<{ listing_title: string; sibling_titles: string | null; reason: string | null }>();
			let feedbackNote = '';
			if (fb.length > 0) {
				const fbLines = fb.map((f) => {
					let sibs: string[] = [];
					try {
						sibs = JSON.parse(f.sibling_titles ?? '[]');
					} catch {
						sibs = [];
					}
					const sibStr = sibs.map((s) => `"${s}"`).join(', ');
					return `- "${f.listing_title}" is NOT the same product as ${sibStr}${
						f.reason ? ` — ${f.reason}` : ''
					}`;
				});
				feedbackNote = `\n\nKnown NON-matches from the owner's past corrections — keep each of these in SEPARATE groups:\n${fbLines.join('\n')}`;
			}

			const system = `You group marketplace listings that are the SAME physical product so a shop owner can unify them into one inventory item. Listings come from Squarespace, eBay, and Reverb and may be worded differently across platforms.

Group by product IDENTITY (brand + model + type + key specs), not by wording overlap. The same guitar/part listed on two platforms belongs in ONE group. Genuinely different products stay separate. A product listed on only one platform is its own group of one.

CRITICAL — the guitar/bass MODEL is a hard discriminator. Never put two different models in the same group, even if every other word matches:
- Telecaster ≠ Stratocaster (the single most common mistake — keep them apart)
- Les Paul ≠ SG ≠ Telecaster ≠ Stratocaster
- Precision Bass (P-Bass) ≠ Jazz Bass (J-Bass)
- Jazzmaster ≠ Jaguar ≠ Mustang
Different body shape, color, pickup configuration, neck profile, or part type = different product = different group.

Bias toward NOT merging: only put two listings together when you are confident they are the exact same product. When unsure, leave them as separate single-listing groups — the owner can combine them by hand, but a wrong merge corrupts his data.

Return ONLY a JSON object:
{ "groups": [ { "title": "short representative name", "ids": [12, 47] } ] }

Every id you were given must appear in exactly one group. Do not invent ids. No prose, no code fences.${feedbackNote}`;
			const anthropic = new Anthropic({ apiKey });
			try {
				const msg = await anthropic.messages.create({
					model: 'claude-haiku-4-5',
					max_tokens: 8000,
					system,
					messages: [
						{
							role: 'user',
							content: `Group these ${unlinked.length} listings:\n\n${lines}\n\nReturn the JSON object only.`
						}
					]
				});
				const raw = msg.content
					.filter((b): b is Anthropic.TextBlock => b.type === 'text')
					.map((b) => b.text)
					.join('')
					.trim();
				const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
				const fb = cleaned.indexOf('{');
				const lb = cleaned.lastIndexOf('}');
				const slice = fb >= 0 && lb > fb ? cleaned.slice(fb, lb + 1) : cleaned;
				const parsed = JSON.parse(slice) as { groups?: Array<{ title?: string; ids?: number[] }> };
				const validIds = new Set(unlinked.map((l) => l.id));
				const used = new Set<number>();
				for (const g of parsed.groups ?? []) {
					const ids = (g.ids ?? []).filter((id) => validIds.has(id) && !used.has(id));
					if (ids.length === 0) continue;
					ids.forEach((id) => used.add(id));
					const rep = unlinked.find((l) => l.id === ids[0]);
					groups.push({ ids, title: (g.title ?? rep?.title ?? 'Group').slice(0, 200) });
				}
				// Any listing the AI dropped → its own singleton group.
				for (const l of unlinked) {
					if (!used.has(l.id)) groups.push({ ids: [l.id], title: l.title });
				}
			} catch (err) {
				// AI failed — fall back to one group per listing so the
				// wizard still works (Dad can combine manually).
				console.error('reconcile match: AI grouping failed', err);
				for (const l of unlinked) groups.push({ ids: [l.id], title: l.title });
			}
		}

		// 2b) Deterministic backstop: never let one group span two distinct
		//     guitar/bass model families (Tele vs Strat, etc.). The AI
		//     overlaps their vocabulary and sometimes merges them, so split
		//     any group that mixes models.
		if (groups.length > 0) {
			const titleById = new Map(unlinked.map((l) => [l.id, l.title]));
			const refined: Array<{ ids: number[]; title: string }> = [];
			for (const g of groups) {
				const byKey = new Map<string, number[]>();
				for (const id of g.ids) {
					const fam = detectModelFamily(titleById.get(id) ?? '');
					// Unknown-family listings get a unique key so they never
					// merge across models when we split.
					const key = fam ?? `__none_${id}`;
					const arr = byKey.get(key);
					if (arr) arr.push(id);
					else byKey.set(key, [id]);
				}
				const knownFamilies = [...byKey.keys()].filter((k) => !k.startsWith('__none_'));
				if (knownFamilies.length <= 1) {
					refined.push(g); // 0–1 model named → group is fine as-is
				} else {
					// 2+ distinct models mixed → break apart by family, and
					// isolate the ambiguous (no-model) listings rather than
					// guess which model they belong to.
					for (const [, ids] of byKey) {
						refined.push({ ids, title: titleById.get(ids[0]) ?? g.title });
					}
				}
			}
			groups.length = 0;
			groups.push(...refined);
		}

		// 3) Persist the AI/fallback groups.
		for (const g of groups) {
			const gid = (
				await db
					.prepare(`INSERT INTO reconcile_group (run_id, title) VALUES (?, ?)`)
					.bind(run.id, g.title)
					.run()
			).meta.last_row_id as number;
			await assignGroup(gid, g.ids);
		}

		await db
			.prepare(`UPDATE reconcile_run SET status = 'reviewing', updated_at = datetime('now') WHERE id = ?`)
			.bind(run.id)
			.run();

		throw redirect(303, '/reconcile');
	},

	// Pull one listing out of its group (the AI mis-grouped it) and record
	// WHY, so future matches can avoid the same mistake.
	detachListing: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const listingId = parseInt((form.get('listing_id') ?? '').toString(), 10);
		const reason = (form.get('reason') ?? '').toString().trim() || null;
		if (!Number.isInteger(listingId)) return fail(400, { detachError: 'Bad listing id.' });

		const listing = await db
			.prepare(`SELECT id, run_id, group_id, title FROM reconcile_listing WHERE id = ?`)
			.bind(listingId)
			.first<{ id: number; run_id: number; group_id: number | null; title: string }>();
		if (!listing) return fail(404, { detachError: 'Listing not found.' });

		// Capture the siblings it was wrongly grouped with (for learning).
		let siblingTitles: string[] = [];
		if (listing.group_id != null) {
			const { results } = await db
				.prepare(`SELECT title FROM reconcile_listing WHERE group_id = ? AND id != ?`)
				.bind(listing.group_id, listingId)
				.all<{ title: string }>();
			siblingTitles = results.map((r) => r.title);
		}

		// New singleton group for the detached listing.
		const gid = (
			await db
				.prepare(`INSERT INTO reconcile_group (run_id, title) VALUES (?, ?)`)
				.bind(listing.run_id, listing.title)
				.run()
		).meta.last_row_id as number;
		await db
			.prepare(`UPDATE reconcile_listing SET group_id = ? WHERE id = ?`)
			.bind(gid, listingId)
			.run();

		// The group it left changed makeup → drop its validated stamp.
		if (listing.group_id != null) {
			await db
				.prepare(`UPDATE reconcile_group SET validated_at = NULL WHERE id = ?`)
				.bind(listing.group_id)
				.run();
		}

		// Record feedback only when it was actually grouped with others.
		if (siblingTitles.length > 0) {
			await db
				.prepare(
					`INSERT INTO reconcile_feedback
					   (run_id, listing_id, listing_title, sibling_titles, reason)
					 VALUES (?, ?, ?, ?, ?)`
				)
				.bind(listing.run_id, listingId, listing.title, JSON.stringify(siblingTitles), reason)
				.run();
		}

		throw redirect(303, '/reconcile');
	},

	// Mark a group's grouping as confirmed-correct (or clear it). Lets Dad
	// sign off on the AI's work before the decision wizard.
	validateGroup: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const groupId = parseInt((form.get('group_id') ?? '').toString(), 10);
		const on = (form.get('on') ?? '1').toString() === '1';
		if (!Number.isInteger(groupId)) return fail(400, {});
		await db
			.prepare(
				`UPDATE reconcile_group
				 SET validated_at = ${on ? "datetime('now')" : 'NULL'}, updated_at = datetime('now')
				 WHERE id = ?`
			)
			.bind(groupId)
			.run();
		throw redirect(303, '/reconcile');
	},

	setEbayUsername: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const value = (form.get('ebay_seller') ?? '').toString();
		await setEbaySellerUsername(db, value);
		throw redirect(303, '/reconcile');
	},

	reset: async (event) => {
		// Wipe staging so a fresh scrape starts clean. (Onboarding is a
		// throwaway workspace; resolved items already live in `item`.)
		const db = getDB(event);
		await db.batch([
			db.prepare(`DELETE FROM reconcile_listing`),
			db.prepare(`DELETE FROM reconcile_group`),
			db.prepare(`DELETE FROM reconcile_run`)
		]);
		throw redirect(303, '/reconcile');
	}
};
