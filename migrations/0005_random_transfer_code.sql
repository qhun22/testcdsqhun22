ALTER TABLE orders ADD COLUMN transfer_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_transfer_code
  ON orders(transfer_code)
  WHERE transfer_code IS NOT NULL;
