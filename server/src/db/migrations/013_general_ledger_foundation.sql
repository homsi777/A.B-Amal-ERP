-- General ledger: chart of accounts + journal entries + lines (double-entry)
-- source_type links operational documents to accounting entries.

CREATE TABLE gl_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  parent_id uuid REFERENCES gl_accounts(id) ON DELETE SET NULL,
  account_type text NOT NULL,
  is_posting boolean NOT NULL DEFAULT true,
  system_key text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_accounts_company_code UNIQUE (company_id, code),
  CONSTRAINT gl_accounts_type_chk CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'))
);

CREATE INDEX idx_gl_accounts_company ON gl_accounts(company_id);
CREATE INDEX idx_gl_accounts_company_parent ON gl_accounts(company_id, parent_id);
CREATE UNIQUE INDEX idx_gl_accounts_company_system_key ON gl_accounts(company_id, system_key) WHERE system_key IS NOT NULL;

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_no text NOT NULL,
  entry_date date NOT NULL DEFAULT (current_date),
  description text,
  source_type text NOT NULL,
  source_id uuid,
  status text NOT NULL DEFAULT 'POSTED',
  reversed_entry_id uuid REFERENCES journal_entries(id),
  created_by_user_id uuid REFERENCES users(id),
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_entries_company_entry_no UNIQUE (company_id, entry_no),
  CONSTRAINT journal_entries_status_chk CHECK (status IN ('DRAFT', 'POSTED', 'VOID')),
  CONSTRAINT journal_entries_source_chk CHECK (source_type IN (
    'VOUCHER', 'VOUCHER_REVERSAL', 'RETURN_INVOICE', 'RETURN_INVOICE_REVERSAL',
    'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT', 'PAYROLL_REVERSAL', 'MANUAL', 'OPENING', 'SYSTEM'
  ))
);

CREATE UNIQUE INDEX idx_journal_entries_source_doc ON journal_entries(company_id, source_type, source_id)
  WHERE source_id IS NOT NULL
  AND source_type IN ('VOUCHER', 'RETURN_INVOICE', 'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT');

CREATE INDEX idx_journal_entries_company_date ON journal_entries(company_id, entry_date DESC);
CREATE INDEX idx_journal_entries_company ON journal_entries(company_id);

CREATE TABLE journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  gl_account_id uuid NOT NULL REFERENCES gl_accounts(id),
  cashbox_id uuid REFERENCES cashboxes(id),
  party_type text,
  party_id uuid,
  description text,
  debit numeric(18,2) NOT NULL DEFAULT 0,
  credit numeric(18,2) NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'USD',
  CONSTRAINT journal_lines_entry_line UNIQUE (entry_id, line_no),
  CONSTRAINT journal_lines_party_chk CHECK (party_type IS NULL OR party_type IN ('CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER')),
  CONSTRAINT journal_lines_dc_chk CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
);

CREATE INDEX idx_journal_lines_company ON journal_lines(company_id);
CREATE INDEX idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(company_id, gl_account_id);
CREATE INDEX idx_journal_lines_party ON journal_lines(company_id, party_type, party_id);
