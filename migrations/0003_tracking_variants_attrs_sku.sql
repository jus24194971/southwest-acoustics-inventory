-- 0003_tracking_variants_attrs_sku.sql
--
-- The big design pass after the bootstrap import. Captures four
-- interrelated decisions (see inventory-sku-and-labels memory):
--
--   1. Tracking modes — serialized vs stocked items
--   2. Variants — child items grouped under a parent "part" row
--   3. 5-slot attribute schema embedded in the SKU (40-char canonical
--      format), with category-specific labels
--   4. Hierarchical categories + new SA (Southwest Acoustics builds)
--      category for Dad's own custom guitars
--
-- Plus a label_template table to drive the eventual print-UI selector,
-- seeded with the 19×64mm label Dad already owns + future-buy options.
--
-- All existing items are backfilled: SKUs grow from 21 chars to 40 chars
-- (appending -XXX-XXX-XXX-XXX-XXX), tracking_mode defaults to 'serialized'
-- (matching the pre-migration behaviour), and stock_qty defaults to 1.

PRAGMA foreign_keys = ON;

-- ============================================================
-- item: tracking + variants + 5 attribute slots + richer specs
-- ============================================================

-- serialized = one row per physical object (current behaviour for all
-- 112 SS imports). stocked = one row represents N identical objects,
-- counted via stock_qty. Scan-in/scan-out behaviour branches on this.
ALTER TABLE item ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'serialized';

-- For serialized items: always 1. For stocked items: current on-hand
-- count, updated by movement.quantity deltas. Surfaced on the item list
-- so a "how many do I have" answer is one column away.
ALTER TABLE item ADD COLUMN stock_qty INTEGER NOT NULL DEFAULT 1;

-- Self-reference: parent_item_id groups variants of one "part" together.
-- Parent holds shared metadata (photos, description, base specs);
-- children hold per-variant attributes. NULL = standalone item.
ALTER TABLE item ADD COLUMN parent_item_id INTEGER REFERENCES item(id);
CREATE INDEX idx_item_parent ON item(parent_item_id);

-- Five 3-char attribute slots embedded in the SKU. Meaning is
-- category-specific (see category.attr_N_label columns). Default is
-- the reserved 'XXX' value meaning "no value / not meaningful".
ALTER TABLE item ADD COLUMN attr_1 TEXT NOT NULL DEFAULT 'XXX';
ALTER TABLE item ADD COLUMN attr_2 TEXT NOT NULL DEFAULT 'XXX';
ALTER TABLE item ADD COLUMN attr_3 TEXT NOT NULL DEFAULT 'XXX';
ALTER TABLE item ADD COLUMN attr_4 TEXT NOT NULL DEFAULT 'XXX';
ALTER TABLE item ADD COLUMN attr_5 TEXT NOT NULL DEFAULT 'XXX';

-- When any attr_N is the reserved value 'UNQ' (one-of-a-kind), the
-- matching unique_desc column carries the freeform description that
-- doesn't fit a 3-char code. Used heavily for Leo Jaymez paintwork.
ALTER TABLE item ADD COLUMN attr_1_unique_desc TEXT;
ALTER TABLE item ADD COLUMN attr_2_unique_desc TEXT;
ALTER TABLE item ADD COLUMN attr_3_unique_desc TEXT;
ALTER TABLE item ADD COLUMN attr_4_unique_desc TEXT;
ALTER TABLE item ADD COLUMN attr_5_unique_desc TEXT;

-- Open structured-data column for everything the schema doesn't have a
-- first-class field for: neck profile detail, fret count, bridge type,
-- pickup brands per position, wiring scheme, string gauge, setup notes,
-- LJ refurb log, customer/commission info, etc. SQLite's
-- json_extract() makes this searchable if we ever need to filter on it.
ALTER TABLE item ADD COLUMN attributes_json TEXT;

-- ============================================================
-- category: hierarchy + per-slot attribute labels
-- ============================================================

ALTER TABLE category ADD COLUMN parent_id INTEGER REFERENCES category(id);
CREATE INDEX idx_category_parent ON category(parent_id);

-- What attr_1..attr_5 mean for items in this category. NULL means
-- "this slot is not used for this category" — the UI hides the input
-- and the SKU shows XXX in that position.
ALTER TABLE category ADD COLUMN attr_1_label TEXT;
ALTER TABLE category ADD COLUMN attr_2_label TEXT;
ALTER TABLE category ADD COLUMN attr_3_label TEXT;
ALTER TABLE category ADD COLUMN attr_4_label TEXT;
ALTER TABLE category ADD COLUMN attr_5_label TEXT;

-- ============================================================
-- New SA category (Southwest Acoustics builds — Dad's own customs)
-- ============================================================

INSERT INTO category (code, name, syncs_to_squarespace,
  attr_1_label, attr_2_label, attr_3_label, attr_4_label, attr_5_label) VALUES
  ('SA', 'Southwest Acoustics Builds', 1,
   'Body finish', 'Hardware finish', 'Pickup config', 'Wiring scheme', 'Build variant');

-- ============================================================
-- Seed attribute labels for the 8 existing categories
-- ============================================================

UPDATE category
   SET attr_1_label = 'Color',
       attr_2_label = 'Finish type',
       attr_3_label = 'Wood',
       attr_4_label = 'Construction',
       attr_5_label = 'Pickguard'
 WHERE code = 'BD';

UPDATE category
   SET attr_1_label = 'Neck wood',
       attr_2_label = 'Fretboard',
       attr_3_label = 'Profile',
       attr_4_label = 'Radius',
       attr_5_label = 'Frets'
 WHERE code = 'NK';

UPDATE category
   SET attr_1_label = 'Type',
       attr_2_label = 'Position',
       attr_3_label = 'Brand',
       attr_4_label = 'Output',
       attr_5_label = 'Active/passive'
 WHERE code = 'PU';

UPDATE category
   SET attr_1_label = 'Type',
       attr_2_label = 'Color',
       attr_3_label = 'Sub-variant'
 WHERE code = 'HW';

UPDATE category
   SET attr_1_label = 'Component',
       attr_2_label = 'Value/spec',
       attr_3_label = 'Variant'
 WHERE code = 'EL';

-- GT and LJ use the same attribute layout as SA (complete guitars,
-- whether built by Dad, by Leo Jaymez, or stocked).
UPDATE category
   SET attr_1_label = 'Body finish',
       attr_2_label = 'Hardware finish',
       attr_3_label = 'Pickup config',
       attr_4_label = 'Wiring scheme',
       attr_5_label = 'Build variant'
 WHERE code IN ('GT', 'LJ');

-- MS stays attribute-less for now — it's the catch-all Dad will
-- re-categorise out of.

-- ============================================================
-- label_template: print-time geometry (mm), seeded with Dad's current
-- DYMO label + the ones he plans to buy + a couple more in case.
-- ============================================================

CREATE TABLE label_template (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL,
  width_mm      REAL    NOT NULL,   -- the long edge of the label
  height_mm     REAL    NOT NULL,   -- the short edge
  is_default    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1
);

INSERT INTO label_template (code, display_name, width_mm, height_mm, is_default) VALUES
  ('LW_DURABLE_19x64', 'DYMO LW Durable 19×64mm (NA 1933085) — current',     64.0, 19.0, 1),
  ('DYMO_30334',       'DYMO 30334 Multi-Purpose 57×32mm (2.25″ × 1.25″)',   57.15, 31.75, 0),
  ('DYMO_30330',       'DYMO 30330 File Folder 51×19mm (3/4″ × 2″)',         50.8, 19.0, 0),
  ('DYMO_30252',       'DYMO 30252 Address 89×28mm (1.125″ × 3.5″)',         88.9, 28.6, 0);

-- ============================================================
-- Backfill existing SKUs to the new 40-character format
-- ============================================================
--
-- Existing SKUs from the SS import are 21 chars (CAT-BRAND-MODEL-COND-YY-SEQ).
-- The new format is 40 chars with five 3-char attribute slots. Append
-- -XXX-XXX-XXX-XXX-XXX to every 21-char SKU so existing items conform
-- without losing uniqueness.

UPDATE item SET sku = sku || '-XXX-XXX-XXX-XXX-XXX' WHERE LENGTH(sku) = 21;
