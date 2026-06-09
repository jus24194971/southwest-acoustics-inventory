-- 0017_inbound_orders.sql
--
-- Inbound / purchase orders — the receiving side of the shop.
--
-- Dad buys parts from Alibaba sellers he has relationships with.
-- There's no usable buyer API and scraping isn't viable from our
-- stack, so intake is: he hands us the order (screenshot or pasted
-- text), Claude extracts the line items, he maps each to inventory
-- (or creates a new item), and when the box arrives he hits Receive.
--
-- Lifecycle: ordered → in_transit → received (→ canceled).
--
-- One inbound_order with many inbound_order_line rows. Each line
-- starts unmapped (item_id NULL) and gets linked to an item during
-- review or on receive. received_qty tracks partial receipts (a
-- shipment can arrive in pieces).

CREATE TABLE inbound_order (
	id                 INTEGER PRIMARY KEY AUTOINCREMENT,
	supplier           TEXT,                 -- seller / "Alibaba"
	supplier_order_ref TEXT,                 -- Alibaba order number
	-- 'ordered' | 'in_transit' | 'received' | 'canceled'
	status             TEXT NOT NULL DEFAULT 'ordered',
	tracking           TEXT,                 -- carrier + tracking #
	eta                TEXT,                 -- expected arrival (free text/date)
	notes              TEXT,
	ordered_at         TEXT,                 -- when Dad placed it
	received_at        TEXT,                 -- when fully received
	created_at         TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE inbound_order_line (
	id                 INTEGER PRIMARY KEY AUTOINCREMENT,
	inbound_order_id   INTEGER NOT NULL REFERENCES inbound_order(id),
	-- Parsed from the order
	description        TEXT NOT NULL,        -- product name as on Alibaba
	quantity           INTEGER NOT NULL DEFAULT 1,
	unit_cost_cents    INTEGER,              -- optional unit price
	supplier_sku       TEXT,                 -- seller's SKU / model code
	-- Mapping to our catalogue (NULL until mapped)
	item_id            INTEGER REFERENCES item(id),
	-- Receiving
	received_qty       INTEGER NOT NULL DEFAULT 0,
	received_at        TEXT,
	-- Optional reference photo (R2 key) carried to the item on receive
	photo_r2_key       TEXT,
	notes              TEXT,
	created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_inbound_order_status ON inbound_order(status);
CREATE INDEX idx_inbound_line_order   ON inbound_order_line(inbound_order_id);
CREATE INDEX idx_inbound_line_item    ON inbound_order_line(item_id);
