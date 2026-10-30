-- يربط إرسالية "شراء" (intake_dispatch_slips.slip_type='PURCHASE') بفاتورة
-- الشراء الحقيقية المُنشأة منها بعد تسعير كل أسطرها — إرسالية الشراء وحدها
-- لم تكن تظهر بكشف حساب المورّد لأنها ليست سجلاً محاسبياً (purchase_invoices
-- فقط)، بل ورقة عمل لتسجيل الأتواب وتسعيرها. هذا العمود يمنع إنشاء أكثر من
-- فاتورة واحدة من نفس الإرسالية، ويتيح عرض رقم الفاتورة الناتجة بالواجهة.
ALTER TABLE intake_dispatch_slips
  ADD COLUMN purchase_invoice_id uuid REFERENCES purchase_invoices(id);
