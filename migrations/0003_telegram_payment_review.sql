ALTER TABLE orders ADD COLUMN stock_released INTEGER NOT NULL DEFAULT 0
  CHECK (stock_released IN (0, 1, 2));
