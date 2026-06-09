-- Optional link from treasury vouchers to originating documents (e.g. fabric invoice no / local id)

ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS reference_document_type text,
  ADD COLUMN IF NOT EXISTS reference_document_no text;

CREATE INDEX IF NOT EXISTS idx_vouchers_company_ref_no
  ON vouchers(company_id, reference_document_type, reference_document_no)
  WHERE reference_document_no IS NOT NULL AND reference_document_no <> '';
