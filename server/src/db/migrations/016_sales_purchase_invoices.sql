-- Sales & purchase invoices (first-class commercial documents) + GL source types + posting accounts

-- A) Extend journal_entries.source_type for invoice posting idempotency
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_chk;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_chk CHECK (source_type IN (
  'VOUCHER', 'VOUCHER_REVERSAL', 'RETURN_INVOICE', 'RETURN_INVOICE_REVERSAL',
  'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT', 'PAYROLL_REVERSAL', 'MANUAL', 'OPENING', 'SYSTEM',
  'SALES_INVOICE', 'SALES_INVOICE_REVERSAL',
  'PURCHASE_INVOICE', 'PURCHASE_INVOICE_REVERSAL'
));

DROP INDEX IF EXISTS idx_journal_entries_source_doc;
CREATE UNIQUE INDEX idx_journal_entries_source_doc ON journal_entries(company_id, source_type, source_id)
  WHERE source_id IS NOT NULL
  AND source_type IN (
    'VOUCHER', 'RETURN_INVOICE', 'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT',
    'SALES_INVOICE', 'PURCHASE_INVOICE'
  );

-- B) Invoice headers
CREATE TABLE sales_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_no text NOT NULL,
  invoice_date date NOT NULL DEFAULT (current_date),
  customer_id uuid NOT NULL REFERENCES customers(id),
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  warehouse_label text,
  currency_code text NOT NULL DEFAULT 'USD',
  notes text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  tax_total numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  remaining_amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  document_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (document_status IN ('DRAFT', 'CONFIRMED', 'VOIDED')),
  payment_voucher_id uuid REFERENCES vouchers(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  voided_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_invoices_company_invoice_no UNIQUE (company_id, invoice_no),
  CONSTRAINT sales_invoices_amounts_chk CHECK (
    total_amount >= 0 AND paid_amount >= 0 AND remaining_amount >= 0
  )
);

CREATE INDEX idx_sales_inv_company ON sales_invoices(company_id);
CREATE INDEX idx_sales_inv_company_date ON sales_invoices(company_id, invoice_date DESC);
CREATE INDEX idx_sales_inv_customer ON sales_invoices(company_id, customer_id);
CREATE INDEX idx_sales_inv_status ON sales_invoices(company_id, document_status);
CREATE INDEX idx_sales_inv_pay ON sales_invoices(company_id, payment_status);

CREATE TABLE sales_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  fabric_roll_id uuid REFERENCES fabric_rolls(id) ON DELETE SET NULL,
  fabric_item_id uuid REFERENCES fabric_items(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES fabric_item_variants(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric(14,3) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'meter' CHECK (unit IN ('meter', 'yard')),
  unit_price numeric(14,4) NOT NULL DEFAULT 0,
  line_discount numeric(14,2) NOT NULL DEFAULT 0,
  line_tax numeric(14,2) NOT NULL DEFAULT 0,
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_inv_lines_invoice_line UNIQUE (invoice_id, line_no),
  CONSTRAINT sales_inv_lines_qty_chk CHECK (quantity >= 0)
);

CREATE INDEX idx_sales_inv_lines_invoice ON sales_invoice_lines(invoice_id);
CREATE INDEX idx_sales_inv_lines_roll ON sales_invoice_lines(company_id, fabric_roll_id)
  WHERE fabric_roll_id IS NOT NULL;

CREATE TABLE purchase_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_no text NOT NULL,
  invoice_date date NOT NULL DEFAULT (current_date),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  warehouse_label text,
  currency_code text NOT NULL DEFAULT 'USD',
  notes text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  tax_total numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  remaining_amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  document_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (document_status IN ('DRAFT', 'CONFIRMED', 'VOIDED')),
  payment_voucher_id uuid REFERENCES vouchers(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  voided_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_invoices_company_invoice_no UNIQUE (company_id, invoice_no),
  CONSTRAINT purchase_invoices_amounts_chk CHECK (
    total_amount >= 0 AND paid_amount >= 0 AND remaining_amount >= 0
  )
);

CREATE INDEX idx_purchase_inv_company ON purchase_invoices(company_id);
CREATE INDEX idx_purchase_inv_company_date ON purchase_invoices(company_id, invoice_date DESC);
CREATE INDEX idx_purchase_inv_supplier ON purchase_invoices(company_id, supplier_id);
CREATE INDEX idx_purchase_inv_status ON purchase_invoices(company_id, document_status);

CREATE TABLE purchase_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  fabric_roll_id uuid REFERENCES fabric_rolls(id) ON DELETE SET NULL,
  fabric_item_id uuid REFERENCES fabric_items(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES fabric_item_variants(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric(14,3) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'meter' CHECK (unit IN ('meter', 'yard')),
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  line_discount numeric(14,2) NOT NULL DEFAULT 0,
  line_tax numeric(14,2) NOT NULL DEFAULT 0,
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_inv_lines_invoice_line UNIQUE (invoice_id, line_no),
  CONSTRAINT purchase_inv_lines_qty_chk CHECK (quantity >= 0)
);

CREATE INDEX idx_purchase_inv_lines_invoice ON purchase_invoice_lines(invoice_id);
CREATE INDEX idx_purchase_inv_lines_roll ON purchase_invoice_lines(company_id, fabric_roll_id)
  WHERE fabric_roll_id IS NOT NULL;

-- C) Seed GL accounts for invoice posting (existing companies) — idempotent per company
INSERT INTO gl_accounts (company_id, code, name, account_type, parent_id, is_posting, system_key, sort_order)
SELECT c.id, '1130', 'مخزون الأقمشة', 'ASSET',
  (SELECT id FROM gl_accounts p WHERE p.company_id = c.id AND p.code = '11' LIMIT 1),
  true, 'GL_INVENTORY', 36
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM gl_accounts g WHERE g.company_id = c.id AND g.system_key = 'GL_INVENTORY'
);

INSERT INTO gl_accounts (company_id, code, name, account_type, parent_id, is_posting, system_key, sort_order)
SELECT c.id, '4001', 'إيرادات مبيعات أقمشة', 'REVENUE',
  (SELECT id FROM gl_accounts p WHERE p.company_id = c.id AND p.code = '4' LIMIT 1),
  true, 'GL_SALES_REVENUE', 106
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM gl_accounts g WHERE g.company_id = c.id AND g.system_key = 'GL_SALES_REVENUE'
);

INSERT INTO gl_accounts (company_id, code, name, account_type, parent_id, is_posting, system_key, sort_order)
SELECT c.id, '5131', 'تكلفة البضاعة المباعة', 'EXPENSE',
  (SELECT id FROM gl_accounts p WHERE p.company_id = c.id AND p.code = '5' LIMIT 1),
  true, 'GL_COGS', 131
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM gl_accounts g WHERE g.company_id = c.id AND g.system_key = 'GL_COGS'
);
