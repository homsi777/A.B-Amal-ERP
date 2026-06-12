-- Obada wholesale: بيع بالتوب + قسم التسليم والتفنيد

-- وحدة «توب» في أسطر فاتورة البيع
ALTER TABLE sales_invoice_lines DROP CONSTRAINT IF EXISTS sales_invoice_lines_unit_check;
ALTER TABLE sales_invoice_lines
  ADD CONSTRAINT sales_invoice_lines_unit_check CHECK (unit IN ('meter', 'yard', 'roll'));

-- حالة التسليم على فاتورة البيع
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS delivery_status text
  CHECK (delivery_status IS NULL OR delivery_status IN ('IN_DELIVERY', 'FULFILLED'));

CREATE INDEX IF NOT EXISTS idx_sales_inv_delivery ON sales_invoices(company_id, delivery_status)
  WHERE delivery_status IS NOT NULL;

-- بيانات التفنيد المحفوظة لكل سطر (أو لكل توب لاحقاً عبر roll_seq)
CREATE TABLE IF NOT EXISTS delivery_fulfillment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  invoice_line_id uuid NOT NULL REFERENCES sales_invoice_lines(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  roll_seq integer NOT NULL DEFAULT 1,
  fabric_roll_id uuid REFERENCES fabric_rolls(id) ON DELETE SET NULL,
  tafnid_length numeric(14,3),
  length_unit text NOT NULL DEFAULT 'meter' CHECK (length_unit IN ('meter', 'yard')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_fulfillment_line_roll_seq UNIQUE (invoice_line_id, roll_seq)
);

CREATE INDEX IF NOT EXISTS idx_delivery_fulfillment_invoice
  ON delivery_fulfillment_lines(company_id, invoice_id);
