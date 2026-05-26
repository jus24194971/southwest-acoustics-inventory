-- 0005_preferences.sql
--
-- Simple key/value table for app-wide preferences. Cloudflare Access
-- gates the whole app to Justin + Dad, so preferences are app-wide
-- rather than per-user — if that ever needs to change, add an `actor`
-- column and (key, actor) becomes the primary key.
--
-- Seeded with the accessibility prefs ported from Listing Studio
-- (font_scale, high_contrast). The values are TEXT so we can store
-- anything; consumers cast / interpret as needed.

CREATE TABLE preference (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO preference (key, value) VALUES
  ('font_scale',    'normal'),  -- 'normal' | 'large' | 'xlarge'
  ('high_contrast', '0');        -- '0' | '1'
