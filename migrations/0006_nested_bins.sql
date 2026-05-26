-- 0006_nested_bins.sql
--
-- Self-reference on bin lets us model nested storage:
--   Garage Workshop
--     ↓
--   Main Parts Cabinet         (parent: NULL, root inside the location)
--     ↓
--   Drawer 1                   (parent: Main Parts Cabinet)
--     ↓
--   Bin 3                      (parent: Drawer 1)  ← items can live here
--
-- Items can live in any bin at any depth — no requirement that they
-- only live in leaves. Dad will probably keep specific small parts
-- in leaves and larger overflow in higher-up bins.
--
-- Code uniqueness was already (location_id, code) — that stays. A
-- child bin can have the same `code` as a sibling under a different
-- parent (e.g., Drawer 1 inside Cabinet A, and Drawer 1 inside
-- Cabinet B). If we ever need to enforce uniqueness per-parent the
-- index can tighten.

ALTER TABLE bin ADD COLUMN parent_bin_id INTEGER REFERENCES bin(id);
CREATE INDEX idx_bin_parent ON bin(parent_bin_id);
