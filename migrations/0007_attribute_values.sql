-- 0007_attribute_values.sql
--
-- The attribute slots in item (attr_1..5) currently hold raw 3-char
-- codes typed into text inputs. This pass turns them into picklists
-- with a friendly label alongside each code, plus an "Add new" flow
-- so Dad can grow the vocabulary as he encounters new finishes /
-- configs without us having to ship a migration each time.
--
-- attribute_value:   the canonical list of (context, code, label) rows.
-- category.attr_N_context_key:  tells the UI which context to draw
--                               the picklist from for each slot in
--                               this category.
--
-- A "context" is a free-form string identifier ('color', 'pickup_type',
-- 'fretboard', etc.) — it groups values that are interchangeable. A
-- color value works for any slot whose label points at 'color', so
-- the 'BLK' value can be the body finish AND the hardware finish AND
-- the pickguard color, without us duplicating it three times.

CREATE TABLE attribute_value (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  context_key  TEXT    NOT NULL,
  code         TEXT    NOT NULL,                    -- 3-char SKU code (BLK, HUM, …)
  label        TEXT    NOT NULL,                    -- human display ("Black")
  sort_order   INTEGER NOT NULL DEFAULT 100,        -- lower = higher in the list
  is_active    INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (context_key, code)
);

CREATE INDEX idx_attribute_value_context ON attribute_value(context_key, is_active, sort_order);

-- Per-category pointers — which context each slot's picklist draws from.
ALTER TABLE category ADD COLUMN attr_1_context_key TEXT;
ALTER TABLE category ADD COLUMN attr_2_context_key TEXT;
ALTER TABLE category ADD COLUMN attr_3_context_key TEXT;
ALTER TABLE category ADD COLUMN attr_4_context_key TEXT;
ALTER TABLE category ADD COLUMN attr_5_context_key TEXT;

-- =====================================================================
-- Wire each category's attribute slots to a context.
-- =====================================================================

UPDATE category SET
  attr_1_context_key = 'color',
  attr_2_context_key = 'finish_type',
  attr_3_context_key = 'wood',
  attr_4_context_key = 'construction',
  attr_5_context_key = 'pickguard'
 WHERE code = 'BD';

UPDATE category SET
  attr_1_context_key = 'wood',
  attr_2_context_key = 'fretboard',
  attr_3_context_key = 'neck_profile',
  attr_4_context_key = 'radius',
  attr_5_context_key = 'fret_count_size'
 WHERE code = 'NK';

UPDATE category SET
  attr_1_context_key = 'pickup_type',
  attr_2_context_key = 'pickup_position',
  attr_3_context_key = 'pickup_brand',
  attr_4_context_key = 'pickup_output',
  attr_5_context_key = 'active_passive'
 WHERE code = 'PU';

UPDATE category SET
  attr_1_context_key = 'hardware_type',
  attr_2_context_key = 'color',
  attr_3_context_key = 'hardware_variant'
 WHERE code = 'HW';

UPDATE category SET
  attr_1_context_key = 'electronics_component',
  attr_2_context_key = 'electronics_value',
  attr_3_context_key = 'electronics_variant'
 WHERE code = 'EL';

UPDATE category SET
  attr_1_context_key = 'color',            -- body finish
  attr_2_context_key = 'color',            -- hardware finish
  attr_3_context_key = 'pickup_config',
  attr_4_context_key = 'wiring_scheme',
  attr_5_context_key = 'build_variant'
 WHERE code IN ('GT', 'SA', 'LJ');

-- =====================================================================
-- Seed values. Focus on the high-traffic contexts — Dad adds the rest
-- inline via the "+ Add new" affordance in the UI.
-- =====================================================================

-- ----- color -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('color', 'BLK', 'Black',           10),
  ('color', 'WHT', 'White',           20),
  ('color', 'CRM', 'Cream',           25),
  ('color', 'RED', 'Red',             30),
  ('color', 'BLU', 'Blue',            40),
  ('color', 'GRN', 'Green',           50),
  ('color', 'YLW', 'Yellow',          55),
  ('color', 'ORG', 'Orange',          60),
  ('color', 'BRN', 'Brown',           65),
  ('color', 'GRY', 'Grey',            70),
  ('color', 'GLD', 'Gold',           110),
  ('color', 'SLV', 'Silver',         120),
  ('color', 'CHR', 'Chrome',         125),
  ('color', 'NIK', 'Nickel',         130),
  ('color', 'BRZ', 'Brass',          135),
  ('color', 'BLK', 'Black',          140),
  ('color', 'NAT', 'Natural',        200),
  ('color', 'BST', 'Sunburst',       210),
  ('color', '3TS', '3-Tone Sunburst',220),
  ('color', '2TS', '2-Tone Sunburst',230),
  ('color', 'TBC', 'Trans Black',    240),
  ('color', 'TRD', 'Trans Red',      245),
  ('color', 'TBL', 'Trans Blue',     250),
  ('color', 'TGR', 'Trans Green',    255),
  ('color', 'PRG', 'Pearl',          300),
  ('color', 'MGY', 'Mint Green',     310),
  ('color', 'TOR', 'Tortoise',       320),
  ('color', 'UNQ', 'Unique (see description)', 999)
ON CONFLICT DO NOTHING;

-- ----- finish_type -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('finish_type', 'GLS', 'Gloss',   10),
  ('finish_type', 'SAT', 'Satin',   20),
  ('finish_type', 'MAT', 'Matte',   30),
  ('finish_type', 'REL', 'Relic',   40),
  ('finish_type', 'OIL', 'Oil',     50),
  ('finish_type', 'UNQ', 'Unique (see description)', 999);

-- ----- wood -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('wood', 'ALD', 'Alder',     10),
  ('wood', 'ASH', 'Ash',       20),
  ('wood', 'MAH', 'Mahogany',  30),
  ('wood', 'BAS', 'Basswood',  40),
  ('wood', 'POP', 'Poplar',    50),
  ('wood', 'KOR', 'Korina',    60),
  ('wood', 'MPL', 'Maple',     70),
  ('wood', 'ROS', 'Rosewood',  80),
  ('wood', 'WAL', 'Walnut',    90),
  ('wood', 'PIN', 'Pine',     100);

-- ----- fretboard -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('fretboard', 'MPL', 'Maple',      10),
  ('fretboard', 'ROS', 'Rosewood',   20),
  ('fretboard', 'EBO', 'Ebony',      30),
  ('fretboard', 'PFR', 'Pau Ferro',  40),
  ('fretboard', 'RWD', 'Richlite',   50);

-- ----- construction -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('construction', 'SLD', 'Solid',          10),
  ('construction', 'CHM', 'Chambered',      20),
  ('construction', 'SEM', 'Semi-hollow',    30),
  ('construction', 'HOL', 'Hollow',         40);

-- ----- pickguard -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('pickguard', 'BLK', 'Black',         10),
  ('pickguard', 'WHT', 'White',         20),
  ('pickguard', 'MGY', 'Mint green',    30),
  ('pickguard', 'PRG', 'Pearl',         40),
  ('pickguard', 'TOR', 'Tortoise',      50),
  ('pickguard', 'GLD', 'Gold anodised', 60),
  ('pickguard', 'NON', 'None',         999);

-- ----- neck_profile -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('neck_profile', 'CCC', 'C-profile (standard)',  10),
  ('neck_profile', 'VVV', 'V-profile',             20),
  ('neck_profile', 'UUU', 'U-profile',             30),
  ('neck_profile', 'DDD', 'D-profile',             40),
  ('neck_profile', 'SLM', 'Slim (modern)',         50),
  ('neck_profile', 'FAT', 'Fat',                   60),
  ('neck_profile', 'MOD', 'Modern',                70);

-- ----- radius -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('radius', '725', '7.25"',         10),
  ('radius', '950', '9.5"',          20),
  ('radius', '10R', '10"',           30),
  ('radius', '12R', '12"',           40),
  ('radius', '14R', '14"',           50),
  ('radius', '16R', '16"',           60),
  ('radius', 'CMP', 'Compound',      70);

-- ----- fret_count_size -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('fret_count_size', 'F21', '21 frets',             10),
  ('fret_count_size', 'F22', '22 frets',             20),
  ('fret_count_size', 'F24', '24 frets',             30),
  ('fret_count_size', 'JMB', 'Jumbo',                40),
  ('fret_count_size', 'MJB', 'Medium-jumbo',         50),
  ('fret_count_size', 'VTG', 'Vintage',              60),
  ('fret_count_size', 'SST', 'Stainless steel',      70);

-- ----- pickup_type -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('pickup_type', 'SGL', 'Single-coil',     10),
  ('pickup_type', 'HUM', 'Humbucker',       20),
  ('pickup_type', 'P90', 'P-90',            30),
  ('pickup_type', 'MIN', 'Mini-humbucker',  40),
  ('pickup_type', 'RAL', 'Rail',            50),
  ('pickup_type', 'PIE', 'Piezo',           60);

-- ----- pickup_position -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('pickup_position', 'NEK', 'Neck',     10),
  ('pickup_position', 'MID', 'Middle',   20),
  ('pickup_position', 'BRG', 'Bridge',   30),
  ('pickup_position', 'ANY', 'Any',      40);

-- ----- pickup_brand -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('pickup_brand', 'SEY', 'Seymour Duncan',    10),
  ('pickup_brand', 'DIM', 'DiMarzio',          20),
  ('pickup_brand', 'FEN', 'Fender',            30),
  ('pickup_brand', 'GIB', 'Gibson',            40),
  ('pickup_brand', 'EMG', 'EMG',               50),
  ('pickup_brand', 'FRT', 'Fralin',            60),
  ('pickup_brand', 'BKP', 'Bare Knuckle',      70),
  ('pickup_brand', 'LOL', 'Lollar',            80);

-- ----- pickup_output -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('pickup_output', 'LOW', 'Low',          10),
  ('pickup_output', 'MED', 'Medium',       20),
  ('pickup_output', 'HOT', 'Hot',          30),
  ('pickup_output', 'EXT', 'Extreme',      40);

-- ----- active_passive -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('active_passive', 'PAS', 'Passive',     10),
  ('active_passive', 'ACT', 'Active',      20);

-- ----- hardware_type -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('hardware_type', 'TUN', 'Tuners',         10),
  ('hardware_type', 'BRG', 'Bridge',         20),
  ('hardware_type', 'NUT', 'Nut',            30),
  ('hardware_type', 'KNB', 'Knobs',          40),
  ('hardware_type', 'JCK', 'Output jack',    50),
  ('hardware_type', 'STR', 'Strap buttons',  60),
  ('hardware_type', 'PUP', 'Pickup covers',  70),
  ('hardware_type', 'PG',  'Pickguard',      80),
  ('hardware_type', 'SCR', 'Screws',         90),
  ('hardware_type', 'WIR', 'Wiring/cable',  100);

-- ----- pickup_config -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('pickup_config', 'SSS', 'SSS (3× single)',         10),
  ('pickup_config', 'HSS', 'HSS (hum + 2 single)',    20),
  ('pickup_config', 'HSH', 'HSH',                     30),
  ('pickup_config', 'HH',  'HH (dual humbucker)',     40),
  ('pickup_config', 'SH',  'SH (single + hum)',       50),
  ('pickup_config', 'SS',  'SS (dual single)',        60),
  ('pickup_config', 'S',   'S (single)',              70),
  ('pickup_config', 'H',   'H (single humbucker)',    80),
  ('pickup_config', 'P90', 'P-90 set',                90),
  ('pickup_config', 'PP',  'PP (dual P-90)',         100);

-- ----- wiring_scheme -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('wiring_scheme', '50S', '50s wiring',         10),
  ('wiring_scheme', 'MDN', 'Modern wiring',      20),
  ('wiring_scheme', 'HRD', 'Hot-rod',            30),
  ('wiring_scheme', 'COT', 'Coil-tap',           40),
  ('wiring_scheme', 'PHS', 'Phase switch',       50),
  ('wiring_scheme', 'CST', 'Custom',             60);

-- ----- build_variant -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('build_variant', 'STD', 'Standard',          10),
  ('build_variant', 'LTD', 'Limited edition',   20),
  ('build_variant', 'CST', 'Custom shop',       30),
  ('build_variant', 'ANN', 'Anniversary',       40),
  ('build_variant', 'SIG', 'Signature',         50);

-- ----- electronics_component -----
INSERT INTO attribute_value (context_key, code, label, sort_order) VALUES
  ('electronics_component', 'POT', 'Potentiometer',     10),
  ('electronics_component', 'CAP', 'Capacitor',         20),
  ('electronics_component', 'SWT', 'Switch',            30),
  ('electronics_component', 'JCK', 'Output jack',       40),
  ('electronics_component', 'WIR', 'Wiring/harness',    50);
