-- 0009_marketplace_listings.sql
--
-- Inventory becomes the source of truth for what Dad sells across
-- marketplaces. One row per (item, platform) — Squarespace is the
-- first integration, eBay / Reverb / Etsy slot in later under the
-- same shape.
--
-- Listing content lives on this table (not on item directly) because
-- marketplace listings often need DIFFERENT text than the internal
-- inventory record — longer SEO-tuned titles, customer-facing
-- descriptions vs technician notes, marketplace-specific tags, etc.
--
-- We backfill from item.squarespace_* columns so the 112 already-
-- imported items each get a 'live' marketplace_listing row. The
-- item.squarespace_* columns stay for now (still useful as a
-- cross-reference); a future migration can deprecate them.

PRAGMA foreign_keys = ON;

CREATE TABLE marketplace_listing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES item(id),

  -- 'squarespace' | 'ebay' | 'reverb' | 'etsy'
  platform TEXT NOT NULL,

  -- =================== Listing content =====================
  -- NULL means "inherit from the item". Storing them explicitly lets
  -- Dad write a marketplace-specific title or richer description
  -- without altering the internal title.
  listing_title             TEXT,
  listing_description_html  TEXT,
  listing_url_slug          TEXT,
  listing_tags_json         TEXT,                  -- JSON array of strings
  listing_price_cents       INTEGER,               -- NULL = inherit item.price_cents
  listing_visible           INTEGER NOT NULL DEFAULT 1,

  -- =================== Platform location ===================
  -- Squarespace storePageId. For eBay this slot reuses for category
  -- ID, for Reverb the listing's category UUID, etc.
  storefront_id             TEXT,

  -- Anything platform-specific that doesn't fit a first-class column
  -- (eBay item specifics, Reverb shipping profiles, Etsy taxonomy IDs).
  platform_extras_json      TEXT,

  -- =================== External linkage ====================
  -- Populated after the first successful push. NULL = not pushed yet.
  external_id               TEXT,
  external_variant_id       TEXT,
  external_url              TEXT,

  -- =================== Lifecycle ==========================
  -- 'draft'  → created here, never pushed
  -- 'ready'  → marked ready by Dad, awaiting push (manual)
  -- 'live'   → pushed to platform, currently active
  -- 'paused' → was live, now hidden (listing_visible=0 last push)
  -- 'error'  → last push attempt failed (see last_sync_error)
  status                    TEXT NOT NULL DEFAULT 'draft',

  last_synced_at            TEXT,
  last_sync_status          TEXT,                   -- 'ok' | 'error' | 'pending'
  last_sync_error           TEXT,

  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (item_id, platform)
);

CREATE INDEX idx_marketplace_listing_item     ON marketplace_listing(item_id);
CREATE INDEX idx_marketplace_listing_platform ON marketplace_listing(platform, external_id);
CREATE INDEX idx_marketplace_listing_status   ON marketplace_listing(platform, status);

-- =====================================================================
-- Backfill from existing Squarespace imports — every item with a
-- squarespace_product_id becomes a 'live' marketplace_listing. Listing
-- content fields stay NULL (= "use the item's values") so we don't
-- duplicate text that nobody's customised yet.
-- =====================================================================

INSERT INTO marketplace_listing (
    item_id, platform, external_id, external_variant_id,
    listing_visible, status, last_synced_at, last_sync_status
)
SELECT id, 'squarespace', squarespace_product_id, squarespace_variant_id,
       1, 'live', squarespace_synced_at, 'ok'
FROM item
WHERE squarespace_product_id IS NOT NULL;
