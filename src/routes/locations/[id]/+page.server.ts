import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/**
 * Location detail — view + manage the bins under one location.
 *
 * Bins are intentionally minimal: a short code that's friendly to print
 * on a label and scan ("A-12", "DRAWER-3"), an optional friendly name,
 * an optional note. We track item count per bin so the user can see
 * what's where at a glance, but the bin itself stays generic — Dad's
 * organization is still settling, and bins shouldn't bake in assumptions.
 *
 * Soft delete on retire: items historically located in a bin should
 * still resolve their bin name when reviewing movement history, so the
 * row sticks around but stops showing up in pickers.
 */

interface LocationRow {
	id: number;
	code: string;
	name: string;
	address: string | null;
	notes: string | null;
	created_at: string;
}

interface BinRow {
	id: number;
	code: string;
	name: string | null;
	notes: string | null;
	item_count: number;
	created_at: string;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const id = parseInt(event.params.id, 10);
	if (!Number.isInteger(id)) throw error(404);

	const location = await db
		.prepare(`SELECT * FROM location WHERE id = ? AND deleted_at IS NULL`)
		.bind(id)
		.first<LocationRow>();
	if (!location) throw error(404, 'Location not found');

	// Bins + count of currently-on-hand items per bin. Retired items don't
	// count toward the visible total — they're history, not stock.
	const { results: bins } = await db
		.prepare(
			`SELECT
				bin.id, bin.code, bin.name, bin.notes, bin.created_at,
				COUNT(CASE WHEN item.retired_at IS NULL AND item.deleted_at IS NULL THEN 1 END) AS item_count
			 FROM bin
			 LEFT JOIN item ON item.current_bin_id = bin.id
			 WHERE bin.location_id = ? AND bin.deleted_at IS NULL
			 GROUP BY bin.id, bin.code, bin.name, bin.notes, bin.created_at
			 ORDER BY bin.code`
		)
		.bind(id)
		.all<BinRow>();

	return { location, bins };
};

export const actions: Actions = {
	addBin: async (event) => {
		const db = getDB(event);
		const locationId = parseInt(event.params.id, 10);

		const form = await event.request.formData();
		const code = (form.get('code') ?? '').toString().trim().toUpperCase();
		const name = (form.get('name') ?? '').toString().trim() || null;
		const notes = (form.get('notes') ?? '').toString().trim() || null;

		if (!code) return fail(400, { addError: 'Bin code is required.' });
		// Bin code uniqueness is per-location via the (location_id, code)
		// UNIQUE index — let the DB catch duplicates, render a friendly
		// message back.
		try {
			await db
				.prepare(`INSERT INTO bin (location_id, code, name, notes) VALUES (?, ?, ?, ?)`)
				.bind(locationId, code, name, notes)
				.run();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('UNIQUE')) {
				return fail(400, { addError: `A bin "${code}" already exists in this location.` });
			}
			return fail(500, { addError: msg });
		}

		throw redirect(303, `/locations/${locationId}`);
	},

	addBulk: async (event) => {
		// Convenience: enter a prefix + a start/end range and we create
		// every bin in between in one go ("A-1" through "A-10"). Common
		// shop pattern, much faster than adding 10 bins one-by-one.
		const db = getDB(event);
		const locationId = parseInt(event.params.id, 10);

		const form = await event.request.formData();
		const prefix = (form.get('prefix') ?? '').toString().trim().toUpperCase();
		const startStr = form.get('start')?.toString();
		const endStr = form.get('end')?.toString();
		const pad = parseInt((form.get('pad') ?? '0').toString(), 10) || 0;

		const start = startStr ? parseInt(startStr, 10) : NaN;
		const end = endStr ? parseInt(endStr, 10) : NaN;

		if (!prefix) return fail(400, { bulkError: 'Prefix is required (e.g. "A-").' });
		if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
			return fail(400, { bulkError: 'Start and end must be numbers, with start ≤ end.' });
		}
		if (end - start > 200) {
			return fail(400, { bulkError: 'Cap of 200 bins per bulk add — split into multiple calls.' });
		}

		// Bulk INSERT via batch. Existing codes (if any) are skipped via
		// ON CONFLICT so the caller can re-run safely.
		const stmts = [];
		for (let n = start; n <= end; n++) {
			const code = `${prefix}${String(n).padStart(pad, '0')}`;
			stmts.push(
				db
					.prepare(
						`INSERT INTO bin (location_id, code)
						 VALUES (?, ?)
						 ON CONFLICT(location_id, code) DO NOTHING`
					)
					.bind(locationId, code)
			);
		}
		await db.batch(stmts);

		throw redirect(303, `/locations/${locationId}`);
	},

	editBin: async (event) => {
		const db = getDB(event);
		const locationId = parseInt(event.params.id, 10);
		const form = await event.request.formData();
		const binId = parseInt(form.get('bin_id')?.toString() ?? '', 10);
		const code = (form.get('code') ?? '').toString().trim().toUpperCase();
		const name = (form.get('name') ?? '').toString().trim() || null;
		const notes = (form.get('notes') ?? '').toString().trim() || null;

		if (!Number.isInteger(binId)) return fail(400, { actionError: 'Bad bin id.' });
		if (!code) return fail(400, { actionError: 'Bin code is required.' });

		try {
			await db
				.prepare(
					`UPDATE bin SET code = ?, name = ?, notes = ?
					 WHERE id = ? AND location_id = ?`
				)
				.bind(code, name, notes, binId, locationId)
				.run();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('UNIQUE')) {
				return fail(400, { actionError: `Another bin "${code}" already exists in this location.` });
			}
			return fail(500, { actionError: msg });
		}

		throw redirect(303, `/locations/${locationId}`);
	},

	retireBin: async (event) => {
		const db = getDB(event);
		const locationId = parseInt(event.params.id, 10);
		const form = await event.request.formData();
		const binId = parseInt(form.get('bin_id')?.toString() ?? '', 10);
		if (!Number.isInteger(binId)) return fail(400, { actionError: 'Bad bin id.' });

		// Don't retire a bin that still holds items — the user should
		// transfer/retire those first. The error tells them how many,
		// so they know what they're dealing with.
		const inUse = await db
			.prepare(
				`SELECT COUNT(*) AS n FROM item
				 WHERE current_bin_id = ? AND retired_at IS NULL AND deleted_at IS NULL`
			)
			.bind(binId)
			.first<{ n: number }>();
		if ((inUse?.n ?? 0) > 0) {
			return fail(400, {
				actionError: `Can't retire — this bin still holds ${inUse?.n} item(s). Transfer them out first.`
			});
		}

		await db
			.prepare(`UPDATE bin SET deleted_at = datetime('now') WHERE id = ? AND location_id = ?`)
			.bind(binId, locationId)
			.run();

		throw redirect(303, `/locations/${locationId}`);
	}
};
