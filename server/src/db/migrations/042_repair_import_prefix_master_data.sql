-- إزالة رموز L1_/L2_/L3_/L4_ من بيانات الخامات والألوان (وليس التصنيفات فقط).
-- هذه القيم دخلت fabric_items / fabric_colors عند حفظ تعديل التوب قبل الإصلاح.

UPDATE fabric_items
SET internal_code = regexp_replace(btrim(internal_code), '^L[1-4]_', '', 'i'),
    updated_at = now()
WHERE internal_code ~* '^L[1-4]_';

UPDATE fabric_items
SET supplier_code = regexp_replace(btrim(supplier_code), '^L[1-4]_', '', 'i'),
    updated_at = now()
WHERE supplier_code IS NOT NULL
  AND btrim(supplier_code) <> ''
  AND supplier_code ~* '^L[1-4]_';

-- L3_* في color_code = اسم لون وليس كود — يُفرغ
UPDATE fabric_colors
SET color_code = '',
    updated_at = now()
WHERE color_code ~* '^L3_';

UPDATE fabric_colors
SET color_code = regexp_replace(btrim(color_code), '^L4_', '', 'i'),
    updated_at = now()
WHERE color_code ~* '^L4_';
