-- Voucher business purpose (advance / refund / compensation) on AR-AP simple model.
-- Does not change GL accounts; purpose is for classification, statements, and printing.

ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'INVOICE_PAYMENT';

UPDATE vouchers
SET purpose = 'INVOICE_PAYMENT'
WHERE purpose IS NULL OR trim(purpose) = '';

ALTER TABLE vouchers DROP CONSTRAINT IF EXISTS vouchers_purpose_chk;
ALTER TABLE vouchers
  ADD CONSTRAINT vouchers_purpose_chk CHECK (
    purpose IN ('INVOICE_PAYMENT', 'ADVANCE', 'ADVANCE_REFUND', 'COMPENSATION', 'OTHER')
  );

CREATE INDEX IF NOT EXISTS idx_vouchers_company_purpose
  ON vouchers(company_id, purpose);
