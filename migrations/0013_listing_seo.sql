-- 0013_listing_seo.sql
--
-- Add per-listing SEO title + meta description fields.
--
-- Squarespace exposes a `seoOptions` field on each product (returned
-- as `null` from product GETs that have it unset). The update-product
-- endpoint accepts it as `seoData` in some docs but the payload shape
-- is the same: { title: string, description: string }.
--
-- SS admin UI caps:
--   - SEO TITLE        — 100 chars
--   - SEO DESCRIPTION  — 400 chars
--
-- Google's display sweet spot is tighter (~60 char title, ~160 char
-- meta description); the UI gates suggest both. We store as plain
-- strings (no HTML — meta description is plain text by spec).
--
-- Both nullable: an unset value means "let SS auto-derive from the
-- product title + description" (current behaviour).

ALTER TABLE marketplace_listing ADD COLUMN listing_seo_title TEXT;
ALTER TABLE marketplace_listing ADD COLUMN listing_seo_description TEXT;
