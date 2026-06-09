-- Adds optional verification fields for purchase import scanning workflow

ALTER TABLE purchase_import_rows
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_import_rows_verified
  ON purchase_import_rows(batch_id, verified_at);

