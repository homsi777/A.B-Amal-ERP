-- حقول "رقم التصميم" و"كود التصميم" الحقيقيين على الخامة — مستقلة تماماً عن
-- internal_code (كود الخامة الداخلي بالمستودع) وsupplier_code. الكارتيله
-- تسحب ART CODE/DESIGN NO من هذين الحقلين فقط، ولا تنسخهما من كود الخامة.
ALTER TABLE fabric_items
  ADD COLUMN design_code text NOT NULL DEFAULT '',
  ADD COLUMN design_no text NOT NULL DEFAULT '';
