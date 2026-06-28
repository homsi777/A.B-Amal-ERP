-- Operating expenses (مصاريف تشغيلية) — cash out + GL expense recognition.

CREATE TABLE expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  gl_account_id uuid NOT NULL REFERENCES gl_accounts(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_categories_company_code UNIQUE (company_id, code)
);

CREATE INDEX idx_expense_categories_company ON expense_categories(company_id, is_active, sort_order);

CREATE TABLE operating_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  expense_no text NOT NULL,
  expense_date date NOT NULL DEFAULT (current_date),
  category_id uuid NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  cashbox_id uuid NOT NULL REFERENCES cashboxes(id) ON DELETE RESTRICT,
  beneficiary_name text,
  amount numeric(18, 4) NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  exchange_rate_to_usd numeric(18, 8) NOT NULL DEFAULT 1,
  amount_usd numeric(18, 4) NOT NULL,
  description text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'CONFIRMED',
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  cashbox_movement_id uuid REFERENCES cashbox_movements(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operating_expenses_company_no UNIQUE (company_id, expense_no),
  CONSTRAINT operating_expenses_amount_chk CHECK (amount > 0),
  CONSTRAINT operating_expenses_status_chk CHECK (status IN ('CONFIRMED', 'CANCELLED'))
);

CREATE INDEX idx_operating_expenses_company_date
  ON operating_expenses(company_id, expense_date DESC);

CREATE INDEX idx_operating_expenses_company_status
  ON operating_expenses(company_id, status, expense_date DESC);

CREATE INDEX idx_operating_expenses_cashbox
  ON operating_expenses(company_id, cashbox_id, expense_date DESC);

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_chk;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_chk CHECK (source_type IN (
  'VOUCHER', 'VOUCHER_REVERSAL', 'RETURN_INVOICE', 'RETURN_INVOICE_REVERSAL',
  'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT', 'PAYROLL_REVERSAL', 'MANUAL', 'OPENING', 'SYSTEM',
  'SALES_INVOICE', 'SALES_INVOICE_REVERSAL',
  'PURCHASE_INVOICE', 'PURCHASE_INVOICE_REVERSAL',
  'CUSTOMER_DISCOUNT', 'CUSTOMER_DISCOUNT_REVERSAL',
  'OPERATING_EXPENSE', 'OPERATING_EXPENSE_REVERSAL'
));

DROP INDEX IF EXISTS idx_journal_entries_source_doc;
CREATE UNIQUE INDEX idx_journal_entries_source_doc ON journal_entries(company_id, source_type, source_id)
  WHERE source_id IS NOT NULL
  AND source_type IN (
    'VOUCHER', 'RETURN_INVOICE', 'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT',
    'SALES_INVOICE', 'PURCHASE_INVOICE', 'CUSTOMER_DISCOUNT', 'OPERATING_EXPENSE'
  );
