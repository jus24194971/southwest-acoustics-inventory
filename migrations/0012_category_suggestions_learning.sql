-- 0012_category_suggestions_learning.sql
--
-- Add a learning table for Squarespace category suggestions. Every
-- time Dad saves or pushes a listing with picked SS sub-shop slugs,
-- we increment a counter keyed on (internal item category, item
-- condition, SS category slug). Over time the table becomes the
-- source of truth for "what does Dad usually pick for this kind of
-- item" — replacing hard-coded rules with learned behavior.
--
-- The suggestion engine in src/lib/server/category_suggestions.ts
-- combines this learned data with rule-based heuristics. Rules give
-- a baseline so the first listing of a new category type still gets
-- sensible defaults; learned counts refine and personalize as Dad
-- uses the system.
--
-- Composite UNIQUE so ON CONFLICT(...) DO UPDATE works for upserts.
-- last_used_at tracks recency so suggestions can weight recent
-- choices more heavily later if we want.

PRAGMA foreign_keys = ON;

CREATE TABLE listing_category_pattern (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Internal category code (PU, BD, LJ, SA, etc.) — uppercase
  item_category_code          TEXT    NOT NULL,
  -- Item condition (N/U/R/B) at the time of the pick. Sub-shop
  -- choices often vary by condition ("on-sale" gets picked more for
  -- R/B than N), so we key on it.
  item_condition              TEXT    NOT NULL,
  -- The SS sub-shop slug that was picked (e.g. "leo-jaymz-guitars",
  -- "on-sale"). Matches values in $lib/squarespace_categories.
  squarespace_category_slug   TEXT    NOT NULL,
  -- Times this (category, condition, slug) tuple has been picked.
  count                       INTEGER NOT NULL DEFAULT 1,
  last_used_at                TEXT    NOT NULL DEFAULT (datetime('now')),

  UNIQUE (item_category_code, item_condition, squarespace_category_slug)
);

CREATE INDEX idx_lcp_lookup ON listing_category_pattern(item_category_code, item_condition);
