-- V-1.0: Historical cost snapshot for future confirmed sales invoice lines.
-- Existing rows are intentionally left untouched; old invoices keep NULL snapshot fields.

ALTER TABLE sales_invoice_lines
  ADD COLUMN IF NOT EXISTS cost_unit_price numeric(14,4),
  ADD COLUMN IF NOT EXISTS cost_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS cost_currency_code text REFERENCES currencies(code),
  ADD COLUMN IF NOT EXISTS cost_exchange_rate_to_usd numeric(18,6),
  ADD COLUMN IF NOT EXISTS cost_unit_price_usd numeric(14,4),
  ADD COLUMN IF NOT EXISTS cost_total_usd numeric(14,2),
  ADD COLUMN IF NOT EXISTS cost_source text,
  ADD COLUMN IF NOT EXISTS cost_snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS cost_missing boolean DEFAULT false;

ALTER TABLE sales_invoice_lines
  DROP CONSTRAINT IF EXISTS sales_inv_lines_cost_source_chk;

ALTER TABLE sales_invoice_lines
  ADD CONSTRAINT sales_inv_lines_cost_source_chk CHECK (
    cost_source IS NULL OR cost_source IN (
      'FABRIC_ROLL_AT_CONFIRMATION',
      'PURCHASE_LINE',
      'GL_COGS',
      'CURRENT_ROLL_COST_FALLBACK',
      'MISSING'
    )
  );

CREATE INDEX IF NOT EXISTS idx_sales_inv_lines_item
  ON sales_invoice_lines(company_id, fabric_item_id)
  WHERE fabric_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_inv_lines_cost_source
  ON sales_invoice_lines(company_id, cost_source)
  WHERE cost_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_inv_lines_cost_missing
  ON sales_invoice_lines(company_id, cost_missing)
  WHERE cost_missing IS TRUE;
