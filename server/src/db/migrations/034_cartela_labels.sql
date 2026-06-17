-- Cartela labels: standalone promotional fabric labels (no inventory FKs).

CREATE TABLE cartela_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  art_code text NOT NULL DEFAULT '',
  design_no text NOT NULL DEFAULT '',
  colour text NOT NULL DEFAULT '',
  width_value text NOT NULL DEFAULT '',
  width_unit text NOT NULL DEFAULT 'cm',
  width_tolerance_enabled boolean NOT NULL DEFAULT true,
  width_tolerance_percent numeric(5,2) NOT NULL DEFAULT 3,
  weight_value text NOT NULL DEFAULT '',
  weight_unit text NOT NULL DEFAULT 'gr/m²',
  weight_tolerance_enabled boolean NOT NULL DEFAULT true,
  weight_tolerance_percent numeric(5,2) NOT NULL DEFAULT 5,
  composition text NOT NULL DEFAULT '',
  serial_no text NOT NULL DEFAULT '',
  show_logo boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cartela_labels_company ON cartela_labels(company_id, updated_at DESC);
CREATE INDEX idx_cartela_labels_company_art ON cartela_labels(company_id, art_code);
