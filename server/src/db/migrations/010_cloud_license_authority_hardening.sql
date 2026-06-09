ALTER TABLE activation_keys
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS revoked_by_user_id uuid NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz NULL;

ALTER TABLE activation_keys
  DROP CONSTRAINT IF EXISTS chk_activation_keys_status;

ALTER TABLE activation_keys
  ADD CONSTRAINT chk_activation_keys_status
  CHECK (status IN ('UNUSED', 'USED', 'REVOKED', 'EXPIRED'));

ALTER TABLE activation_events
  ADD COLUMN IF NOT EXISTS device_fingerprint text NULL,
  ADD COLUMN IF NOT EXISTS app_version text NULL;

ALTER TABLE activation_events
  DROP CONSTRAINT IF EXISTS chk_activation_events_type;

ALTER TABLE activation_events
  ADD CONSTRAINT chk_activation_events_type
  CHECK (
    event_type IN (
      'KEY_GENERATED',
      'ACTIVATION_SUCCESS',
      'ACTIVATION_FAILED',
      'DUPLICATE_ATTEMPT',
      'REVOKED_ATTEMPT',
      'EXPIRED_ATTEMPT',
      'KEY_REVOKED',
      'STATUS_CHECK'
    )
  );

CREATE TABLE IF NOT EXISTS activation_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL REFERENCES companies(id),
  activation_key_id uuid NULL REFERENCES activation_keys(id),
  device_fingerprint text NOT NULL,
  device_name text NULL,
  os_info text NULL,
  app_version text NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (activation_key_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_activation_devices_company
  ON activation_devices(company_id, is_active, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_activation_events_type
  ON activation_events(event_type, created_at DESC);
