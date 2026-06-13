-- تسليم جملة على مرحلتين: تفنيد المستودع ثم موافقة المدير

ALTER TABLE sales_invoices DROP CONSTRAINT IF EXISTS sales_invoices_delivery_status_check;
ALTER TABLE sales_invoices
  ADD CONSTRAINT sales_invoices_delivery_status_check
  CHECK (delivery_status IS NULL OR delivery_status IN ('IN_DELIVERY', 'TAFNID_SAVED', 'FULFILLED'));

INSERT INTO permissions (code, name, category) VALUES
  ('delivery.tafnid', 'حفظ تفنيد التسليم', 'delivery'),
  ('delivery.fulfill', 'تأكيد تسليم الجملة', 'delivery')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('admin', 'manager', 'inventory')
  AND p.code IN ('delivery.tafnid', 'delivery.fulfill')
  AND (r.code IN ('admin', 'manager') OR p.code = 'delivery.tafnid')
ON CONFLICT DO NOTHING;
