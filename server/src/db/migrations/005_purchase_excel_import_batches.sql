-- Phase 4: Excel Import Batches
-- Two-stage import: preview rows first, create fabric_rolls only on confirmation

-- ─────────────────────────────────────────────────────────────────────────────
-- purchase_import_batches: one row per uploaded Excel file
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE purchase_import_batches (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id               uuid        REFERENCES suppliers(id),
  warehouse_id              uuid        REFERENCES warehouses(id),
  default_location_id       uuid        REFERENCES warehouse_locations(id),
  file_name                 text        NOT NULL,
  file_size_bytes           bigint,
  sheet_name                text,
  status                    text        NOT NULL DEFAULT 'PREVIEW'
                                        CHECK (status IN ('PREVIEW','VALIDATED','CONFIRMED','FAILED','CANCELLED')),
  row_count                 integer     NOT NULL DEFAULT 0,
  valid_count               integer     NOT NULL DEFAULT 0,
  warning_count             integer     NOT NULL DEFAULT 0,
  error_count               integer     NOT NULL DEFAULT 0,
  created_roll_count        integer     NOT NULL DEFAULT 0,
  created_item_count        integer     NOT NULL DEFAULT 0,
  created_color_count       integer     NOT NULL DEFAULT 0,
  created_variant_count     integer     NOT NULL DEFAULT 0,
  total_length_m            numeric(14,3) NOT NULL DEFAULT 0,
  total_actual_weight_kg    numeric(14,3) NOT NULL DEFAULT 0,
  total_calculated_weight_kg numeric(14,3) NOT NULL DEFAULT 0,
  currency_code             text        REFERENCES currencies(code),
  import_mode               text        NOT NULL DEFAULT 'MATCH_ONLY'
                                        CHECK (import_mode IN ('MATCH_ONLY','CREATE_MISSING_MASTER_DATA')),
  notes                     text,
  created_by_user_id        uuid        REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by_user_id      uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  confirmed_at              timestamptz,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_batches_company   ON purchase_import_batches(company_id);
CREATE INDEX idx_import_batches_status    ON purchase_import_batches(company_id, status);
CREATE INDEX idx_import_batches_created   ON purchase_import_batches(created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- purchase_import_rows: one row per Excel data row
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE purchase_import_rows (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  batch_id            uuid        NOT NULL REFERENCES purchase_import_batches(id) ON DELETE CASCADE,
  row_no              integer     NOT NULL,
  raw_data            jsonb       NOT NULL DEFAULT '{}',
  normalized_data     jsonb       NOT NULL DEFAULT '{}',
  status              text        NOT NULL DEFAULT 'PENDING'
                                  CHECK (status IN ('PENDING','VALID','WARNING','ERROR','IMPORTED','SKIPPED')),
  errors              jsonb       NOT NULL DEFAULT '[]',
  warnings            jsonb       NOT NULL DEFAULT '[]',
  matched_item_id     uuid        REFERENCES fabric_items(id),
  matched_color_id    uuid        REFERENCES fabric_colors(id),
  matched_variant_id  uuid        REFERENCES fabric_item_variants(id),
  created_roll_id     uuid        REFERENCES fabric_rolls(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_rows_batch        ON purchase_import_rows(batch_id);
CREATE INDEX idx_import_rows_company      ON purchase_import_rows(company_id);
CREATE INDEX idx_import_rows_status       ON purchase_import_rows(batch_id, status);
CREATE INDEX idx_import_rows_no           ON purchase_import_rows(batch_id, row_no);
CREATE INDEX idx_import_rows_item         ON purchase_import_rows(matched_item_id) WHERE matched_item_id IS NOT NULL;
CREATE INDEX idx_import_rows_color        ON purchase_import_rows(matched_color_id) WHERE matched_color_id IS NOT NULL;
CREATE INDEX idx_import_rows_roll         ON purchase_import_rows(created_roll_id) WHERE created_roll_id IS NOT NULL;
