-- 0022_reconcile_item_review.sql
--
-- The reconciliation wizard isn't only about NEW listings from the
-- scrape — Dad also walks his ENTIRE existing inventory to confirm what
-- he still carries, retire what he never will again, and clear out
-- stuff that's been out of stock and isn't coming back.
--
-- This table marks which existing items he's already reviewed in a given
-- run, so the one-at-a-time wizard never shows the same item twice and
-- can show progress. (Retiring an item also drops it from the queue via
-- retired_at; this table additionally records the 'keep' / 'skip'
-- decisions that leave the item active.)

CREATE TABLE reconcile_item_review (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id     INTEGER NOT NULL REFERENCES reconcile_run(id),
	item_id    INTEGER NOT NULL REFERENCES item(id),
	decision   TEXT,                         -- 'keep' | 'retired' | 'skip'
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE (run_id, item_id)
);

CREATE INDEX idx_reconcile_item_review_run ON reconcile_item_review(run_id);
