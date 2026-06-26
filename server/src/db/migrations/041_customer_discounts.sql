-- Customer allowance discounts (حسم عميل) — reduces AR without cash movement.

CREATE TABLE customer_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  discount_no text NOT NULL,
  discount_date date NOT NULL DEFAULT (current_date),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount numeric(18, 4) NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  exchange_rate_to_usd numeric(18, 8) NOT NULL DEFAULT 1,
  amount_usd numeric(18, 4) NOT NULL,
  description text,
  notes text,
  status text NOT NULL DEFAULT 'CONFIRMED',
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_discounts_company_no UNIQUE (company_id, discount_no),
  CONSTRAINT customer_discounts_amount_chk CHECK (amount > 0),
  CONSTRAINT customer_discounts_status_chk CHECK (status IN ('CONFIRMED', 'CANCELLED'))
);

CREATE INDEX idx_customer_discounts_company_customer
  ON customer_discounts(company_id, customer_id, discount_date DESC);

CREATE INDEX idx_customer_discounts_company_status
  ON customer_discounts(company_id, status, discount_date DESC);

-- GL source types for discount posting / reversal
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_chk;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_chk CHECK (source_type IN (
  'VOUCHER', 'VOUCHER_REVERSAL', 'RETURN_INVOICE', 'RETURN_INVOICE_REVERSAL',
  'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT', 'PAYROLL_REVERSAL', 'MANUAL', 'OPENING', 'SYSTEM',
  'SALES_INVOICE', 'SALES_INVOICE_REVERSAL',
  'PURCHASE_INVOICE', 'PURCHASE_INVOICE_REVERSAL',
  'CUSTOMER_DISCOUNT', 'CUSTOMER_DISCOUNT_REVERSAL'
));

DROP INDEX IF EXISTS idx_journal_entries_source_doc;
CREATE UNIQUE INDEX idx_journal_entries_source_doc ON journal_entries(company_id, source_type, source_id)
  WHERE source_id IS NOT NULL
  AND source_type IN (
    'VOUCHER', 'RETURN_INVOICE', 'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT',
    'SALES_INVOICE', 'PURCHASE_INVOICE', 'CUSTOMER_DISCOUNT'
  );
