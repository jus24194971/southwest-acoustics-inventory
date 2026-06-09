-- 0024_dead_listings.sql
--
-- "Dead" listings — the deliberate two-stage teardown.
--
-- During the review wizard, when Dad marks a product "no longer have"
-- (a gone group) or retires an existing item, we DON'T delete anything
-- live right then. We just record the platform listings here as
-- pending-removal. Later he sits down and works the dead-listings page,
-- which actually pushes the deletes to Squarespace + Reverb (eBay classic
-- listings can't be ended via API, so they're flagged 'manual' with a
-- link to end by hand).
--
-- status: pending → removed | failed | manual | dismissed

CREATE TABLE dead_listing (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id       INTEGER REFERENCES reconcile_run(id),
	platform     TEXT NOT NULL,              -- squarespace | reverb | ebay
	external_id  TEXT NOT NULL,              -- product / listing / legacy-item id on that platform
	external_url TEXT,
	title        TEXT,
	item_id      INTEGER REFERENCES item(id),-- null for gone GROUPS (never an item); set for retired items
	source       TEXT,                       -- 'group_gone' | 'item_retired'
	status       TEXT NOT NULL DEFAULT 'pending',
	error        TEXT,
	created_at   TEXT NOT NULL DEFAULT (datetime('now')),
	removed_at   TEXT,
	-- One row per live listing. If the same listing gets queued twice
	-- (e.g. group + item paths), keep the first.
	UNIQUE (platform, external_id)
);

CREATE INDEX idx_dead_listing_status ON dead_listing(status);
