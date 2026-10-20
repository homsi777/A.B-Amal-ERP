-- "مصنعية" (Processing / Fason) dispatch flow — extends the existing External Jobs
-- module (055) with a second job_kind instead of a parallel module. GENERAL jobs
-- are untouched; existing rows default to job_kind='GENERAL'.

-- Warehouse stage (raw / finished). Existing warehouses stay NULL until classified
-- in the UI — no auto-classification.
ALTER TABLE warehouses ADD COLUMN fabric_stage text;
ALTER TABLE warehouses ADD CONSTRAINT warehouses_fabric_stage_check
  CHECK (fabric_stage IS NULL OR fabric_stage IN ('RAW', 'FINISHED'));

-- Processing party flag on suppliers (no separate party table).
ALTER TABLE suppliers ADD COLUMN is_processing_party boolean NOT NULL DEFAULT false;

-- Preparation types, separate per company.
CREATE TABLE external_job_preparation_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  default_waste_pct numeric(5,2)
    CHECK (default_waste_pct IS NULL OR (default_waste_pct >= 0 AND default_waste_pct <= 100)),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_ej_prep_types_company_name
  ON external_job_preparation_types (company_id, lower(name));

CREATE INDEX idx_ej_prep_types_company ON external_job_preparation_types(company_id);

-- Extend external_jobs with the processing-specific columns. All are nullable at
-- the column level (GENERAL jobs never set them); the CHECK below enforces them
-- as required together whenever job_kind='PROCESSING'.
ALTER TABLE external_jobs
  ADD COLUMN job_kind text NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN fabric_stage text,
  ADD COLUMN preparation_type_id uuid REFERENCES external_job_preparation_types(id),
  ADD COLUMN source_warehouse_id uuid REFERENCES warehouses(id),
  ADD COLUMN supplier_order_no integer,
  ADD COLUMN process_description text;

ALTER TABLE external_jobs ADD CONSTRAINT external_jobs_kind_check
  CHECK (job_kind IN ('GENERAL', 'PROCESSING'));

ALTER TABLE external_jobs ADD CONSTRAINT external_jobs_stage_check
  CHECK (fabric_stage IS NULL OR fabric_stage IN ('RAW', 'FINISHED'));

ALTER TABLE external_jobs ADD CONSTRAINT external_jobs_processing_required_check
  CHECK (job_kind = 'GENERAL' OR (
    fabric_stage IS NOT NULL AND preparation_type_id IS NOT NULL
    AND source_warehouse_id IS NOT NULL AND supplier_order_no IS NOT NULL
  ));

-- Per-party order number, unique per (company, supplier). Voided jobs keep their
-- number — numbers are never reused, so the partial index only needs to exclude
-- NULL (GENERAL jobs), not VOIDED.
CREATE UNIQUE INDEX uq_ej_supplier_order
  ON external_jobs (company_id, supplier_id, supplier_order_no)
  WHERE supplier_order_no IS NOT NULL;

CREATE INDEX idx_ej_job_kind ON external_jobs(company_id, job_kind);
