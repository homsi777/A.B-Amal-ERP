-- إجراء "مرتجع" بعملية إدخال الخامة: الجهة الفعلية عميل لا مورّد (فاتورة
-- المرتجع تُبنى من customer_id أصلاً، supplier_id يبقى NULL لهذا الإجراء).
-- المورّد يبقى إلزامياً لكل الإجراءات الأخرى عبر قيد CHECK مرآوي للقيد
-- الموجود أصلاً الذي يُلزم عميلاً عند RETURN.
ALTER TABLE intake_operations ALTER COLUMN supplier_id DROP NOT NULL;

ALTER TABLE intake_operations
  ADD CONSTRAINT intake_operations_non_return_requires_supplier
  CHECK (action_type = 'RETURN' OR supplier_id IS NOT NULL);
