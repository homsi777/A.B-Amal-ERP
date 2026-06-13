-- السماح بقيد تكاليف استيراد Excel في دفتر اليومية

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_chk;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_chk CHECK (source_type IN (
  'VOUCHER', 'VOUCHER_REVERSAL', 'RETURN_INVOICE', 'RETURN_INVOICE_REVERSAL',
  'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT', 'PAYROLL_REVERSAL', 'MANUAL', 'OPENING', 'SYSTEM',
  'SALES_INVOICE', 'SALES_INVOICE_REVERSAL',
  'PURCHASE_INVOICE', 'PURCHASE_INVOICE_REVERSAL',
  'IMPORT_LANDING_COST'
));

DROP INDEX IF EXISTS idx_journal_entries_source_doc;
CREATE UNIQUE INDEX idx_journal_entries_source_doc ON journal_entries(company_id, source_type, source_id)
  WHERE source_id IS NOT NULL
  AND source_type IN (
    'VOUCHER', 'RETURN_INVOICE', 'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT',
    'SALES_INVOICE', 'PURCHASE_INVOICE', 'IMPORT_LANDING_COST'
  );
