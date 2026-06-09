-- 0015_app_secret.sql
--
-- A tiny key/value store for secrets minted at RUNTIME, which can't
-- live in Cloudflare Pages secrets (those are write-only via wrangler
-- at deploy time — a Worker can't set one mid-request).
--
-- The eBay OAuth refresh token is the first tenant: it's produced when
-- Dad clicks "Connect eBay" and the callback exchanges the auth code,
-- so it has to be stored somewhere writable from a request handler.
-- D1 is that place.
--
-- Also holds the eBay merchant location key once the create-location
-- step runs, for the same reason.
--
-- Keys in use:
--   ebay_refresh_token          — the 18mo OAuth refresh token
--   ebay_refresh_expires_at     — ISO timestamp, for a "reconnect soon" nudge
--   ebay_account_label          — the eBay username, for display
--   ebay_merchant_location_key  — the inventory location key for offers
--
-- Values are stored as-is (the refresh token is already opaque). If we
-- ever store something more sensitive we'd encrypt at the app layer,
-- but D1 itself is not world-readable — access is gated by the Worker
-- binding, same trust boundary as every other table here.

CREATE TABLE IF NOT EXISTS app_secret (
	key        TEXT PRIMARY KEY,
	value      TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
