import type { PageServerLoad } from './$types';
import { getDB } from '$lib/server/db';

/**
 * /inbound — list of inbound (purchase) orders, newest first, with a
 * line count + how many lines are received so Dad can see at a glance
 * what's on the water vs. landed.
 */

interface InboundRow {
	id: number;
	supplier: string | null;
	supplier_order_ref: string | null;
	status: string;
	tracking: string | null;
	eta: string | null;
	ordered_at: string | null;
	created_at: string;
	line_count: number;
	received_lines: number;
	total_qty: number;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);
	const statusFilter = (event.url.searchParams.get('status') ?? '').trim();

	const wheres: string[] = [];
	const binds: unknown[] = [];
	if (['ordered', 'in_transit', 'received', 'canceled'].includes(statusFilter)) {
		wheres.push('o.status = ?');
		binds.push(statusFilter);
	}
	const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

	const { results } = await db
		.prepare(
			`SELECT o.id, o.supplier, o.supplier_order_ref, o.status, o.tracking, o.eta,
			        o.ordered_at, o.created_at,
			        (SELECT COUNT(*) FROM inbound_order_line l WHERE l.inbound_order_id = o.id) AS line_count,
			        (SELECT COUNT(*) FROM inbound_order_line l WHERE l.inbound_order_id = o.id AND l.received_qty >= l.quantity AND l.quantity > 0) AS received_lines,
			        (SELECT COALESCE(SUM(quantity), 0) FROM inbound_order_line l WHERE l.inbound_order_id = o.id) AS total_qty
			 FROM inbound_order o
			 ${whereSql}
			 ORDER BY o.created_at DESC
			 LIMIT 500`
		)
		.bind(...binds)
		.all<InboundRow>();

	// Status counts for the filter chips.
	const { results: counts } = await db
		.prepare(`SELECT status, COUNT(*) AS n FROM inbound_order GROUP BY status`)
		.all<{ status: string; n: number }>();
	const statusCounts: Record<string, number> = {};
	for (const c of counts) statusCounts[c.status] = c.n;

	return { orders: results, filters: { status: statusFilter }, statusCounts };
};
