-- 0016_listing_listed_at.sql
--
-- Add a stable "first went live" timestamp to marketplace_listing.
--
-- `last_synced_at` moves on every push, so it answers "when did we
-- last touch this" — NOT "how long has this been listed". The
-- listings dashboard needs the latter to surface stale listings
-- ("what's not selling"), so we stamp listed_at once, the first time
-- a listing reaches 'live', and never move it after.
--
-- Backfill: existing live listings (including the original Squarespace
-- import) get listed_at = their last_synced_at (best available proxy
-- for when they went up), falling back to created_at.

ALTER TABLE marketplace_listing ADD COLUMN listed_at TEXT;

UPDATE marketplace_listing
SET listed_at = COALESCE(last_synced_at, created_at)
WHERE listed_at IS NULL
  AND (status = 'live' OR external_id IS NOT NULL);
