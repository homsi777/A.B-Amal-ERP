-- طريقة الشحن تُسجّل على الطلبية عند الإنشاء (ليست من المستودع).
ALTER TABLE customer_orders
  ADD COLUMN IF NOT EXISTS shipping_method text;
