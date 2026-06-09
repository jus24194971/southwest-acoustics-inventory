import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/**
 * /inbound/[id] — inbound order detail.
 *
 * Drives the lifecycle (ordered → in_transit → received), maps each
 * line to an inventory item (with fuzzy suggestions, or a link to
 * create a new one), and receives lines on arrival (+stock, +movement,
 * label link). Receiving the last line flips the order to 'received'.
 */

interface OrderRow {
	id: number;
	supplier: string | null;
	supplier_id: number | null;
	supplier_name: string | null;
	supplier_order_ref: string | null;
	status: string;
	tracking: string | null;
	eta: string | null;
	notes: string | null;
	ordered_at: string | null;
	received_at: string | null;
	created_at: string;
}

interface LineRow {
	id: number;
	description: string;
	quantity: number;
	unit_cost_cents: number | null;
	supplier_sku: string | null;
	item_id: number | null;
	received_qty: number;
	received_at: string | null;
	// joined item (when mapped)
	item_sku: string | null;
	item_title: string | null;
	item_stock_qty: number | null;
	item_preferred_supplier_id: number | null;
}

interface Suggestion {
	id: number;
	sku: string;
	title: string;
}

const NOISE = new Set([
	'the', 'and', 'with', 'for', 'a', 'of', 'in', 'set', 'pcs', 'pc', 'pack',
	'new', 'high', 'quality', 'guitar', 'parts'
]);

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const id = parseInt(event.params.id, 10);
	if (!Number.isInteger(id)) throw error(404);

	const order = await db
		.prepare(
			`SELECT o.*, s.name AS supplier_name
			 FROM inbound_order o
			 LEFT JOIN supplier s ON s.id = o.supplier_id
			 WHERE o.id = ?`
		)
		.bind(id)
		.first<OrderRow>();
	if (!order) throw error(404, 'Inbound order not found');

	const { results: lines } = await db
		.prepare(
			`SELECT l.id, l.description, l.quantity, l.unit_cost_cents, l.supplier_sku,
			        l.item_id, l.received_qty, l.received_at,
			        i.sku AS item_sku, i.title AS item_title, i.stock_qty AS item_stock_qty,
			        i.preferred_supplier_id AS item_preferred_supplier_id
			 FROM inbound_order_line l
			 LEFT JOIN item i ON i.id = l.item_id
			 WHERE l.inbound_order_id = ?
			 ORDER BY l.id`
		)
		.bind(id)
		.all<LineRow>();

	// Fuzzy item suggestions for unmapped lines (by description tokens).
	const suggestions: Record<number, Suggestion[]> = {};
	for (const line of lines) {
		if (line.item_id) continue;
		const tokens = line.description
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.split(/\s+/)
			.filter((t) => t.length >= 3 && !NOISE.has(t))
			.slice(0, 4);
		if (tokens.length === 0) continue;
		const ors = tokens.map(() => 'LOWER(title) LIKE ?').join(' OR ');
		const binds = tokens.map((t) => `%${t}%`);
		const { results } = await db
			.prepare(
				`SELECT id, sku, title FROM item
				 WHERE deleted_at IS NULL AND (${ors})
				 LIMIT 4`
			)
			.bind(...binds)
			.all<Suggestion>();
		if (results.length > 0) suggestions[line.id] = results;
	}

	return { order, lines, suggestions };
};

async function refreshOrderStatus(
	db: ReturnType<typeof getDB>,
	orderId: number
): Promise<void> {
	// If every line is fully received, mark the order received.
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS total,
			        SUM(CASE WHEN received_qty >= quantity AND quantity > 0 THEN 1 ELSE 0 END) AS done
			 FROM inbound_order_line WHERE inbound_order_id = ?`
		)
		.bind(orderId)
		.first<{ total: number; done: number }>();
	if (row && row.total > 0 && row.done === row.total) {
		await db
			.prepare(
				`UPDATE inbound_order
				 SET status = 'received', received_at = COALESCE(received_at, datetime('now')),
				     updated_at = datetime('now')
				 WHERE id = ?`
			)
			.bind(orderId)
			.run();
	}
}

export const actions: Actions = {
	updateOrder: async (event) => {
		const db = getDB(event);
		const id = parseInt(event.params.id, 10);
		const form = await event.request.formData();
		const statusRaw = (form.get('status') ?? 'ordered').toString();
		const status = ['ordered', 'in_transit', 'received', 'canceled'].includes(statusRaw)
			? statusRaw
			: 'ordered';
		const tracking = (form.get('tracking') ?? '').toString().trim() || null;
		const eta = (form.get('eta') ?? '').toString().trim() || null;
		const notes = (form.get('notes') ?? '').toString().trim() || null;

		await db
			.prepare(
				`UPDATE inbound_order
				 SET status = ?, tracking = ?, eta = ?, notes = ?,
				     received_at = CASE WHEN ? = 'received' THEN COALESCE(received_at, datetime('now')) ELSE received_at END,
				     updated_at = datetime('now')
				 WHERE id = ?`
			)
			.bind(status, tracking, eta, notes, status, id)
			.run();
		throw redirect(303, `/inbound/${id}`);
	},

	mapLine: async (event) => {
		const db = getDB(event);
		const id = parseInt(event.params.id, 10);
		const form = await event.request.formData();
		const lineId = parseInt((form.get('line_id') ?? '').toString(), 10);
		if (!Number.isInteger(lineId)) return fail(400, { lineError: 'Bad line.', lineId });

		// Map by explicit item_id (suggestion button) OR by typed SKU.
		let itemId = parseInt((form.get('item_id') ?? '').toString(), 10);
		if (!Number.isInteger(itemId)) {
			const sku = (form.get('sku') ?? '').toString().trim();
			if (!sku) return fail(400, { lineError: 'Pick a suggestion or type a SKU to map.', lineId });
			const it = await db
				.prepare(`SELECT id FROM item WHERE sku = ? AND deleted_at IS NULL`)
				.bind(sku)
				.first<{ id: number }>();
			if (!it) return fail(400, { lineError: `No item with SKU "${sku}".`, lineId });
			itemId = it.id;
		}
		await db
			.prepare(`UPDATE inbound_order_line SET item_id = ? WHERE id = ? AND inbound_order_id = ?`)
			.bind(itemId, lineId, id)
			.run();
		throw redirect(303, `/inbound/${id}`);
	},

	// Set this order's supplier as the preferred reorder source for the
	// line's mapped item. The "mark a part as a preferred supplier" lever.
	setPreferredSupplier: async (event) => {
		const db = getDB(event);
		const id = parseInt(event.params.id, 10);
		const form = await event.request.formData();
		const lineId = parseInt((form.get('line_id') ?? '').toString(), 10);

		const row = await db
			.prepare(
				`SELECT l.item_id, o.supplier_id
				 FROM inbound_order_line l
				 JOIN inbound_order o ON o.id = l.inbound_order_id
				 WHERE l.id = ? AND l.inbound_order_id = ?`
			)
			.bind(lineId, id)
			.first<{ item_id: number | null; supplier_id: number | null }>();
		if (!row?.item_id) {
			return fail(400, { lineError: 'Map this line to an item first.', lineId });
		}
		if (!row.supplier_id) {
			return fail(400, {
				lineError: 'This order has no supplier set — add one in Order details first.',
				lineId
			});
		}
		await db
			.prepare(`UPDATE item SET preferred_supplier_id = ?, updated_at = datetime('now') WHERE id = ?`)
			.bind(row.supplier_id, row.item_id)
			.run();
		throw redirect(303, `/inbound/${id}?prefset=${lineId}`);
	},

	unmapLine: async (event) => {
		const db = getDB(event);
		const id = parseInt(event.params.id, 10);
		const form = await event.request.formData();
		const lineId = parseInt((form.get('line_id') ?? '').toString(), 10);
		await db
			.prepare(`UPDATE inbound_order_line SET item_id = NULL WHERE id = ? AND inbound_order_id = ?`)
			.bind(lineId, id)
			.run();
		throw redirect(303, `/inbound/${id}`);
	},

	receiveLine: async (event) => {
		const db = getDB(event);
		const id = parseInt(event.params.id, 10);
		const form = await event.request.formData();
		const lineId = parseInt((form.get('line_id') ?? '').toString(), 10);

		const line = await db
			.prepare(
				`SELECT l.id, l.quantity, l.received_qty, l.item_id, l.description,
				        i.current_bin_id, i.sku
				 FROM inbound_order_line l
				 LEFT JOIN item i ON i.id = l.item_id
				 WHERE l.id = ? AND l.inbound_order_id = ?`
			)
			.bind(lineId, id)
			.first<{
				id: number;
				quantity: number;
				received_qty: number;
				item_id: number | null;
				description: string;
				current_bin_id: number | null;
				sku: string | null;
			}>();
		if (!line) throw error(404);
		if (!line.item_id) {
			return fail(400, {
				lineError: 'Map this line to an inventory item before receiving.',
				lineId
			});
		}

		const remaining = line.quantity - line.received_qty;
		if (remaining <= 0) {
			// Already fully received — no-op (guards double-clicks).
			throw redirect(303, `/inbound/${id}`);
		}
		const qty = remaining;

		await db.batch([
			db
				.prepare(
					`UPDATE item SET stock_qty = stock_qty + ?, updated_at = datetime('now') WHERE id = ?`
				)
				.bind(qty, line.item_id),
			db
				.prepare(
					`INSERT INTO movement (item_id, kind, from_bin_id, to_bin_id, quantity, note, actor, reference)
					 VALUES (?, 'receive', NULL, ?, ?, ?, 'inbound-receive', ?)`
				)
				.bind(
					line.item_id,
					line.current_bin_id,
					qty,
					`Received from inbound order #${id}: ${line.description}`,
					`inbound:${id}:line:${lineId}`
				),
			db
				.prepare(
					`UPDATE inbound_order_line
					 SET received_qty = received_qty + ?, received_at = datetime('now')
					 WHERE id = ?`
				)
				.bind(qty, lineId)
		]);

		await refreshOrderStatus(db, id);
		throw redirect(303, `/inbound/${id}?received=${lineId}`);
	}
};
