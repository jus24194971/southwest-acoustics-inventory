import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/**
 * POST /api/scan  { sku, mode, qty?, note? }
 *
 * Single endpoint behind the /scan page; mode tells us what to do.
 *
 *   lookup → just resolve the SKU to an item; no side effects.
 *   out    → decrement stocked stock_qty by qty (default 1), or retire a
 *            serialized item with a 'sale' movement.
 *   in     → increment stocked stock_qty by qty. Serialized items reject
 *            (use /labels to receive new individually-tracked stock).
 *   build  → log a 'build_consume' movement; decrements stocked or
 *            retires serialized with reason='used_in_build'. Optional
 *            note carries the build reference until we wire a real BOM.
 *
 * Returns the post-action item snapshot + a short message for the
 * scan log on the client.
 */

interface ScanRequest {
	sku?: string;
	mode?: 'lookup' | 'out' | 'in' | 'build';
	qty?: number;
	note?: string;
}

interface ItemSnapshot {
	id: number;
	sku: string;
	title: string;
	tracking_mode: 'serialized' | 'stocked';
	stock_qty: number;
	retired_at: string | null;
	cat_code: string;
	cat_name: string;
	bin_code: string | null;
	loc_code: string | null;
}

export const POST: RequestHandler = async (event) => {
	let body: ScanRequest;
	try {
		body = (await event.request.json()) as ScanRequest;
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const sku = (body.sku ?? '').trim().toUpperCase();
	const mode = body.mode ?? 'lookup';
	const qty = Math.max(1, body.qty ?? 1);
	const note = (body.note ?? '').trim() || null;

	if (!sku) throw error(400, 'sku required');
	if (!['lookup', 'out', 'in', 'build'].includes(mode)) {
		throw error(400, 'mode must be lookup / out / in / build');
	}

	const db = getDB(event);
	const actor = event.locals?.userEmail ?? 'system';

	// Resolve the SKU. Recursive CTE on bin so we get the path for
	// nicer display in the scan log.
	const item = await db
		.prepare(
			`SELECT i.id, i.sku, i.title, i.tracking_mode, i.stock_qty,
			        i.retired_at, i.current_bin_id,
			        c.code AS cat_code, c.name AS cat_name,
			        b.code AS bin_code, loc.code AS loc_code
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 LEFT JOIN bin b ON b.id = i.current_bin_id
			 LEFT JOIN location loc ON loc.id = b.location_id
			 WHERE i.sku = ? AND i.deleted_at IS NULL`
		)
		.bind(sku)
		.first<ItemSnapshot & { current_bin_id: number | null }>();
	if (!item) throw error(404, `SKU not found: ${sku}`);

	if (mode === 'lookup') {
		return json({ ok: true, item, message: 'Lookup' });
	}

	if (item.retired_at) {
		throw error(400, `Item is already retired (${item.retired_at})`);
	}

	// ---- mutating modes ----------------------------------------------

	if (mode === 'in') {
		if (item.tracking_mode !== 'stocked') {
			throw error(
				400,
				'Scan-in only applies to stocked items. Use the Labels page to receive new serialized items.'
			);
		}
		await db.batch([
			db
				.prepare(
					`UPDATE item SET stock_qty = stock_qty + ?, updated_at = datetime('now') WHERE id = ?`
				)
				.bind(qty, item.id),
			db
				.prepare(
					`INSERT INTO movement (item_id, kind, to_bin_id, quantity, note, actor)
					 VALUES (?, 'receive', ?, ?, ?, ?)`
				)
				.bind(item.id, item.current_bin_id, qty, note ?? 'Scan in', actor)
		]);

		const refreshed = await refreshSnapshot(db, item.id);
		return json({
			ok: true,
			item: refreshed,
			message: `+${qty} → ${refreshed.stock_qty}`
		});
	}

	if (mode === 'out' || mode === 'build') {
		const movementKind = mode === 'build' ? 'build_consume' : 'sale';
		const retiredReason = mode === 'build' ? 'used_in_build' : 'sold';

		if (item.tracking_mode === 'stocked') {
			if (item.stock_qty < qty) {
				throw error(400, `Only ${item.stock_qty} on hand — can't take ${qty}.`);
			}
			const newQty = item.stock_qty - qty;
			const ops = [
				db
					.prepare(
						`UPDATE item SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?`
					)
					.bind(newQty, item.id),
				db
					.prepare(
						`INSERT INTO movement (item_id, kind, from_bin_id, quantity, note, actor)
						 VALUES (?, ?, ?, ?, ?, ?)`
					)
					.bind(item.id, movementKind, item.current_bin_id, qty, note, actor)
			];
			// If the stocked pile just hit zero, mark the row retired so it
			// drops out of "on hand" rollups. Dad can resurrect via the
			// detail page's unretire if more come in.
			if (newQty === 0) {
				ops.push(
					db
						.prepare(
							`UPDATE item SET retired_at = datetime('now'), retired_reason = ?
							 WHERE id = ?`
						)
						.bind(retiredReason, item.id)
				);
			}
			await db.batch(ops);

			const refreshed = await refreshSnapshot(db, item.id);
			return json({
				ok: true,
				item: refreshed,
				message: `−${qty} → ${refreshed.stock_qty}${newQty === 0 ? ' (now retired)' : ''}`
			});
		} else {
			// Serialized — retire the one row, log the movement.
			await db.batch([
				db
					.prepare(
						`INSERT INTO movement (item_id, kind, from_bin_id, quantity, note, actor)
						 VALUES (?, ?, ?, 1, ?, ?)`
					)
					.bind(item.id, movementKind, item.current_bin_id, note, actor),
				db
					.prepare(
						`UPDATE item
						 SET retired_at = datetime('now'), retired_reason = ?,
						     current_bin_id = NULL, updated_at = datetime('now')
						 WHERE id = ?`
					)
					.bind(retiredReason, item.id)
			]);

			const refreshed = await refreshSnapshot(db, item.id);
			return json({
				ok: true,
				item: refreshed,
				message: mode === 'build' ? 'Consumed in build' : 'Sold / out'
			});
		}
	}

	throw error(400, `Unhandled mode: ${mode}`);
};

async function refreshSnapshot(
	db: ReturnType<typeof getDB>,
	id: number
): Promise<ItemSnapshot> {
	const row = await db
		.prepare(
			`SELECT i.id, i.sku, i.title, i.tracking_mode, i.stock_qty, i.retired_at,
			        c.code AS cat_code, c.name AS cat_name,
			        b.code AS bin_code, loc.code AS loc_code
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 LEFT JOIN bin b ON b.id = i.current_bin_id
			 LEFT JOIN location loc ON loc.id = b.location_id
			 WHERE i.id = ?`
		)
		.bind(id)
		.first<ItemSnapshot>();
	if (!row) throw error(500, 'Item disappeared mid-update');
	return row;
}
