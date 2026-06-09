import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/**
 * /suppliers/[id] — one supplier: editable details + preferred toggle,
 * full inbound-order history (documents every order from this seller),
 * and the parts that name this supplier as their preferred source.
 */

interface SupplierRow {
	id: number;
	name: string;
	kind: string | null;
	url: string | null;
	contact: string | null;
	notes: string | null;
	is_preferred: number;
	created_at: string;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const id = parseInt(event.params.id, 10);
	if (!Number.isInteger(id)) throw error(404);

	const supplier = await db
		.prepare(`SELECT * FROM supplier WHERE id = ?`)
		.bind(id)
		.first<SupplierRow>();
	if (!supplier) throw error(404, 'Supplier not found');

	const { results: orders } = await db
		.prepare(
			`SELECT id, supplier_order_ref, status, eta, created_at,
			        (SELECT COUNT(*) FROM inbound_order_line l WHERE l.inbound_order_id = o.id) AS line_count,
			        (SELECT COALESCE(SUM(quantity), 0) FROM inbound_order_line l WHERE l.inbound_order_id = o.id) AS total_qty
			 FROM inbound_order o
			 WHERE o.supplier_id = ?
			 ORDER BY o.created_at DESC`
		)
		.bind(id)
		.all<{
			id: number;
			supplier_order_ref: string | null;
			status: string;
			eta: string | null;
			created_at: string;
			line_count: number;
			total_qty: number;
		}>();

	const { results: parts } = await db
		.prepare(
			`SELECT id, sku, title, stock_qty FROM item
			 WHERE preferred_supplier_id = ? AND deleted_at IS NULL
			 ORDER BY title COLLATE NOCASE`
		)
		.bind(id)
		.all<{ id: number; sku: string; title: string; stock_qty: number }>();

	return { supplier, orders, parts };
};

export const actions: Actions = {
	update: async (event) => {
		const db = getDB(event);
		const id = parseInt(event.params.id, 10);
		const form = await event.request.formData();
		const name = (form.get('name') ?? '').toString().trim();
		if (!name) return fail(400, { editError: 'Name is required.' });
		const kind = (form.get('kind') ?? 'alibaba').toString();
		const url = (form.get('url') ?? '').toString().trim() || null;
		const contact = (form.get('contact') ?? '').toString().trim() || null;
		const notes = (form.get('notes') ?? '').toString().trim() || null;
		const isPreferred = form.get('is_preferred') === 'on' ? 1 : 0;

		await db
			.prepare(
				`UPDATE supplier SET name = ?, kind = ?, url = ?, contact = ?, notes = ?,
				 is_preferred = ?, updated_at = datetime('now') WHERE id = ?`
			)
			.bind(name, kind, url, contact, notes, isPreferred, id)
			.run();
		throw redirect(303, `/suppliers/${id}?saved=1`);
	}
};
