import type { PageServerLoad } from './$types';
import { getDB } from '$lib/server/db';

/**
 * Dashboard load. One D1 batch for the count tiles + the richer
 * sections (recent items, recent movements, top categories,
 * inventory value, week activity). Everything stays in one round
 * trip so the page paints fast.
 */

interface RecentItem {
	id: number;
	sku: string;
	title: string;
	created_at: string;
	thumb_r2_key: string | null;
	cat_code: string;
	cat_name: string;
}

interface RecentMovement {
	id: number;
	kind: string;
	created_at: string;
	note: string | null;
	quantity: number;
	sku: string;
	title: string;
}

interface CategoryStat {
	code: string;
	name: string;
	n: number;
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	const [
		itemsCountRes,
		locationsCountRes,
		categoriesCountRes,
		movementsCountRes,
		weekActivityRes,
		onHandQtyRes,
		inventoryValueRes,
		activeCategoriesRes,
		recentItemsRes,
		recentMovementsRes,
		topCategoriesRes
	] = await db.batch([
		// "items on hand" — count of un-retired item rows
		db.prepare(
			`SELECT COUNT(*) AS n FROM item WHERE retired_at IS NULL AND deleted_at IS NULL`
		),
		db.prepare(`SELECT COUNT(*) AS n FROM location WHERE deleted_at IS NULL`),
		db.prepare(`SELECT COUNT(*) AS n FROM category`),
		db.prepare(`SELECT COUNT(*) AS n FROM movement`),

		// Activity in the last 7 days
		db.prepare(
			`SELECT COUNT(*) AS n FROM movement WHERE created_at >= datetime('now', '-7 days')`
		),

		// Sum of stock_qty across stocked items + 1-per-serialized — the
		// "real" count of physical objects on hand, not just rows.
		db.prepare(
			`SELECT COALESCE(SUM(
				CASE WHEN tracking_mode = 'stocked' THEN stock_qty ELSE 1 END
			), 0) AS n
			 FROM item
			 WHERE retired_at IS NULL AND deleted_at IS NULL`
		),

		// Inventory value in cents — price × quantity for stocked,
		// just price for serialized. Items without prices contribute 0.
		db.prepare(
			`SELECT COALESCE(SUM(
				CASE
					WHEN tracking_mode = 'stocked' THEN COALESCE(price_cents, 0) * stock_qty
					ELSE COALESCE(price_cents, 0)
				END
			), 0) AS cents
			 FROM item
			 WHERE retired_at IS NULL AND deleted_at IS NULL`
		),

		// Categories that actually contain something
		db.prepare(
			`SELECT COUNT(DISTINCT i.category_id) AS n
			 FROM item i
			 WHERE i.retired_at IS NULL AND i.deleted_at IS NULL`
		),

		// Recently added items with their first photo + category
		db.prepare(
			`SELECT i.id, i.sku, i.title, i.created_at,
			        c.code AS cat_code, c.name AS cat_name,
			        (SELECT r2_key FROM item_photo
			         WHERE item_id = i.id AND deleted_at IS NULL
			         ORDER BY position, id LIMIT 1) AS thumb_r2_key
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 WHERE i.deleted_at IS NULL
			 ORDER BY i.created_at DESC
			 LIMIT 6`
		),

		// Recent movements — last 8 with item context
		db.prepare(
			`SELECT m.id, m.kind, m.created_at, m.note, m.quantity,
			        i.sku, i.title
			 FROM movement m
			 JOIN item i ON i.id = m.item_id
			 ORDER BY m.created_at DESC, m.id DESC
			 LIMIT 8`
		),

		// Top categories by item count (only those with items)
		db.prepare(
			`SELECT c.code, c.name,
			        COUNT(CASE WHEN i.retired_at IS NULL AND i.deleted_at IS NULL THEN 1 END) AS n
			 FROM category c
			 LEFT JOIN item i ON i.category_id = c.id
			 GROUP BY c.id, c.code, c.name
			 HAVING n > 0
			 ORDER BY n DESC
			 LIMIT 6`
		)
	]);

	const stats = {
		itemsOnHand: (itemsCountRes.results[0] as { n: number }).n,
		locations: (locationsCountRes.results[0] as { n: number }).n,
		categories: (categoriesCountRes.results[0] as { n: number }).n,
		movements: (movementsCountRes.results[0] as { n: number }).n,
		weekActivity: (weekActivityRes.results[0] as { n: number }).n,
		onHandQty: (onHandQtyRes.results[0] as { n: number }).n,
		inventoryValueCents: (inventoryValueRes.results[0] as { cents: number }).cents,
		activeCategories: (activeCategoriesRes.results[0] as { n: number }).n
	};

	return {
		stats,
		recentItems: recentItemsRes.results as RecentItem[],
		recentMovements: recentMovementsRes.results as RecentMovement[],
		topCategories: topCategoriesRes.results as CategoryStat[]
	};
};
