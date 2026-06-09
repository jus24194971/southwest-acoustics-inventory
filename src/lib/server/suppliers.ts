/**
 * Supplier helpers. Suppliers are the sellers Dad buys parts from
 * (mostly Alibaba). Every inbound order links to one so the order
 * history is documented per seller, and parts can carry a preferred
 * supplier for easy reordering.
 */

import type { D1Database } from '@cloudflare/workers-types';

/**
 * Find a supplier by (case-insensitive) name, creating it if absent.
 * Returns the supplier id. Used when an inbound order is created/edited
 * with a free-text supplier name so the order auto-links to a record.
 */
export async function resolveSupplierByName(
	db: D1Database,
	name: string,
	kind: string = 'alibaba'
): Promise<number | null> {
	const trimmed = name.trim();
	if (!trimmed) return null;

	const existing = await db
		.prepare(`SELECT id FROM supplier WHERE LOWER(name) = LOWER(?) LIMIT 1`)
		.bind(trimmed)
		.first<{ id: number }>();
	if (existing) return existing.id;

	const res = await db
		.prepare(`INSERT INTO supplier (name, kind) VALUES (?, ?)`)
		.bind(trimmed, kind)
		.run();
	return res.meta.last_row_id as number;
}
