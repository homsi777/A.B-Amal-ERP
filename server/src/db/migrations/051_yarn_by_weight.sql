-- بيع/شراء الخيط بالوزن (كج) — نظام موازٍ لنظام القماش بالمتر، إضافي بالكامل.
-- لا تعديل على أي جدول/منطق خاص بالتوب (fabric_rolls) — كل شيء هنا جديد.

-- 1) توسعة قيود الوحدة الأربعة لقبول 'kg' جنب 'meter'/'yard' الحاليين.
ALTER TABLE sales_invoice_lines DROP CONSTRAINT IF EXISTS sales_invoice_lines_unit_check;
ALTER TABLE sales_invoice_lines
  ADD CONSTRAINT sales_invoice_lines_unit_check CHECK (unit IN ('meter', 'yard', 'kg'));

ALTER TABLE purchase_invoice_lines DROP CONSTRAINT IF EXISTS purchase_invoice_lines_unit_check;
ALTER TABLE purchase_invoice_lines
  ADD CONSTRAINT purchase_invoice_lines_unit_check CHECK (unit IN ('meter', 'yard', 'kg'));

ALTER TABLE return_invoice_lines DROP CONSTRAINT IF EXISTS return_invoice_lines_unit_chk;
ALTER TABLE return_invoice_lines
  ADD CONSTRAINT return_invoice_lines_unit_chk CHECK (unit IN ('meter', 'yard', 'kg'));

ALTER TABLE customer_order_lines DROP CONSTRAINT IF EXISTS customer_order_lines_unit_type_check;
ALTER TABLE customer_order_lines
  ADD CONSTRAINT customer_order_lines_unit_type_check CHECK (unit_type IN ('meter', 'yard', 'kg'));

-- 2) دفعات الخيط (مواز لـ fabric_rolls، أعمدة عامة فقط — بدون عرض/GSM/متغيرات
--    لون خاصة بالقماش). الوزن (weight_kg) هو الكمية الأساسية المتناقصة، تماماً
--    كما أن length_m هي الكمية الأساسية على التوب.
CREATE TABLE IF NOT EXISTS yarn_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lot_no text,
  barcode text NOT NULL,
  item_id uuid NOT NULL REFERENCES fabric_items(id),
  color_id uuid REFERENCES fabric_colors(id),
  supplier_id uuid REFERENCES suppliers(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  location_id uuid REFERENCES warehouse_locations(id),
  weight_kg numeric(12,3) NOT NULL CHECK (weight_kg >= 0),
  unit_cost numeric(14,4),
  currency_code text NOT NULL DEFAULT 'USD',
  batch_no text,
  container_no text,
  purchase_invoice_id uuid REFERENCES purchase_invoices(id),
  purchase_invoice_line_id uuid REFERENCES purchase_invoice_lines(id),
  status text NOT NULL DEFAULT 'AVAILABLE'
    CHECK (status IN ('AVAILABLE','RESERVED','SOLD','DAMAGED','TRANSFERRED','INACTIVE')),
  notes text,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, barcode)
);

CREATE INDEX IF NOT EXISTS idx_yarn_lots_company ON yarn_lots(company_id);
CREATE INDEX IF NOT EXISTS idx_yarn_lots_item ON yarn_lots(company_id, item_id);
CREATE INDEX IF NOT EXISTS idx_yarn_lots_status ON yarn_lots(company_id, status);
CREATE INDEX IF NOT EXISTS idx_yarn_lots_warehouse ON yarn_lots(company_id, warehouse_id);

-- 3) حركات دفعات الخيط (مواز مصغّر لـ inventory_movements، بالوزن فقط،
--    مرتبط بـ yarn_lots لا fabric_rolls).
CREATE TABLE IF NOT EXISTS yarn_lot_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  yarn_lot_id uuid NOT NULL REFERENCES yarn_lots(id) ON DELETE CASCADE,
  movement_type text NOT NULL,
  weight_delta_kg numeric(12,3) NOT NULL,
  from_warehouse_id uuid REFERENCES warehouses(id),
  to_warehouse_id uuid REFERENCES warehouses(id),
  reference_type text,
  reference_id uuid,
  notes text,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yarn_lot_movements_lot ON yarn_lot_movements(yarn_lot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_yarn_lot_movements_company ON yarn_lot_movements(company_id, created_at DESC);
