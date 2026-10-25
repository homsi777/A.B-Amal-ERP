-- مواصفات الكارتيله (التركيب، العرض، الوزن، رموز العناية) تُضاف لسجل الخامة
-- نفسها — تُدخَل مرة واحدة (أول كارتيله لهذه الخامة) وتُسحَب تلقائياً لكل
-- كارتيله تالية لنفس الخامة، بدل تكرار إدخالها يدوياً كل مرة. اختيارية
-- بالكامل، لا تؤثر على أي خامة قديمة أو شاشة إنشاء مادة موجودة.
ALTER TABLE fabric_items
  ADD COLUMN composition_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN care_symbols jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN width_value text NOT NULL DEFAULT '',
  ADD COLUMN width_unit text NOT NULL DEFAULT 'cm',
  ADD COLUMN width_tolerance_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN width_tolerance_percent numeric(5,2) DEFAULT 3,
  ADD COLUMN weight_value text NOT NULL DEFAULT '',
  ADD COLUMN weight_unit text NOT NULL DEFAULT 'gr/m²',
  ADD COLUMN weight_tolerance_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN weight_tolerance_percent numeric(5,2) DEFAULT 5;

-- ربط فعلي بقاعدة البيانات بين الكارتيله والخامة الحقيقية (وفاريانتها/لونها
-- عند وجوده) — بدل الاعتماد على تطابق نص كود التصميم. كارتيله واحدة = خامة
-- واحدة + فاريانت واحد على الأكثر. سجلات الكارتيله القديمة (قبل هذا الملف)
-- تبقى بدون ربط (fabric_item_id = NULL) دون أي تغيير عليها إطلاقاً — واجهة
-- الإنشاء القديمة بالنص الحر تبقى صالحة لعرض/تعديل تلك السجلات فقط.
ALTER TABLE cartela_labels
  ADD COLUMN fabric_item_id uuid REFERENCES fabric_items(id),
  ADD COLUMN fabric_variant_id uuid REFERENCES fabric_item_variants(id),
  ADD COLUMN barcode_code text;

CREATE INDEX idx_cartela_labels_fabric_item ON cartela_labels(fabric_item_id) WHERE fabric_item_id IS NOT NULL;
CREATE UNIQUE INDEX uq_cartela_labels_barcode ON cartela_labels(company_id, barcode_code) WHERE barcode_code IS NOT NULL;
-- كارتيله واحدة فقط لكل فاريانت (لون) محدَّد — يمنع تكرار نفس اللون بعدة
-- كارتيلات منفصلة لنفس الخامة.
CREATE UNIQUE INDEX uq_cartela_labels_variant ON cartela_labels(fabric_variant_id) WHERE fabric_variant_id IS NOT NULL;
