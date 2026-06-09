ALTER TABLE purchase_import_batches
  ADD COLUMN IF NOT EXISTS invoice_no text,
  ADD COLUMN IF NOT EXISTS invoice_date date,
  ADD COLUMN IF NOT EXISTS exchange_rate_to_usd numeric(18,6),
  ADD COLUMN IF NOT EXISTS created_purchase_invoice_id uuid REFERENCES purchase_invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_import_batches_company_invoice_no
  ON purchase_import_batches(company_id, invoice_no)
  WHERE invoice_no IS NOT NULL;

ALTER TABLE purchase_import_rows
  ADD COLUMN IF NOT EXISTS created_purchase_invoice_line_id uuid REFERENCES purchase_invoice_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_import_rows_created_purchase_invoice_line
  ON purchase_import_rows(created_purchase_invoice_line_id)
  WHERE created_purchase_invoice_line_id IS NOT NULL;

