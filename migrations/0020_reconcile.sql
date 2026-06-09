-- 0020_reconcile.sql
--
-- Cross-platform listing reconciliation (the "go-live onboarding" flow).
--
-- Dad has products listed independently on Squarespace, eBay, and Reverb
-- that were never entered into this system. This staging area holds a
-- full scrape of all three so he can work through them one at a time —
-- confirming what he still has (with a quantity), what's gone, and what's
-- coming back — and we create one unified inventory item per real product
-- and link every platform listing to it.
--
-- These tables are scratch/staging: a run is disposable once Dad has
-- worked through it. We keep them around (not TEMP) so progress survives
-- across sessions — onboarding the whole catalog is a multi-sitting job.

CREATE TABLE reconcile_run (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	status       TEXT NOT NULL DEFAULT 'scraping',  -- scraping | matching | reviewing | done
	ss_count     INTEGER NOT NULL DEFAULT 0,
	ebay_count   INTEGER NOT NULL DEFAULT 0,
	reverb_count INTEGER NOT NULL DEFAULT 0,
	-- Per-platform scrape errors (null = ok). eBay especially may fail to
	-- enumerate web-created listings; we surface that rather than pretend
	-- the catalog is empty.
	ss_error     TEXT,
	ebay_error   TEXT,
	reverb_error TEXT,
	created_at   TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A group = the set of listings Dad treats as ONE product. Decisions are
-- made per group; resolving a group can create + link an inventory item.
-- Created before reconcile_listing so the group_id FK has a parent.
CREATE TABLE reconcile_group (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id       INTEGER NOT NULL REFERENCES reconcile_run(id),
	title        TEXT,                       -- representative title (editable)
	-- Dad's decision:
	--   null       → not reviewed yet
	--   'have'     → currently in stock; item created with a quantity
	--   'future'   → planned, 0 on hand; item created at qty 0
	--   'gone'     → no longer carried; per-listing kept/ended
	--   'skipped'  → already linked / handled, skip
	decision     TEXT,
	item_id      INTEGER REFERENCES item(id),  -- created/linked inventory item
	resolved_at  TEXT,
	created_at   TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_reconcile_group_run ON reconcile_group(run_id);

-- One row per scraped listing across all platforms.
CREATE TABLE reconcile_listing (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id        INTEGER NOT NULL REFERENCES reconcile_run(id),
	platform      TEXT NOT NULL,            -- squarespace | ebay | reverb
	external_id   TEXT NOT NULL,            -- product / item / listing id on that platform
	title         TEXT NOT NULL,
	sku           TEXT,
	price_cents   INTEGER,
	qty           INTEGER,                  -- platform-reported qty, when available
	image_url     TEXT,
	url           TEXT,                     -- public listing URL
	raw_json      TEXT,                     -- full normalized record, for debugging
	-- Match group this listing was clustered into (AI + manual edits).
	group_id      INTEGER REFERENCES reconcile_group(id),
	-- If this listing is ALREADY associated with one of our items
	-- (external_id matches a marketplace_listing / item), we pre-link it
	-- so Dad doesn't re-create a duplicate.
	existing_item_id INTEGER REFERENCES item(id),
	-- For the "no longer have" path, the per-listing choice Dad made:
	--   null      → not yet decided
	--   'kept'    → leave the live listing alone, just untracked
	--   'ended'   → ended/deleted on the platform
	listing_action TEXT,
	created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_reconcile_listing_run ON reconcile_listing(run_id);
CREATE INDEX idx_reconcile_listing_group ON reconcile_listing(group_id);
CREATE INDEX idx_reconcile_listing_ext ON reconcile_listing(platform, external_id);
