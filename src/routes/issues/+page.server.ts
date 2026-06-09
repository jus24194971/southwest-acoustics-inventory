import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/**
 * Unresolved Issues — a live validation of the shop's data invariants.
 *
 * Every section is computed fresh from the DB on each load, so this is a
 * self-cleaning "to-fix" queue: the moment an item actually satisfies the
 * rule again (merged, switched to stocked, given a description, …) it drops
 * off the list. Green page = every process produced correct data.
 *
 * Nothing here changes data on its own — the one action (switchToStocked)
 * is Dad-triggered per item. Reviewing is deliberate, not automatic.
 */

interface SimpleRow {
	id: number;
	sku: string;
	title: string;
}
interface StockRow extends SimpleRow {
	stock_qty: number;
	cat_code: string;
	cat_name: string;
}
interface DescRow extends SimpleRow {
	on_ss: number;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	// 1) Duplicate Squarespace links — >1 item sharing one SS product.
	const { results: dupeRows } = await db
		.prepare(
			`SELECT ml.external_id AS externalId, i.id, i.sku, i.title
			 FROM marketplace_listing ml
			 JOIN item i ON i.id = ml.item_id
			 WHERE ml.platform = 'squarespace' AND ml.external_id IS NOT NULL
			   AND i.deleted_at IS NULL
			   AND ml.external_id IN (
			     SELECT external_id FROM marketplace_listing
			     WHERE platform = 'squarespace' AND external_id IS NOT NULL
			     GROUP BY external_id HAVING COUNT(*) > 1)
			 ORDER BY ml.external_id, i.id`
		)
		.all<{ externalId: string; id: number; sku: string; title: string }>();
	const dupeGroups: { externalId: string; items: SimpleRow[] }[] = [];
	for (const r of dupeRows) {
		let g = dupeGroups.find((x) => x.externalId === r.externalId);
		if (!g) {
			g = { externalId: r.externalId, items: [] };
			dupeGroups.push(g);
		}
		g.items.push({ id: r.id, sku: r.sku, title: r.title });
	}

	// 2) Stock vs tracking — serialized (one-off) but holding multiple units
	//    (or a negative count). These are the import's mis-flagged consumables.
	const { results: badStock } = await db
		.prepare(
			`SELECT i.id, i.sku, i.title, i.stock_qty, c.code AS cat_code, c.name AS cat_name
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 WHERE i.deleted_at IS NULL AND i.retired_at IS NULL
			   AND (i.stock_qty < 0 OR (i.tracking_mode = 'serialized' AND i.stock_qty NOT IN (0, 1)))
			 ORDER BY i.sku`
		)
		.all<StockRow>();

	// 3) No description (active items).
	const { results: noDesc } = await db
		.prepare(
			`SELECT i.id, i.sku, i.title,
			        (SELECT COUNT(*) FROM marketplace_listing ml
			         WHERE ml.item_id = i.id AND ml.platform = 'squarespace'
			           AND ml.external_id IS NOT NULL) AS on_ss
			 FROM item i
			 WHERE i.deleted_at IS NULL AND i.retired_at IS NULL
			   AND (i.description IS NULL OR TRIM(i.description) = '')
			   AND (i.description_html IS NULL OR TRIM(i.description_html) = '')
			 ORDER BY i.sku`
		)
		.all<DescRow>();

	// 4) Retired but still flagged sellable.
	const { results: retiredSellable } = await db
		.prepare(
			`SELECT id, sku, title FROM item
			 WHERE deleted_at IS NULL AND retired_at IS NOT NULL AND sellable = 1
			 ORDER BY sku`
		)
		.all<SimpleRow>();

	const total =
		dupeGroups.length + badStock.length + noDesc.length + retiredSellable.length;

	return { dupeGroups, badStock, noDesc, retiredSellable, total };
};

export const actions: Actions = {
	// Per-item, Dad-triggered: a consumable flagged one-off but holding
	// multiple units → switch to Stocked (keeps the count). Audited via a
	// movement. Nothing here is automatic.
	switchToStocked: async (event) => {
		const db = getDB(event);
		const form = await event.request.formData();
		const itemId = parseInt((form.get('item_id') ?? '').toString(), 10);
		if (!Number.isInteger(itemId)) return fail(400, { error: 'Bad item id.' });
		const item = await db
			.prepare(`SELECT id, stock_qty FROM item WHERE id = ? AND deleted_at IS NULL`)
			.bind(itemId)
			.first<{ id: number; stock_qty: number }>();
		if (!item) throw error(404);
		await db.batch([
			db
				.prepare(`UPDATE item SET tracking_mode = 'stocked', updated_at = datetime('now') WHERE id = ?`)
				.bind(itemId),
			db
				.prepare(`INSERT INTO movement (item_id, kind, note, actor) VALUES (?, 'adjust', ?, ?)`)
				.bind(
					itemId,
					`Tracking changed serialized → stocked (holds ${item.stock_qty}); resolved from Issues`,
					event.locals?.userEmail ?? 'system'
				)
		]);
		throw redirect(303, '/issues?fixed=stocked');
	}
};
