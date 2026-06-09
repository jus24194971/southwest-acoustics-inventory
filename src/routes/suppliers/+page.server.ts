import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/**
 * /suppliers — the supplier directory. Lists every seller with order
 * count + how many parts name them as preferred, a preferred-star
 * toggle, and an add form. Preferred suppliers sort to the top.
 */

interface SupplierRow {
	id: number;
	name: string;
	kind: string | null;
	url: string | null;
	contact: string | null;
	is_preferred: number;
	order_count: number;
	preferred_part_count: number;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const { results } = await db
		.prepare(
			`SELECT s.id, s.name, s.kind, s.url, s.contact, s.is_preferred,
			        (SELECT COUNT(*) FROM inbound_order o WHERE o.supplier_id = s.id) AS order_count,
			        (SELECT COUNT(*) FROM item i WHERE i.preferred_supplier_id = s.id AND i.deleted_at IS NULL) AS preferred_part_count
			 FROM supplier s
			 ORDER BY s.is_preferred DESC, s.name COLLATE NOCASE`
		)
		.all<SupplierRow>();
	return { suppliers: results };
};

export const actions: Actions = {
	add: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const name = (form.get('name') ?? '').toString().trim();
		if (!name) return fail(400, { addError: 'Supplier name is required.' });
		const kind = (form.get('kind') ?? 'alibaba').toString();
		const url = (form.get('url') ?? '').toString().trim() || null;
		const contact = (form.get('contact') ?? '').toString().trim() || null;
		const notes = (form.get('notes') ?? '').toString().trim() || null;
		const isPreferred = form.get('is_preferred') === 'on' ? 1 : 0;

		// Avoid dupes by name (case-insensitive).
		const existing = await db
			.prepare(`SELECT id FROM supplier WHERE LOWER(name) = LOWER(?)`)
			.bind(name)
			.first<{ id: number }>();
		if (existing) {
			return fail(400, { addError: `A supplier named "${name}" already exists.` });
		}

		await db
			.prepare(
				`INSERT INTO supplier (name, kind, url, contact, notes, is_preferred)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.bind(name, kind, url, contact, notes, isPreferred)
			.run();
		throw redirect(303, '/suppliers?added=1');
	},

	togglePreferred: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const id = parseInt((form.get('id') ?? '').toString(), 10);
		if (!Number.isInteger(id)) return fail(400, {});
		await db
			.prepare(
				`UPDATE supplier SET is_preferred = CASE WHEN is_preferred = 1 THEN 0 ELSE 1 END,
				 updated_at = datetime('now') WHERE id = ?`
			)
			.bind(id)
			.run();
		throw redirect(303, '/suppliers');
	}
};
