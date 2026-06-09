-- Excel import traceability hardening.
-- Adds generic source metadata to the existing purchase_import_* staging model
-- so stock imports that create fabric rolls can be audited without creating
-- accounting debt unless explicitly confirmed as a purchase invoice.

ALTER TABLE purchase_import_batches
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'PURCHASE_INVOICE',
  ADD COLUMN IF NOT EXISTS supplier_invoice_no text,
  ADD COLUMN IF NOT EXISTS extracted_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS detected_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS imported_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE purchase_import_batches DROP CONSTRAINT IF EXISTS purchase_import_batches_status_check;
ALTER TABLE purchase_import_batches
  ADD CONSTRAINT purchase_import_batches_status_check
  CHECK (status IN (
    'PREVIEW','PREVIEWED','VALIDATED','CONFIRMING','CONFIRMED',
    'PARTIALLY_CONFIRMED','FAILED','CANCELLED'
  ));

ALTER TABLE purchase_import_batches DROP CONSTRAINT IF EXISTS purchase_import_batches_source_type_check;
ALTER TABLE purchase_import_batches
  ADD CONSTRAINT purchase_import_batches_source_type_check
  CHECK (source_type IN (
    'PURCHASE_INVOICE',
    'OPENING_STOCK',
    'DIRECT_STOCK_IMPORT',
    'CHINA_PACKING_LIST',
    'STOCK_IMPORT'
  ));

ALTER TABLE purchase_import_rows
  ADD COLUMN IF NOT EXISTS created_inventory_movement_id uuid REFERENCES inventory_movements(id) ON DELETE SET NULL;

ALTER TABLE fabric_rolls
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES purchase_import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_invoice_id uuid REFERENCES purchase_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_invoice_line_id uuid REFERENCES purchase_invoice_lines(id) ON DELETE SET NULL;

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS supplier_invoice_no text;

CREATE INDEX IF NOT EXISTS idx_import_batches_source_type
  ON purchase_import_batches(company_id, source_type, status);

CREATE INDEX IF NOT EXISTS idx_import_batches_supplier_invoice_no
  ON purchase_import_batches(company_id, supplier_invoice_no)
  WHERE supplier_invoice_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_rows_created_inventory_movement
  ON purchase_import_rows(created_inventory_movement_id)
  WHERE created_inventory_movement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rolls_import_batch
  ON fabric_rolls(import_batch_id)
  WHERE import_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rolls_purchase_invoice
  ON fabric_rolls(purchase_invoice_id)
  WHERE purchase_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rolls_purchase_invoice_line
  ON fabric_rolls(purchase_invoice_line_id)
  WHERE purchase_invoice_line_id IS NOT NULL;
