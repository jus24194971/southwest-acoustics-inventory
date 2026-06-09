-- 0018_suppliers.sql
--
-- Suppliers as first-class records, so every inbound order is
-- documented against a known seller and Dad can mark his go-to
-- sources as "preferred".
--
-- Two flavors of "preferred":
--   - supplier.is_preferred — a general star on a seller Dad likes.
--   - item.preferred_supplier_id — the go-to seller to REORDER a
--     specific part from (set from an inbound line once received).
--
-- inbound_order keeps its free-text `supplier` column for display +
-- backfill; supplier_id is the structured link. We find-or-create a
-- supplier by name when an order is created/edited.

CREATE TABLE supplier (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	name         TEXT NOT NULL,
	kind         TEXT,                 -- 'alibaba' | 'other' | ...
	url          TEXT,                 -- store / contact URL
	contact      TEXT,                 -- rep name, WeChat, email, etc.
	notes        TEXT,
	is_preferred INTEGER NOT NULL DEFAULT 0,
	created_at   TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_supplier_preferred ON supplier(is_preferred);

ALTER TABLE inbound_order ADD COLUMN supplier_id INTEGER REFERENCES supplier(id);
ALTER TABLE item ADD COLUMN preferred_supplier_id INTEGER REFERENCES supplier(id);

CREATE INDEX idx_inbound_supplier ON inbound_order(supplier_id);
CREATE INDEX idx_item_pref_supplier ON item(preferred_supplier_id);

-- Backfill: one supplier per distinct inbound_order.supplier text,
-- then link the orders. Default kind 'alibaba' since that's Dad's
-- main source; he can edit later.
INSERT INTO supplier (name, kind)
SELECT DISTINCT TRIM(supplier), 'alibaba'
FROM inbound_order
WHERE supplier IS NOT NULL AND TRIM(supplier) != ''
  AND TRIM(supplier) NOT IN (SELECT name FROM supplier);

UPDATE inbound_order
SET supplier_id = (SELECT s.id FROM supplier s WHERE s.name = TRIM(inbound_order.supplier))
WHERE supplier_id IS NULL AND supplier IS NOT NULL AND TRIM(supplier) != '';
