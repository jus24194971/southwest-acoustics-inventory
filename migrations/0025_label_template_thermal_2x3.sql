-- 0025_label_template_thermal_2x3.sql
--
-- Add a generic 2" × 3" template for Dad's new off-brand direct-thermal
-- (B&W) label printer. Same geometry and rich renderer as the Primera
-- 2×3 — it's just named for the thermal printer so it's obvious in the
-- print menu (and not buried under "Primera LX-610").
--
-- 3" = 76.2mm (long edge first, landscape, matching every other row);
-- 2" = 50.8mm short edge. Fed landscape (3" wide × 2" tall) per Dad.
-- Non-default; selectable from the print dropdown.

INSERT INTO label_template (code, display_name, width_mm, height_mm, is_default) VALUES
  ('THERMAL_2x3', 'Thermal 2″ × 3″ (76 × 51mm)', 76.2, 50.8, 0);
