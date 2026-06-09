import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';
import { resolveSupplierByName } from '$lib/server/suppliers';

/**
 * /inbound/new — create an inbound order.
 *
 * The page handles intake (screenshot upload or pasted text) + AI parse
 * client-side via /api/inbound/parse, then submits the reviewed header
 * + lines here. Lines arrive as a JSON blob in `lines_json` (the line
 * count is dynamic, so a JSON field is cleaner than indexed inputs).
 */

export const load: PageServerLoad = async (event) => {
	return { hasAiKey: !!event.platform?.env?.ANTHROPIC_API_KEY };
};

interface IncomingLine {
	description?: string;
	quantity?: number;
	unitCostCents?: number | null;
	supplierSku?: string | null;
}

export const actions: Actions = {
	create: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();

		const supplier = (form.get('supplier') ?? '').toString().trim() || null;
		const orderRef = (form.get('supplier_order_ref') ?? '').toString().trim() || null;
		const statusRaw = (form.get('status') ?? 'ordered').toString();
		const status = ['ordered', 'in_transit', 'received', 'canceled'].includes(statusRaw)
			? statusRaw
			: 'ordered';
		const tracking = (form.get('tracking') ?? '').toString().trim() || null;
		const eta = (form.get('eta') ?? '').toString().trim() || null;
		const notes = (form.get('notes') ?? '').toString().trim() || null;
		const orderedAt = (form.get('ordered_at') ?? '').toString().trim() || null;

		let lines: IncomingLine[] = [];
		try {
			lines = JSON.parse((form.get('lines_json') ?? '[]').toString()) as IncomingLine[];
		} catch {
			return fail(400, { createError: 'Could not read the line items.' });
		}
		const cleanLines = lines
			.map((l) => ({
				description: (l.description ?? '').toString().trim(),
				quantity:
					typeof l.quantity === 'number' && l.quantity > 0 ? Math.round(l.quantity) : 1,
				unitCostCents:
					typeof l.unitCostCents === 'number' && l.unitCostCents >= 0
						? Math.round(l.unitCostCents)
						: null,
				supplierSku: l.supplierSku ? l.supplierSku.toString().trim() : null
			}))
			.filter((l) => l.description.length > 0);

		if (cleanLines.length === 0) {
			return fail(400, { createError: 'Add at least one line item before saving.' });
		}

		// Link to a supplier record (find-or-create by name) so the order
		// is documented against a seller.
		const supplierId = supplier ? await resolveSupplierByName(db, supplier) : null;

		const orderRes = await db
			.prepare(
				`INSERT INTO inbound_order (supplier, supplier_id, supplier_order_ref, status, tracking, eta, notes, ordered_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(supplier, supplierId, orderRef, status, tracking, eta, notes, orderedAt)
			.run();
		const orderId = orderRes.meta.last_row_id as number;

		// Insert lines in one batch.
		await db.batch(
			cleanLines.map((l) =>
				db
					.prepare(
						`INSERT INTO inbound_order_line
						 (inbound_order_id, description, quantity, unit_cost_cents, supplier_sku)
						 VALUES (?, ?, ?, ?, ?)`
					)
					.bind(orderId, l.description, l.quantity, l.unitCostCents, l.supplierSku)
			)
		);

		throw redirect(303, `/inbound/${orderId}?created=1`);
	}
};
