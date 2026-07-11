-- Landed cost (التكلفة المستلمة) for purchase Excel import batches.
-- Capitalizes goods value + shipping/customs/other into fabric_rolls.unit_cost and purchase invoice totals.

ALTER TABLE purchase_import_batches
  ADD COLUMN IF NOT EXISTS goods_value numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cost numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customs_cost numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_cost_1 numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_cost_2 numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipment_weight_kg numeric(14,3),
  ADD COLUMN IF NOT EXISTS total_landed_cost numeric(18,4),
  ADD COLUMN IF NOT EXISTS landed_cost_per_meter numeric(18,6),
  ADD COLUMN IF NOT EXISTS landed_cost_configured_at timestamptz;

COMMENT ON COLUMN purchase_import_batches.goods_value IS 'قيمة البضاعة من فاتورة المورد (أساس التكلفة)';
COMMENT ON COLUMN purchase_import_batches.shipping_cost IS 'أجور الشحن المُحمّلة على المخزون';
COMMENT ON COLUMN purchase_import_batches.customs_cost IS 'الجمارك المُحمّلة على المخزون';
COMMENT ON COLUMN purchase_import_batches.other_cost_1 IS 'مصاريف إضافية 1';
COMMENT ON COLUMN purchase_import_batches.other_cost_2 IS 'مصاريف إضافية 2';
COMMENT ON COLUMN purchase_import_batches.shipment_weight_kg IS 'الوزن الإجمالي للشحنة (إدخال يدوي عند غياب الوزن في Excel)';
COMMENT ON COLUMN purchase_import_batches.total_landed_cost IS 'إجمالي التكلفة المستلمة بعد جمع البضاعة والمصاريف';
COMMENT ON COLUMN purchase_import_batches.landed_cost_per_meter IS 'تكلفة المتر النهائية الموزّعة على الأتواب';
