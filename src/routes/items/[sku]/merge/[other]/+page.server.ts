import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDB } from '$lib/server/db';

/**
 * /items/[sku]/merge/[other] — merge preview + confirm.
 *
 * `sku`   = the keeper (data survives, this URL stays canonical).
 * `other` = the duplicate (gets soft-deleted and re-pointed at keeper).
 *
 * Load shows a side-by-side comparison + a "this is what will move"
 * summary so Dad can sanity-check before pulling the trigger.
 * Confirm action does the merge in a single batched transaction.
 *
 * Merge semantics:
 *   - Photos:      duplicate.item_photo rows re-pointed to keeper.id,
 *                  positions shifted to start after keeper's current max.
 *   - Movements:   duplicate.movement rows re-pointed to keeper.id.
 *                  A new 'adjust' movement is written on keeper noting
 *                  the absorption for the audit trail.
 *   - Listings:    each platform's marketplace_listing for the duplicate
 *                  is moved to keeper IFF keeper doesn't already have
 *                  one for that platform. If keeper already has one,
 *                  the duplicate's row is kept on the (soon-to-be-soft-
 *                  deleted) duplicate — accessible via merged_into for
 *                  later inspection but not re-pointed.
 *   - Stock qty:   summed onto keeper (with tracking-mode promotion
 *                  to 'stocked' if the sum exceeds 1 on a serialized
 *                  keeper — same rule as the manual Adjust action).
 *   - Duplicate:   deleted_at = now, merged_into_item_id = keeper.id.
 *                  All original data still readable via direct id
 *                  lookup; deleted_at hides it from list/search.
 */

interface ItemSnapshot {
	id: number;
	sku: string;
	title: string;
	condition: string;
	category_id: number;
	stock_qty: number;
	tracking_mode: 'serialized' | 'stocked';
	price_cents: number | null;
	current_bin_id: number | null;
	category_name: string;
	cat_code: string;
	brand_name: string | null;
	model: string | null;
	retired_at: string | null;
	created_at: string;
	updated_at: string;
}

interface MergePlan {
	photosToMove: number;
	movementsToMove: number;
	listingsToMove: Array<{ platform: string; status: string; external_id: string | null }>;
	listingsToOrphan: Array<{ platform: string; status: string; external_id: string | null }>;
	finalQty: number;
	willPromoteToStocked: boolean;
}

async function loadItem(
	db: ReturnType<typeof getDB>,
	sku: string
): Promise<ItemSnapshot | null> {
	return await db
		.prepare(
			`SELECT i.id, i.sku, i.title, i.condition, i.category_id,
			        i.stock_qty, i.tracking_mode, i.price_cents, i.current_bin_id,
			        i.retired_at, i.created_at, i.updated_at, i.model,
			        c.name AS category_name, c.code AS cat_code,
			        b.name AS brand_name
			 FROM item i
			 JOIN category c ON c.id = i.category_id
			 LEFT JOIN brand b ON b.id = i.brand_id
			 WHERE i.sku = ? AND i.deleted_at IS NULL`
		)
		.bind(sku)
		.first<ItemSnapshot>();
}

async function computeMergePlan(
	db: ReturnType<typeof getDB>,
	keeper: ItemSnapshot,
	duplicate: ItemSnapshot
): Promise<MergePlan> {
	const photoRow = await db
		.prepare(
			`SELECT COUNT(*) AS n FROM item_photo WHERE item_id = ? AND deleted_at IS NULL`
		)
		.bind(duplicate.id)
		.first<{ n: number }>();
	const movementRow = await db
		.prepare(`SELECT COUNT(*) AS n FROM movement WHERE item_id = ?`)
		.bind(duplicate.id)
		.first<{ n: number }>();

	// Listings: walk both sides and decide which move, which orphan.
	const keeperListings = await db
		.prepare(
			`SELECT platform FROM marketplace_listing WHERE item_id = ?`
		)
		.bind(keeper.id)
		.all<{ platform: string }>();
	const keeperPlatforms = new Set(keeperListings.results.map((r) => r.platform));

	const dupListings = await db
		.prepare(
			`SELECT platform, status, external_id FROM marketplace_listing WHERE item_id = ?`
		)
		.bind(duplicate.id)
		.all<{ platform: string; status: string; external_id: string | null }>();

	const listingsToMove: MergePlan['listingsToMove'] = [];
	const listingsToOrphan: MergePlan['listingsToOrphan'] = [];
	for (const l of dupListings.results) {
		if (keeperPlatforms.has(l.platform)) {
			listingsToOrphan.push(l);
		} else {
			listingsToMove.push(l);
		}
	}

	const finalQty = keeper.stock_qty + duplicate.stock_qty;
	const willPromoteToStocked =
		keeper.tracking_mode === 'serialized' && finalQty > 1;

	return {
		photosToMove: photoRow?.n ?? 0,
		movementsToMove: movementRow?.n ?? 0,
		listingsToMove,
		listingsToOrphan,
		finalQty,
		willPromoteToStocked
	};
}

export const load: PageServerLoad = async (event) => {
	const db = getDB(event);

	const keeper = await loadItem(db, event.params.sku);
	if (!keeper) throw error(404, `No keeper item ${event.params.sku}`);
	const duplicate = await loadItem(db, event.params.other);
	if (!duplicate) throw error(404, `No duplicate item ${event.params.other}`);
	if (keeper.id === duplicate.id) {
		throw error(400, 'Cannot merge an item with itself.');
	}

	const plan = await computeMergePlan(db, keeper, duplicate);

	return { keeper, duplicate, plan };
};

export const actions: Actions = {
	confirm: async (event) => {
		const db = getDB(event);

		const keeper = await loadItem(db, event.params.sku);
		if (!keeper) throw error(404);
		const duplicate = await loadItem(db, event.params.other);
		if (!duplicate) throw error(404);
		if (keeper.id === duplicate.id) {
			return fail(400, { mergeError: 'Cannot merge an item with itself.' });
		}

		const form = await event.request.formData();
		// Safety: the form must echo back the duplicate's SKU so a stray
		// click can't fire a different merge by URL alone.
		const confirmedSku = (form.get('confirm_sku') ?? '').toString().trim();
		if (confirmedSku !== duplicate.sku) {
			return fail(400, {
				mergeError:
					'Confirmation SKU did not match. Type the duplicate SKU exactly to confirm.'
			});
		}

		const plan = await computeMergePlan(db, keeper, duplicate);

		// Find the next photo position on the keeper so duplicate's
		// photos slot in cleanly at the end. (Photos render in
		// position-asc order; mixing positions would scramble them.)
		const maxPosRow = await db
			.prepare(
				`SELECT COALESCE(MAX(position), -1) AS max_pos
				 FROM item_photo
				 WHERE item_id = ? AND deleted_at IS NULL`
			)
			.bind(keeper.id)
			.first<{ max_pos: number }>();
		const positionOffset = (maxPosRow?.max_pos ?? -1) + 1;

		// Compose every UPDATE/INSERT into a single batch. D1's batch is
		// not a true transaction in the SQL sense — failures of
		// individual statements don't roll back earlier ones — but it
		// is atomic per-statement and runs serially. We order so the
		// re-pointers happen BEFORE the soft-delete of the duplicate;
		// if the batch fails mid-way, the duplicate stays visible so
		// Dad can inspect.
		const ops = [
			// Photos: re-point + shift position. The UPDATE uses
			// item_photo.position + ? (the offset) so order is
			// preserved within the duplicate's gallery.
			db
				.prepare(
					`UPDATE item_photo
					 SET item_id = ?, position = position + ?
					 WHERE item_id = ? AND deleted_at IS NULL`
				)
				.bind(keeper.id, positionOffset, duplicate.id),
			// Movements: re-point all of them. The historical bin
			// references stay as-is — they represent where things
			// actually happened, not where they currently are.
			db
				.prepare(`UPDATE movement SET item_id = ? WHERE item_id = ?`)
				.bind(keeper.id, duplicate.id)
		];

		// Listings: only move the platforms the keeper doesn't already
		// have. The DB has a UNIQUE(item_id, platform) so re-pointing
		// a duplicate's row to a platform the keeper already covers
		// would fail. We filter explicitly here for clarity.
		for (const l of plan.listingsToMove) {
			ops.push(
				db
					.prepare(
						`UPDATE marketplace_listing
						 SET item_id = ?, updated_at = datetime('now')
						 WHERE item_id = ? AND platform = ?`
					)
					.bind(keeper.id, duplicate.id, l.platform)
			);
		}

		// Write an audit movement on the keeper noting the absorption.
		// Quantity = duplicate.stock_qty so the ledger column matches
		// the actual stock that joined the keeper.
		const orphanCount = plan.listingsToOrphan.length;
		const orphanSuffix =
			orphanCount > 0
				? ` · ${orphanCount} listing(s) left on the duplicate (keeper already had ${plan.listingsToOrphan.map((l) => l.platform).join(', ')})`
				: '';
		const absorbNote =
			`Absorbed from ${duplicate.sku} (${duplicate.title}) — ` +
			`+${duplicate.stock_qty} qty, ${plan.photosToMove} photo(s), ${plan.movementsToMove} movement(s), ${plan.listingsToMove.length} listing(s) moved${orphanSuffix}`;
		ops.push(
			db
				.prepare(
					`INSERT INTO movement (item_id, kind, from_bin_id, to_bin_id, quantity, note, actor)
					 VALUES (?, 'adjust', NULL, ?, ?, ?, ?)`
				)
				.bind(
					keeper.id,
					keeper.current_bin_id,
					duplicate.stock_qty,
					absorbNote,
					event.locals?.userEmail ?? 'system'
				)
		);

		// Bump keeper's qty + possibly promote to stocked. Mirrors the
		// auto-promote rule from the manual Adjust action.
		if (plan.willPromoteToStocked) {
			ops.push(
				db
					.prepare(
						`UPDATE item
						 SET stock_qty = ?,
						     tracking_mode = 'stocked',
						     updated_at = datetime('now')
						 WHERE id = ?`
					)
					.bind(plan.finalQty, keeper.id)
			);
		} else {
			ops.push(
				db
					.prepare(
						`UPDATE item SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?`
					)
					.bind(plan.finalQty, keeper.id)
			);
		}

		// Soft-delete the duplicate with the merge reference. We keep
		// its title + photos + listings rows around so a direct id
		// lookup still reads everything — useful for inspecting an old
		// state or unwinding a bad merge.
		ops.push(
			db
				.prepare(
					`UPDATE item
					 SET deleted_at = datetime('now'),
					     merged_into_item_id = ?,
					     updated_at = datetime('now')
					 WHERE id = ?`
				)
				.bind(keeper.id, duplicate.id)
		);

		await db.batch(ops);

		throw redirect(
			303,
			`/items/${encodeURIComponent(keeper.sku)}?merged_from=${encodeURIComponent(duplicate.sku)}`
		);
	}
};
