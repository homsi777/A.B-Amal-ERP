-- Telegram messaging foundation: per-party chat IDs and delivery audit log.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS telegram_chat_id text,
  ADD COLUMN IF NOT EXISTS telegram_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telegram_label text;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS telegram_chat_id text,
  ADD COLUMN IF NOT EXISTS telegram_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telegram_label text;

CREATE INDEX IF NOT EXISTS idx_customers_telegram_chat
  ON customers(company_id, telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_telegram_chat
  ON suppliers(company_id, telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS telegram_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('customer','supplier','system')),
  party_id uuid,
  chat_id text,
  document_type text NOT NULL,
  document_id text,
  status text NOT NULL CHECK (status IN ('queued','sent','failed')),
  message_preview text,
  pdf_file_name text,
  error_message text,
  telegram_message_id text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_delivery_logs_company
  ON telegram_delivery_logs(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telegram_delivery_logs_party
  ON telegram_delivery_logs(company_id, party_type, party_id, created_at DESC);
