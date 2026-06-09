-- Inventory transfers + waste/depreciation (توالف) — cloud MVP foundation

-- ─────────────────────────────────────────────────────────────────────────────
-- A. inventory_transfers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE inventory_transfers (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  transfer_no          text        NOT NULL,
  transfer_date        date        NOT NULL DEFAULT CURRENT_DATE,
  from_warehouse_id    uuid        NOT NULL REFERENCES warehouses(id),
  from_location_id     uuid        REFERENCES warehouse_locations(id),
  to_warehouse_id      uuid        NOT NULL REFERENCES warehouses(id),
  to_location_id       uuid        REFERENCES warehouse_locations(id),
  status               text        NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED')),
  notes                text,
  confirmed_at         timestamptz,
  cancelled_at         timestamptz,
  created_by_user_id   uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, transfer_no)
);

CREATE INDEX idx_inv_transfers_company ON inventory_transfers(company_id);
CREATE INDEX idx_inv_transfers_date ON inventory_transfers(company_id, transfer_date DESC);
CREATE INDEX idx_inv_transfers_status ON inventory_transfers(company_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- B. inventory_transfer_lines
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE inventory_transfer_lines (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  transfer_id          uuid        NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
  fabric_roll_id       uuid        NOT NULL REFERENCES fabric_rolls(id),
  barcode              text,
  quantity             numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notes                text,
  UNIQUE (company_id, transfer_id, fabric_roll_id)
);

CREATE INDEX idx_inv_transfer_lines_company ON inventory_transfer_lines(company_id);
CREATE INDEX idx_inv_transfer_lines_roll ON inventory_transfer_lines(fabric_roll_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. inventory_waste_records
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE inventory_waste_records (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  waste_no             text        NOT NULL,
  waste_date           date        NOT NULL DEFAULT CURRENT_DATE,
  waste_type           text        NOT NULL DEFAULT 'DAMAGE'
                         CHECK (waste_type IN (
                           'DAMAGE', 'SHORTAGE', 'CUTTING_WASTE', 'QUALITY_REJECT', 'LOST', 'OTHER'
                         )),
  warehouse_id         uuid        REFERENCES warehouses(id),
  location_id          uuid        REFERENCES warehouse_locations(id),
  status               text        NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED')),
  reason               text,
  notes                text,
  confirmed_at         timestamptz,
  cancelled_at         timestamptz,
  created_by_user_id   uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, waste_no)
);

CREATE INDEX idx_inv_waste_company ON inventory_waste_records(company_id);
CREATE INDEX idx_inv_waste_date ON inventory_waste_records(company_id, waste_date DESC);
CREATE INDEX idx_inv_waste_status ON inventory_waste_records(company_id, status);
CREATE INDEX idx_inv_waste_wh ON inventory_waste_records(company_id, warehouse_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- D. inventory_waste_lines
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE inventory_waste_lines (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  waste_id             uuid        NOT NULL REFERENCES inventory_waste_records(id) ON DELETE CASCADE,
  fabric_roll_id       uuid        NOT NULL REFERENCES fabric_rolls(id),
  barcode              text,
  quantity             numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  waste_length_m       numeric(14,3),
  waste_weight_kg      numeric(14,3),
  notes                text,
  UNIQUE (company_id, waste_id, fabric_roll_id)
);

CREATE INDEX idx_inv_waste_lines_company ON inventory_waste_lines(company_id);
CREATE INDEX idx_inv_waste_lines_roll ON inventory_waste_lines(fabric_roll_id);
