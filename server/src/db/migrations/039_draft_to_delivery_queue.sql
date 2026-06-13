-- مسودات فواتير البيع تدخل قسم التسليم مباشرة (جملة)

UPDATE sales_invoices
   SET delivery_status = 'IN_DELIVERY',
       updated_at = now()
 WHERE document_status = 'DRAFT'
   AND (delivery_status IS NULL OR delivery_status NOT IN ('FULFILLED'));

-- دور «مخزون»: تسليم فقط (تفنيد) بدون بقية الأقسام
DELETE FROM role_permissions rp
 USING roles r, permissions p
 WHERE rp.role_id = r.id
   AND rp.permission_id = p.id
   AND r.code = 'inventory'
   AND p.code NOT IN ('delivery.tafnid');
