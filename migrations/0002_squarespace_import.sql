-- 0002_squarespace_import.sql
--
-- Add the columns we need to track which inventory items came from a
-- Squarespace product (and which variant), so the importer is idempotent
-- on re-run and we have the mapping for the eventual two-way sync.
--
-- Also introduce item_photo as a proper one-to-many table — until now
-- the schema implicitly assumed photos lived only on R2 with no DB
-- side-tracking. The Squarespace import is the first thing that
-- actually writes photo rows.

PRAGMA foreign_keys = ON;

-- ---------- item: Squarespace + rich description fields -----------------

-- The Squarespace product UUID + variant UUID. Together they uniquely
-- identify a sellable SKU in SS. We keep both so we can drill back from
-- either direction.
ALTER TABLE item ADD COLUMN squarespace_product_id TEXT;
ALTER TABLE item ADD COLUMN squarespace_variant_id TEXT;

-- The SKU string Squarespace itself uses on the variant. Stored alongside
-- our VIN-style sku for reference — Dad may have curated meaningful SS
-- SKUs over the years that we don't want to lose.
ALTER TABLE item ADD COLUMN squarespace_sku TEXT;

-- Timestamp of the most recent successful sync of this row from
-- Squarespace. NULL means "never imported / hand-entered".
ALTER TABLE item ADD COLUMN squarespace_synced_at TEXT;

-- Squarespace returns descriptions as HTML. We strip that into the
-- existing `description` text column for plain-text display (and any
-- search), and preserve the HTML version here for round-trip / display
-- on the item detail page.
ALTER TABLE item ADD COLUMN description_html TEXT;

CREATE INDEX IF NOT EXISTS idx_item_ss_product ON item(squarespace_product_id);
CREATE INDEX IF NOT EXISTS idx_item_ss_variant ON item(squarespace_variant_id);

-- ---------- item_photo: multi-photo per item -----------------------------

CREATE TABLE item_photo (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL REFERENCES item(id),

  -- R2 object key (relative to the bucket). We use the pattern
  -- `items/<item_id>/<source_id>.<ext>` so an R2 listing is
  -- self-describing.
  r2_key        TEXT    NOT NULL,

  -- The original URL the photo came from. For Squarespace imports this
  -- is the SS CDN URL; for hand-uploaded photos it's null. Keeping it
  -- lets us re-fetch if the R2 copy ever gets corrupted, and lets us
  -- debug "where did this photo come from?".
  source_url    TEXT,

  -- Display order — 0 is the primary photo for this item.
  position      INTEGER NOT NULL DEFAULT 0,

  -- Optional alt text (SS sometimes provides this; we should too for
  -- accessibility once the upload UI exists).
  alt_text      TEXT,

  -- Best-effort metadata for at-a-glance debugging without needing to
  -- fetch the R2 object. Width/height may be null if we didn't probe.
  width         INTEGER,
  height        INTEGER,
  bytes         INTEGER,
  content_type  TEXT,

  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE INDEX idx_item_photo_item ON item_photo(item_id);
CREATE INDEX idx_item_photo_position ON item_photo(item_id, position);
