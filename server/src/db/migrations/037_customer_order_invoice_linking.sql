-- Customer order ↔ sales invoice linking + meters per roll / roll count on order lines

ALTER TABLE customer_order_lines
  ADD COLUMN IF NOT EXISTS meters_per_roll numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS roll_count integer NOT NULL DEFAULT 1;

UPDATE customer_order_lines
SET
  meters_per_roll = CASE WHEN meters_per_roll > 0 THEN meters_per_roll ELSE length END,
  roll_count = CASE WHEN roll_count > 0 THEN roll_count ELSE 1 END
WHERE meters_per_roll <= 0 OR roll_count <= 0;

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS customer_order_id uuid REFERENCES customer_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_inv_customer_order
  ON sales_invoices(company_id, customer_order_id)
  WHERE customer_order_id IS NOT NULL;

ALTER TABLE sales_invoice_lines
  ADD COLUMN IF NOT EXISTS customer_order_line_id uuid REFERENCES customer_order_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_inv_lines_order_line
  ON sales_invoice_lines(company_id, customer_order_line_id)
  WHERE customer_order_line_id IS NOT NULL;
