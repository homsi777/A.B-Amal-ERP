-- Phase 3: Fabric Rolls Inventory Engine
-- Creates fabric_rolls and inventory_movements tables

-- ─────────────────────────────────────────────────────────────────────────────
-- fabric_rolls: each row is one physical bolt / roll / tube of fabric
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE fabric_rolls (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES companies(id)          ON DELETE CASCADE,
  roll_no              text,
  barcode              text        NOT NULL,
  item_id              uuid        NOT NULL REFERENCES fabric_items(id),
  color_id             uuid        REFERENCES fabric_colors(id),
  variant_id           uuid        REFERENCES fabric_item_variants(id),
  supplier_id          uuid        REFERENCES suppliers(id),
  warehouse_id         uuid        NOT NULL REFERENCES warehouses(id),
  location_id          uuid        REFERENCES warehouse_locations(id),
  length_m             numeric(14,3) NOT NULL DEFAULT 0   CHECK (length_m >= 0),
  width_cm             numeric(14,2)           CHECK (width_cm  > 0),
  gsm                  numeric(14,2)           CHECK (gsm       > 0),
  calculated_weight_kg numeric(14,3)           CHECK (calculated_weight_kg >= 0),
  actual_weight_kg     numeric(14,3)           CHECK (actual_weight_kg     >= 0),
  unit_cost            numeric(14,4)           CHECK (unit_cost >= 0),
  currency_code        text        REFERENCES currencies(code),
  batch_no             text,
  container_no         text,
  purchase_invoice_no  text,
  supplier_roll_ref    text,
  status               text        NOT NULL DEFAULT 'AVAILABLE'
                                   CHECK (status IN ('AVAILABLE','RESERVED','SOLD',
                                                     'DAMAGED','TRANSFERRED','INACTIVE')),
  notes                text,
  created_by_user_id   uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, barcode)
);

CREATE INDEX idx_rolls_company      ON fabric_rolls(company_id);
CREATE INDEX idx_rolls_barcode      ON fabric_rolls(company_id, barcode);
CREATE INDEX idx_rolls_item         ON fabric_rolls(item_id);
CREATE INDEX idx_rolls_color        ON fabric_rolls(color_id);
CREATE INDEX idx_rolls_variant      ON fabric_rolls(variant_id);
CREATE INDEX idx_rolls_supplier     ON fabric_rolls(supplier_id);
CREATE INDEX idx_rolls_warehouse    ON fabric_rolls(warehouse_id);
CREATE INDEX idx_rolls_location     ON fabric_rolls(location_id);
CREATE INDEX idx_rolls_status       ON fabric_rolls(company_id, status);
CREATE INDEX idx_rolls_created_at   ON fabric_rolls(created_at);
CREATE INDEX idx_rolls_batch        ON fabric_rolls(company_id, batch_no) WHERE batch_no IS NOT NULL;
CREATE INDEX idx_rolls_container    ON fabric_rolls(company_id, container_no) WHERE container_no IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- inventory_movements: immutable audit trail for every roll state change
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE inventory_movements (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  roll_id             uuid        NOT NULL REFERENCES fabric_rolls(id) ON DELETE CASCADE,
  movement_type       text        NOT NULL
                                  CHECK (movement_type IN (
                                    'OPENING','PURCHASE_RECEIPT','MANUAL_CREATE',
                                    'TRANSFER_OUT','TRANSFER_IN',
                                    'RESERVE','RELEASE_RESERVATION',
                                    'SALE','RETURN',
                                    'ADJUSTMENT','DAMAGE','STATUS_CHANGE'
                                  )),
  from_warehouse_id   uuid        REFERENCES warehouses(id),
  to_warehouse_id     uuid        REFERENCES warehouses(id),
  from_location_id    uuid        REFERENCES warehouse_locations(id),
  to_location_id      uuid        REFERENCES warehouse_locations(id),
  old_status          text,
  new_status          text,
  length_delta_m      numeric(14,3),
  weight_delta_kg     numeric(14,3),
  reference_type      text,
  reference_id        uuid,
  reference_no        text,
  notes               text,
  created_by_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_movements_company    ON inventory_movements(company_id);
CREATE INDEX idx_movements_roll       ON inventory_movements(roll_id);
CREATE INDEX idx_movements_type       ON inventory_movements(movement_type);
CREATE INDEX idx_movements_created    ON inventory_movements(created_at);
CREATE INDEX idx_movements_ref        ON inventory_movements(reference_type, reference_id)
                                       WHERE reference_type IS NOT NULL;
CREATE INDEX idx_movements_from_wh    ON inventory_movements(from_warehouse_id)
                                       WHERE from_warehouse_id IS NOT NULL;
CREATE INDEX idx_movements_to_wh      ON inventory_movements(to_warehouse_id)
                                       WHERE to_warehouse_id IS NOT NULL;
