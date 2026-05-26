import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/**
 * Location detail — nested bin tree.
 *
 * Bins now form a tree per-location (see migration 0006). We use a
 * recursive CTE to enumerate the tree in depth-first order, carrying
 * a path string and depth for rendering. Item counts include direct
 * children only; rolled-up "items in this subtree" totals are
 * computed client-side from the same list.
 */

interface LocationRow {
	id: number;
	code: string;
	name: string;
	address: string | null;
	notes: string | null;
}

export interface BinTreeRow {
	id: number;
	parent_bin_id: number | null;
	code: string;
	name: string | null;
	notes: string | null;
	depth: number;
	path: string;
	item_count: number;
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

	// Recursive CTE walks the tree from each root (parent_bin_id IS NULL)
	// outward, building up a slash-joined path and tracking depth. Items
	// per bin counted via LEFT JOIN on the outer SELECT.
	const { results: bins } = await db
		.prepare(
			`WITH RECURSIVE bin_tree(id, parent_bin_id, code, name, notes, depth, path) AS (
				SELECT id, parent_bin_id, code, name, notes,
				       0 AS depth,
				       code AS path
				FROM bin
				WHERE parent_bin_id IS NULL
				  AND location_id = ?
				  AND deleted_at IS NULL

				UNION ALL

				SELECT b.id, b.parent_bin_id, b.code, b.name, b.notes,
				       bt.depth + 1,
				       bt.path || ' / ' || b.code
				FROM bin b
				JOIN bin_tree bt ON b.parent_bin_id = bt.id
				WHERE b.deleted_at IS NULL
			)
			SELECT bt.id, bt.parent_bin_id, bt.code, bt.name, bt.notes,
			       bt.depth, bt.path,
			       COUNT(CASE WHEN item.retired_at IS NULL AND item.deleted_at IS NULL THEN 1 END) AS item_count
			FROM bin_tree bt
			LEFT JOIN item ON item.current_bin_id = bt.id
			GROUP BY bt.id, bt.parent_bin_id, bt.code, bt.name, bt.notes, bt.depth, bt.path
			ORDER BY bt.path`
		)
		.bind(id)
		.all<BinTreeRow>();

	return { location, bins: bins as BinTreeRow[] };
};

export const actions: Actions = {
	addBin: async (event) => {
		const db = getDB(event);
		const locationId = parseInt(event.params.id, 10);

		const form = await event.request.formData();
		const code = (form.get('code') ?? '').toString().trim().toUpperCase();
		const name = (form.get('name') ?? '').toString().trim() || null;
		const notes = (form.get('notes') ?? '').toString().trim() || null;
		const parentIdRaw = form.get('parent_bin_id')?.toString().trim();
		const parentId = parentIdRaw ? parseInt(parentIdRaw, 10) : null;

		if (!code) return fail(400, { addError: 'Bin code is required.' });

		// Verify the parent belongs to this location (don't let a Cabinet
		// in Garage adopt a Drawer in Warehouse via crafted form data).
		if (parentId != null) {
			const parent = await db
				.prepare(
					`SELECT id FROM bin WHERE id = ? AND location_id = ? AND deleted_at IS NULL`
				)
				.bind(parentId, locationId)
				.first();
			if (!parent) return fail(400, { addError: 'Selected parent bin not found.' });
		}

		try {
			await db
				.prepare(
					`INSERT INTO bin (location_id, parent_bin_id, code, name, notes)
					 VALUES (?, ?, ?, ?, ?)`
				)
				.bind(locationId, parentId, code, name, notes)
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
		const db = getDB(event);
		const locationId = parseInt(event.params.id, 10);

		const form = await event.request.formData();
		const prefix = (form.get('prefix') ?? '').toString().trim().toUpperCase();
		const startStr = form.get('start')?.toString();
		const endStr = form.get('end')?.toString();
		const pad = parseInt((form.get('pad') ?? '0').toString(), 10) || 0;
		const parentIdRaw = form.get('parent_bin_id')?.toString().trim();
		const parentId = parentIdRaw ? parseInt(parentIdRaw, 10) : null;

		const start = startStr ? parseInt(startStr, 10) : NaN;
		const end = endStr ? parseInt(endStr, 10) : NaN;

		if (!prefix) return fail(400, { bulkError: 'Prefix is required.' });
		if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
			return fail(400, { bulkError: 'Start and end must be numbers, with start ≤ end.' });
		}
		if (end - start > 200) {
			return fail(400, { bulkError: 'Cap of 200 bins per bulk add.' });
		}

		if (parentId != null) {
			const parent = await db
				.prepare(
					`SELECT id FROM bin WHERE id = ? AND location_id = ? AND deleted_at IS NULL`
				)
				.bind(parentId, locationId)
				.first();
			if (!parent) return fail(400, { bulkError: 'Selected parent bin not found.' });
		}

		const stmts = [];
		for (let n = start; n <= end; n++) {
			const code = `${prefix}${String(n).padStart(pad, '0')}`;
			stmts.push(
				db
					.prepare(
						`INSERT INTO bin (location_id, parent_bin_id, code)
						 VALUES (?, ?, ?)
						 ON CONFLICT(location_id, code) DO NOTHING`
					)
					.bind(locationId, parentId, code)
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

		// Block retire if the bin holds items OR has live children.
		// Empty out / move children first.
		const blockers = await db
			.prepare(
				`SELECT
					(SELECT COUNT(*) FROM item
					 WHERE current_bin_id = ?
					   AND retired_at IS NULL AND deleted_at IS NULL) AS items,
					(SELECT COUNT(*) FROM bin
					 WHERE parent_bin_id = ?
					   AND deleted_at IS NULL) AS children`
			)
			.bind(binId, binId)
			.first<{ items: number; children: number }>();

		if ((blockers?.items ?? 0) > 0) {
			return fail(400, {
				actionError: `Can't retire — this bin still holds ${blockers?.items} item(s). Transfer them out first.`
			});
		}
		if ((blockers?.children ?? 0) > 0) {
			return fail(400, {
				actionError: `Can't retire — this bin has ${blockers?.children} child bin(s). Retire or move them first.`
			});
		}

		await db
			.prepare(`UPDATE bin SET deleted_at = datetime('now') WHERE id = ? AND location_id = ?`)
			.bind(binId, locationId)
			.run();

		throw redirect(303, `/locations/${locationId}`);
	}
};
