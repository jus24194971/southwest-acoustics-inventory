-- 0011_listing_shipping_categories.sql
--
-- Add per-listing shipping and category fields to marketplace_listing.
--
-- Squarespace's Commerce Products API doesn't expose per-product
-- shipping costs or product categories as first-class fields. Both
-- are tag-driven on Dad's storefront:
--
--   - The "sub-shops" (Leo Jaymz Guitars, Special Value Guitars,
--     Parts and Accessories, etc.) are tag/slug-based filtered views
--     of the single SS Store Page. Setting a tag like
--     "leo-jaymz-guitars" routes the product onto that sub-shop URL.
--
--   - Shipping cost overrides require a Squarespace-side shipping
--     rule (e.g. "Items with 'free-shipping' tag → $0"). Our app
--     just appends the right tag; Dad's SS admin rules do the math.
--
-- We add three columns:
--
--   listing_categories_json  — JSON array of category slug strings,
--                              e.g. ["leo-jaymz-guitars", "on-sale"].
--                              Merged into tags on push.
--
--   listing_free_shipping    — 0/1 flag. When 1, "free-shipping" gets
--                              auto-appended to tags on push so the SS
--                              free-shipping rule kicks in.
--
--   listing_weight_oz        — optional weight in ounces. When set,
--                              pushed as the variant's
--                              shippingMeasurements.weight so SS's
--                              weight-based rate rules can calculate.

ALTER TABLE marketplace_listing ADD COLUMN listing_categories_json TEXT;
ALTER TABLE marketplace_listing ADD COLUMN listing_free_shipping INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marketplace_listing ADD COLUMN listing_weight_oz REAL;
