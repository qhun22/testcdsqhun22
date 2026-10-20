-- Bảng behavior_events: ghi toàn bộ hành vi mua sắm qua Stream → Pipeline → Sink
-- Các loại event: page_view, view_product, add_to_cart, remove_from_cart,
--                 abandon_cart, checkout_start, checkout_complete
CREATE TABLE IF NOT EXISTS behavior_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  event_type      TEXT NOT NULL,
  country         TEXT NOT NULL DEFAULT 'ZZ',
  operating_system TEXT NOT NULL DEFAULT 'Khác',
  product_id      TEXT,
  product_name    TEXT,
  quantity        INTEGER,
  price           INTEGER,
  cart_size       INTEGER,
  cart_total      INTEGER,
  order_id        TEXT,
  total           INTEGER,
  payment_method  TEXT,
  page            TEXT
);
CREATE INDEX IF NOT EXISTS behavior_events_ts ON behavior_events(ts);
CREATE INDEX IF NOT EXISTS behavior_events_type ON behavior_events(event_type);
