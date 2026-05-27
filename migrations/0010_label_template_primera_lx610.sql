-- 0010_label_template_primera_lx610.sql
--
-- Add a 2" × 3" (51 × 76mm) template for the Primera LX-610. The
-- LX-610 is a color label printer with a built-in cutter — it can
-- cut custom sizes from continuous roll stock, so the dimensions
-- here are the cut size, not a stock label SKU.
--
-- 2" = 50.8mm, 3" = 76.2mm. Long edge first to match the landscape
-- orientation convention used by every other template in this table.
--
-- The Primera-flagged templates trigger a richer renderer in
-- labels.ts that includes the brand logo + a wrapped description
-- block — the DYMO renderer can't fit that much detail at 19mm tall.

INSERT INTO label_template (code, display_name, width_mm, height_mm, is_default) VALUES
  ('PRIMERA_LX610_2x3', 'Primera LX-610 Color 2″ × 3″ (51 × 76mm)', 76.2, 50.8, 0);
