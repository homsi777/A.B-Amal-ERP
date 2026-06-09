CREATE TABLE IF NOT EXISTS activation_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL REFERENCES companies(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  key_suffix text NOT NULL,
  status text NOT NULL DEFAULT 'UNUSED',
  plan_code text NOT NULL DEFAULT 'FULL',
  max_activations integer NOT NULL DEFAULT 1,
  activation_count integer NOT NULL DEFAULT 0,
  activated_company_id uuid NULL REFERENCES companies(id),
  activated_by_user_id uuid NULL REFERENCES users(id),
  activated_at timestamptz NULL,
  expires_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_activation_keys_status CHECK (status IN ('UNUSED', 'USED', 'REVOKED')),
  CONSTRAINT chk_activation_keys_plan_code CHECK (plan_code IN ('LITE', 'PRO', 'FULL')),
  CONSTRAINT chk_activation_keys_counts CHECK (
    max_activations > 0
    AND activation_count >= 0
    AND activation_count <= max_activations
  )
);

CREATE INDEX IF NOT EXISTS idx_activation_keys_status
  ON activation_keys(status, plan_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activation_keys_company
  ON activation_keys(company_id, status);

CREATE TABLE IF NOT EXISTS activation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL REFERENCES companies(id),
  activation_key_id uuid NULL REFERENCES activation_keys(id),
  event_type text NOT NULL,
  key_suffix text NULL,
  ip_address text NULL,
  user_agent text NULL,
  message text NULL,
  created_by_user_id uuid NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_activation_events_type CHECK (
    event_type IN (
      'ACTIVATION_SUCCESS',
      'ACTIVATION_FAILED',
      'DUPLICATE_ATTEMPT',
      'REVOKED_ATTEMPT'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_activation_events_company
  ON activation_events(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activation_events_key
  ON activation_events(activation_key_id, created_at DESC);
