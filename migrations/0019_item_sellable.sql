-- 0019_item_sellable.sql
--
-- "Sellable" flag — the switch that takes an item LIVE.
--
-- When an item is marked sellable, the app treats Squarespace as a
-- mirror of our on-hand truth and keeps it in sync automatically:
--   - change the quantity  → push the new stock to the SS listing
--   - retire the item      → delete the SS listing
-- (See $lib/server/ss_auto_sync.ts for the sync behavior.)
--
-- Default 0 (off) so nothing starts auto-pushing until Dad deliberately
-- flips an item live. Existing items are unaffected on upgrade.

ALTER TABLE item ADD COLUMN sellable INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_item_sellable ON item(sellable);
