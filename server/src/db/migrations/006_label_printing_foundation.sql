-- Phase 5: Label Printing Foundation
-- Three tables for template management, print job tracking, and printed labels audit

-- ─────────────────────────────────────────────────────────────────────────────
-- label_templates: configurable label template definitions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE label_templates (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code                text        NOT NULL,
  name                text        NOT NULL,
  template_type       text        NOT NULL DEFAULT 'ROLL_LABEL'
                                  CHECK (template_type IN ('ROLL_LABEL','PALLET_LABEL','LOCATION_LABEL')),
  width_mm            numeric(10,2) NOT NULL DEFAULT 100,
  height_mm           numeric(10,2) NOT NULL DEFAULT 80,
  content_config      jsonb       NOT NULL DEFAULT '{}',
  is_default          boolean     NOT NULL DEFAULT false,
  is_active           boolean     NOT NULL DEFAULT true,
  created_by_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE INDEX idx_label_tmpl_company  ON label_templates(company_id, is_active);
CREATE INDEX idx_label_tmpl_default  ON label_templates(company_id, is_default) WHERE is_default = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- print_jobs: one record per user-initiated label print batch
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE print_jobs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_type            text        NOT NULL DEFAULT 'ROLL_LABELS',
  status              text        NOT NULL DEFAULT 'CREATED'
                                  CHECK (status IN ('CREATED','PREVIEWED','PRINTED','FAILED','CANCELLED')),
  template_id         uuid        REFERENCES label_templates(id) ON DELETE SET NULL,
  source_type         text
                                  CHECK (source_type IN ('ROLL_SELECTION','IMPORT_BATCH','SINGLE_ROLL') OR source_type IS NULL),
  source_id           uuid,
  roll_count          integer     NOT NULL DEFAULT 0,
  printed_count       integer     NOT NULL DEFAULT 0,
  failed_count        integer     NOT NULL DEFAULT 0,
  printer_name        text,
  page_size           text,
  notes               text,
  created_by_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  printed_at          timestamptz,
  error_message       text
);

CREATE INDEX idx_print_jobs_company   ON print_jobs(company_id, created_at DESC);
CREATE INDEX idx_print_jobs_status    ON print_jobs(company_id, status);
CREATE INDEX idx_print_jobs_source    ON print_jobs(source_type, source_id) WHERE source_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- printed_labels: audit trail of labels printed per roll
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE printed_labels (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  print_job_id        uuid        REFERENCES print_jobs(id) ON DELETE SET NULL,
  roll_id             uuid        NOT NULL REFERENCES fabric_rolls(id) ON DELETE CASCADE,
  barcode             text        NOT NULL,
  print_count         integer     NOT NULL DEFAULT 1,
  last_printed_at     timestamptz NOT NULL DEFAULT now(),
  printed_by_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  notes               text
);

CREATE INDEX idx_printed_labels_company   ON printed_labels(company_id);
CREATE INDEX idx_printed_labels_roll      ON printed_labels(roll_id);
CREATE INDEX idx_printed_labels_barcode   ON printed_labels(barcode);
CREATE INDEX idx_printed_labels_job       ON printed_labels(print_job_id) WHERE print_job_id IS NOT NULL;
