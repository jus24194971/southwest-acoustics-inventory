-- 0008_label_template_30320.sql
--
-- Add the 1" × 3.5" address label (DYMO 30320 or compatible) — Dad
-- found a roll of these and wants to test on a bigger format.
--
-- 1" = 25.4mm, 3.5" = 88.9mm. Long edge first to match the
-- landscape orientation convention used throughout this table.

INSERT INTO label_template (code, display_name, width_mm, height_mm, is_default) VALUES
  ('DYMO_30320', 'DYMO 30320 Address 89×25mm (1″ × 3.5″)', 88.9, 25.4, 0);
