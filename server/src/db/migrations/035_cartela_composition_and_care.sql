-- Cartela: fiber type master list + structured composition + selectable care symbols.

CREATE TABLE cartela_fiber_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cartela_fiber_types_company_name UNIQUE (company_id, name_en)
);

CREATE INDEX idx_cartela_fiber_types_company ON cartela_fiber_types(company_id, sort_order, name_en);

ALTER TABLE cartela_labels
  ADD COLUMN IF NOT EXISTS composition_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS care_symbols jsonb NOT NULL DEFAULT '[]'::jsonb;
