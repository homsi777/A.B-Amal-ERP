-- Return invoices: link to original sales/purchase invoices, settlement, audit, line-level traceability
-- Safe additive migration — does not modify prior migrations.

-- ─── Original invoice link (header) ─────────────────────────────────────────
ALTER TABLE return_invoices
  ADD COLUMN IF NOT EXISTS original_sales_invoice_id uuid REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS original_purchase_invoice_id uuid REFERENCES purchase_invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS settlement_type text NOT NULL DEFAULT 'CREDIT_BALANCE',
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE return_invoices DROP CONSTRAINT IF EXISTS return_invoices_settlement_type_chk;
ALTER TABLE return_invoices
  ADD CONSTRAINT return_invoices_settlement_type_chk CHECK (
    settlement_type IN ('CREDIT_BALANCE', 'CASH_REFUND', 'MIXED', 'NO_FINANCIAL_EFFECT')
  );

ALTER TABLE return_invoices DROP CONSTRAINT IF EXISTS return_invoices_original_invoice_xor_chk;
ALTER TABLE return_invoices
  ADD CONSTRAINT return_invoices_original_invoice_xor_chk CHECK (
    NOT (original_sales_invoice_id IS NOT NULL AND original_purchase_invoice_id IS NOT NULL)
  );

ALTER TABLE return_invoices DROP CONSTRAINT IF EXISTS return_invoices_type_vs_original_chk;
ALTER TABLE return_invoices
  ADD CONSTRAINT return_invoices_type_vs_original_chk CHECK (
    (return_type = 'SALES_RETURN' AND original_purchase_invoice_id IS NULL)
    OR (return_type = 'PURCHASE_RETURN' AND original_sales_invoice_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_return_inv_company_orig_sales
  ON return_invoices(company_id, original_sales_invoice_id)
  WHERE original_sales_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_return_inv_company_orig_purchase
  ON return_invoices(company_id, original_purchase_invoice_id)
  WHERE original_purchase_invoice_id IS NOT NULL;

-- ─── Line link to original invoice lines ─────────────────────────────────────
ALTER TABLE return_invoice_lines
  ADD COLUMN IF NOT EXISTS original_sales_invoice_line_id uuid REFERENCES sales_invoice_lines(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS original_purchase_invoice_line_id uuid REFERENCES purchase_invoice_lines(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS returned_from_quantity numeric(14,3),
  ADD COLUMN IF NOT EXISTS return_reason text;

ALTER TABLE return_invoice_lines DROP CONSTRAINT IF EXISTS return_invoice_lines_original_line_xor_chk;
ALTER TABLE return_invoice_lines
  ADD CONSTRAINT return_invoice_lines_original_line_xor_chk CHECK (
    NOT (original_sales_invoice_line_id IS NOT NULL AND original_purchase_invoice_line_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_ril_orig_sales_line
  ON return_invoice_lines(company_id, original_sales_invoice_line_id)
  WHERE original_sales_invoice_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ril_orig_purchase_line
  ON return_invoice_lines(company_id, original_purchase_invoice_line_id)
  WHERE original_purchase_invoice_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ril_return_orig_sales
  ON return_invoice_lines(return_invoice_id, original_sales_invoice_line_id)
  WHERE original_sales_invoice_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ril_return_orig_purchase
  ON return_invoice_lines(return_invoice_id, original_purchase_invoice_line_id)
  WHERE original_purchase_invoice_line_id IS NOT NULL;

-- ─── Aggregate return status on source invoices (updated by app on confirm/cancel) ─
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS return_fulfillment_status text NOT NULL DEFAULT 'NOT_RETURNED';

ALTER TABLE sales_invoices DROP CONSTRAINT IF EXISTS sales_invoices_return_fulfillment_status_chk;
ALTER TABLE sales_invoices
  ADD CONSTRAINT sales_invoices_return_fulfillment_status_chk CHECK (
    return_fulfillment_status IN ('NOT_RETURNED', 'PARTIALLY_RETURNED', 'FULLY_RETURNED')
  );

CREATE INDEX IF NOT EXISTS idx_sales_inv_company_return_status
  ON sales_invoices(company_id, return_fulfillment_status)
  WHERE return_fulfillment_status <> 'NOT_RETURNED';

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS return_fulfillment_status text NOT NULL DEFAULT 'NOT_RETURNED';

ALTER TABLE purchase_invoices DROP CONSTRAINT IF EXISTS purchase_invoices_return_fulfillment_status_chk;
ALTER TABLE purchase_invoices
  ADD CONSTRAINT purchase_invoices_return_fulfillment_status_chk CHECK (
    return_fulfillment_status IN ('NOT_RETURNED', 'PARTIALLY_RETURNED', 'FULLY_RETURNED')
  );

CREATE INDEX IF NOT EXISTS idx_purchase_inv_company_return_status
  ON purchase_invoices(company_id, return_fulfillment_status)
  WHERE return_fulfillment_status <> 'NOT_RETURNED';

UPDATE sales_invoices SET return_fulfillment_status = 'NOT_RETURNED'
WHERE return_fulfillment_status IS NULL OR return_fulfillment_status NOT IN ('NOT_RETURNED', 'PARTIALLY_RETURNED', 'FULLY_RETURNED');

UPDATE purchase_invoices SET return_fulfillment_status = 'NOT_RETURNED'
WHERE return_fulfillment_status IS NULL OR return_fulfillment_status NOT IN ('NOT_RETURNED', 'PARTIALLY_RETURNED', 'FULLY_RETURNED');
