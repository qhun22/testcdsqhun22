ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid', 'pending', 'paid'));

UPDATE orders
SET payment_status = 'pending'
WHERE payment_method = 'bank_transfer';
