-- 0014_item_merge.sql
--
-- Add a merge audit field on item so soft-deleted duplicates can
-- point at the item they were folded into. This lets us:
--   - Redirect old URLs / bookmarks at the canonical item.
--   - Surface a "this was merged from <sku>" history note.
--   - Reverse a merge later if Dad changes his mind (the source
--     row is soft-deleted, not hard — its data still exists).
--
-- Photos, movements, and marketplace_listing rows belonging to the
-- duplicate get re-pointed via UPDATE statements at merge time
-- (see the merge action) rather than schema cascades — that gives
-- us per-table conflict handling (e.g. only move a Squarespace
-- listing if the keeper doesn't already have one).
--
-- NULL on every existing row by default — this column only ever
-- gets set by the merge action.

ALTER TABLE item ADD COLUMN merged_into_item_id INTEGER REFERENCES item(id);

-- Speeds up "find items merged into X" queries (history pane).
CREATE INDEX IF NOT EXISTS idx_item_merged_into ON item(merged_into_item_id)
  WHERE merged_into_item_id IS NOT NULL;
