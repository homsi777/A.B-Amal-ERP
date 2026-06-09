-- Dedicated Telegram bot settings, chat identity links, and update cache.

CREATE TABLE IF NOT EXISTS telegram_bot_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bot_token_encrypted text NOT NULL,
  bot_username text,
  bot_name text,
  is_enabled boolean NOT NULL DEFAULT false,
  last_updates_offset bigint,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);

CREATE TABLE IF NOT EXISTS telegram_chat_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  telegram_user_id text,
  telegram_username text,
  telegram_first_name text,
  telegram_last_name text,
  telegram_display_name text,
  chat_type text,
  target_type text NOT NULL CHECK (target_type IN ('USER','CUSTOMER','SUPPLIER','EMPLOYEE','OTHER')),
  target_id uuid,
  target_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  can_receive_invoices boolean NOT NULL DEFAULT true,
  can_receive_vouchers boolean NOT NULL DEFAULT true,
  can_receive_reports boolean NOT NULL DEFAULT false,
  can_receive_alerts boolean NOT NULL DEFAULT true,
  notes text,
  linked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, chat_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_chat_links_target_active
  ON telegram_chat_links(company_id, target_type, target_id)
  WHERE target_id IS NOT NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_telegram_chat_links_company
  ON telegram_chat_links(company_id, is_active, target_type, target_name);

CREATE TABLE IF NOT EXISTS telegram_update_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  update_id bigint NOT NULL,
  chat_id text NOT NULL,
  telegram_user_id text,
  telegram_username text,
  first_name text,
  last_name text,
  chat_type text,
  message_text text,
  received_at timestamptz,
  raw_update jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, update_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_update_cache_chat
  ON telegram_update_cache(company_id, chat_id, update_id DESC);

ALTER TABLE telegram_delivery_logs
  ADD COLUMN IF NOT EXISTS chat_link_id uuid REFERENCES telegram_chat_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_type text,
  ADD COLUMN IF NOT EXISTS target_id uuid,
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS message_text text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

ALTER TABLE telegram_delivery_logs
  DROP CONSTRAINT IF EXISTS telegram_delivery_logs_status_check,
  ADD CONSTRAINT telegram_delivery_logs_status_check
    CHECK (status IN ('PENDING','SENT','FAILED','queued','sent','failed'));

ALTER TABLE telegram_delivery_logs
  DROP CONSTRAINT IF EXISTS telegram_delivery_logs_party_type_check,
  ADD CONSTRAINT telegram_delivery_logs_party_type_check
    CHECK (party_type IN ('customer','supplier','user','employee','other','system'));
