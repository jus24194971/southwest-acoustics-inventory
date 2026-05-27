import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/**
 * /locations — top-level list of physical spaces (workshop, warehouse,
 * etc.) plus the actions needed to grow + maintain the list:
 *
 *   - create   → add a new location (code + name)
 *   - retire   → soft-delete (set deleted_at)
 *   - unretire → restore (clear deleted_at)
 *   - rename   → edit the friendly name in place
 *
 * Retiring a location automatically hides every bin under it because
 * the bin queries elsewhere all filter on `loc.deleted_at IS NULL` —
 * one toggle, the location and its whole tree disappear from pickers.
 */

interface LocationRow {
	id: number;
	code: string;
	name: string;
	bin_count: number;
	retired_at: string | null;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	const { results } = await db
		.prepare(
			// Include retired locations — the UI renders them in a separate
			// section so Dad can unretire by mistake. Bin count only
			// includes live bins; counting retired bins under a retired
			// location would be misleading.
			`SELECT
				loc.id, loc.code, loc.name,
				loc.deleted_at AS retired_at,
				COUNT(CASE WHEN bin.deleted_at IS NULL THEN 1 END) AS bin_count
			 FROM location loc
			 LEFT JOIN bin ON bin.location_id = loc.id
			 GROUP BY loc.id, loc.code, loc.name, loc.deleted_at
			 ORDER BY loc.deleted_at IS NULL DESC, loc.code`
		)
		.all<LocationRow>();

	return {
		locations: results.filter((l) => l.retired_at === null),
		retiredLocations: results.filter((l) => l.retired_at !== null)
	};
};

export const actions: Actions = {
	create: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();

		// Location codes are UPPERCASE, 2–4 chars, alphanumeric — keeps
		// labels tidy ("GAR / Bin A-12") and avoids collisions with bin
		// codes. Names are free-form.
		const code = (form.get('code') ?? '').toString().trim().toUpperCase();
		const name = (form.get('name') ?? '').toString().trim();

		const errors: Record<string, string> = {};
		if (!code) errors.code = 'Code is required.';
		else if (!/^[A-Z0-9]{2,4}$/.test(code)) errors.code = '2–4 letters or digits, uppercase.';
		if (!name) errors.name = 'Name is required.';

		if (Object.keys(errors).length > 0) {
			return fail(400, { createErrors: errors, createValues: { code, name } });
		}

		// Uniqueness check on (live OR retired) — reusing a retired
		// location's code is allowed via unretire, not via re-create.
		const existing = await db
			.prepare(`SELECT id, deleted_at FROM location WHERE code = ?`)
			.bind(code)
			.first<{ id: number; deleted_at: string | null }>();
		if (existing) {
			const dup: Record<string, string> = existing.deleted_at
				? { code: `Code "${code}" is taken by a retired location — unretire it instead.` }
				: { code: `Code "${code}" already exists.` };
			return fail(400, { createErrors: dup, createValues: { code, name } });
		}

		await db
			.prepare(`INSERT INTO location (code, name) VALUES (?, ?)`)
			.bind(code, name)
			.run();

		throw redirect(303, '/locations');
	},

	retire: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const idRaw = form.get('id')?.toString();
		const id = idRaw ? parseInt(idRaw, 10) : NaN;
		if (!Number.isInteger(id)) return fail(400, { actionError: 'Bad location id.' });

		await db
			.prepare(
				`UPDATE location SET deleted_at = datetime('now')
				 WHERE id = ? AND deleted_at IS NULL`
			)
			.bind(id)
			.run();

		throw redirect(303, '/locations');
	},

	unretire: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const idRaw = form.get('id')?.toString();
		const id = idRaw ? parseInt(idRaw, 10) : NaN;
		if (!Number.isInteger(id)) return fail(400, { actionError: 'Bad location id.' });

		await db
			.prepare(
				`UPDATE location SET deleted_at = NULL
				 WHERE id = ? AND deleted_at IS NOT NULL`
			)
			.bind(id)
			.run();

		throw redirect(303, '/locations');
	},

	rename: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const idRaw = form.get('id')?.toString();
		const id = idRaw ? parseInt(idRaw, 10) : NaN;
		const name = (form.get('name') ?? '').toString().trim();

		if (!Number.isInteger(id)) return fail(400, { actionError: 'Bad location id.' });
		if (!name) return fail(400, { actionError: 'Name is required.' });

		await db
			.prepare(`UPDATE location SET name = ? WHERE id = ?`)
			.bind(name, id)
			.run();

		throw redirect(303, '/locations');
	}
};
