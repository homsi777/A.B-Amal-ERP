-- تصحيحي بحت (لا حذف ولا تغيير كمية) — يملأ reference_type/reference_id/
-- reference_no على حركات MANUAL_CREATE القديمة التي أُنشئت من عملية إدخال
-- (fabric_rolls.intake_operation_id موجود) لكن لم تحمل مرجعاً صريحاً وقتها،
-- بنفس الصيغة التي أصبح الخادم يكتبها تلقائياً من الآن فصاعداً (migration
-- التالية بالكود، لا ملف SQL). يتيح هذا تجميع كل الحركات القديمة والجديدة
-- بمستند واحد (GROUP BY reference_type, reference_id) بشاشة حركات المخزون
-- الجديدة بلا استثناء لأي بيانات سابقة.
UPDATE inventory_movements im
SET reference_type = 'INTAKE_OPERATION',
    reference_id = fr.intake_operation_id,
    reference_no = io.order_no
FROM fabric_rolls fr
JOIN intake_operations io ON io.id = fr.intake_operation_id
WHERE im.roll_id = fr.id
  AND im.movement_type = 'MANUAL_CREATE'
  AND im.reference_type IS NULL
  AND fr.intake_operation_id IS NOT NULL;
