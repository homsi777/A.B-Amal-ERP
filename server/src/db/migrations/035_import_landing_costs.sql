-- تكاليف استيراد فاتورة الشراء (شحن، جمارك، تخليص، ...) + التكلفة النهائية للمتر

ALTER TABLE purchase_import_batches
  ADD COLUMN IF NOT EXISTS purchase_base_unit_price numeric(18,6),
  ADD COLUMN IF NOT EXISTS freight_cost numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customs_cost numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clearance_cost numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS internal_shipping_cost numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_cost numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS landing_cost_total numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_unit_cost numeric(18,6);
