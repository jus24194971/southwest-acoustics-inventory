-- 0001_init.sql — core inventory schema, v1.
--
-- Design notes:
--
-- * Stock-on-hand is NEVER stored. It's derived from the `movement` ledger
--   so the audit trail can never disagree with the count. Every receive,
--   sale, transfer, scrap, or build-consume is one row in `movement`.
--
-- * Items live in exactly one bin at a time, but the source of truth for
--   "where is item X right now" is the latest movement row for that item.
--   The `item.current_bin_id` column is a denormalized cache, refreshed on
--   every movement insert (see app-side helpers).
--
-- * SKUs use a VIN-style 6-segment scheme: CAT-BRAND-MODEL-COND-YY-SEQ
--   (e.g. PU-SEY-JBJ-U-25-0017). The sequence is allocated per (category,
--   year) pair via `sku_sequence`.
--
-- * Soft delete via `deleted_at` rather than DELETE — we never lose
--   history. Listings, reports, and Squarespace sync can filter on it.

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------
-- Locations + bins
-- -----------------------------------------------------------------------

CREATE TABLE location (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,           -- short code, e.g. 'GAR', 'WHS'
  name          TEXT    NOT NULL,                  -- 'Garage Workshop'
  address       TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE TABLE bin (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id   INTEGER NOT NULL REFERENCES location(id),
  code          TEXT    NOT NULL,                  -- 'A-12', 'SHELF-3', etc.
  name          TEXT,                              -- optional friendly name
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT,
  UNIQUE (location_id, code)
);

-- -----------------------------------------------------------------------
-- Categories + brands — small lookup tables we expand over time.
-- Kept simple: free-text plus a stable code used in the SKU.
-- -----------------------------------------------------------------------

CREATE TABLE category (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,           -- 2 chars, used in SKU: BD, NK, PU, ...
  name          TEXT    NOT NULL,
  description   TEXT,
  -- Whether items in this category should sync to Squarespace by default.
  syncs_to_squarespace INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE brand (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,           -- 3 chars, used in SKU: FEN, SEY, GIB, ...
  name          TEXT    NOT NULL
);

-- -----------------------------------------------------------------------
-- Items
-- -----------------------------------------------------------------------

CREATE TABLE item (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sku             TEXT    NOT NULL UNIQUE,         -- VIN-style, e.g. 'PU-SEY-JBJ-U-25-0017'
  title           TEXT    NOT NULL,                -- 'Seymour Duncan JB Jr pickup, neck position'
  description     TEXT,

  category_id     INTEGER NOT NULL REFERENCES category(id),
  brand_id        INTEGER          REFERENCES brand(id),
  model           TEXT,                            -- free-text model/variant
  condition       TEXT    NOT NULL,                -- 'N','U','R','B'  (new/used/refurb/broken-for-parts)
  year_received   INTEGER NOT NULL,                -- 4-digit, e.g. 2025

  -- Cost basis. Stored in cents to dodge floating-point pain.
  cost_cents      INTEGER,
  -- The current ask price, also in cents. Listing exports read this.
  price_cents     INTEGER,

  -- Denormalized "where is it now" cache. Trusted but refreshed from
  -- the movement ledger on every change.
  current_bin_id  INTEGER REFERENCES bin(id),

  -- Set when the item is sold/scrapped/used in a build. Stays non-null
  -- after that. Stock-on-hand reports filter on this.
  retired_at      TEXT,
  retired_reason  TEXT,                            -- 'sold','scrap','used_in_build', ...

  -- Soft-delete (data-entry mistakes only).
  deleted_at      TEXT,

  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_item_sku            ON item(sku);
CREATE INDEX idx_item_category       ON item(category_id);
CREATE INDEX idx_item_brand          ON item(brand_id);
CREATE INDEX idx_item_current_bin    ON item(current_bin_id);
CREATE INDEX idx_item_retired        ON item(retired_at);

-- -----------------------------------------------------------------------
-- Movement ledger — append-only, the single source of truth for stock.
-- -----------------------------------------------------------------------

CREATE TABLE movement (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id         INTEGER NOT NULL REFERENCES item(id),
  kind            TEXT    NOT NULL,                -- 'receive','transfer','sale','scrap','adjust','build_consume','build_produce'
  from_bin_id     INTEGER REFERENCES bin(id),      -- null on initial receive
  to_bin_id       INTEGER REFERENCES bin(id),      -- null on sale/scrap
  quantity        INTEGER NOT NULL DEFAULT 1,      -- v1 every item is qty 1; here for future expansion
  note            TEXT,
  reference       TEXT,                            -- free-text link: PO #, order ID, build ID
  actor           TEXT,                            -- who did it (email from CF Access)
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_movement_item       ON movement(item_id);
CREATE INDEX idx_movement_created    ON movement(created_at);

-- -----------------------------------------------------------------------
-- SKU sequence counters — one row per (category, year).
-- -----------------------------------------------------------------------

CREATE TABLE sku_sequence (
  category_code   TEXT    NOT NULL,
  year_yy         INTEGER NOT NULL,                -- 2-digit year, e.g. 25
  next_value      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (category_code, year_yy)
);

-- -----------------------------------------------------------------------
-- Seed data — the two real locations Dad operates from.
-- -----------------------------------------------------------------------

INSERT INTO location (code, name) VALUES
  ('GAR', 'Garage Workshop'),
  ('WHS', 'Storage Warehouse');

-- A handful of starter categories so the Add Item form has something to
-- pick from on first run. Codes feed the SKU prefix.
INSERT INTO category (code, name, syncs_to_squarespace) VALUES
  ('BD', 'Bodies', 1),
  ('NK', 'Necks', 1),
  ('PU', 'Pickups', 1),
  ('HW', 'Hardware', 1),
  ('EL', 'Electronics', 1),
  ('GT', 'Complete Guitars', 1),
  ('LJ', 'Leo Jaymez Builds', 1),
  ('MS', 'Misc / Consumables', 0);
