-- يميّز مستخدم "مدير المنصة" الحقيقي (مالك نظام clotex) عن "أدمن" أي شركة عميل.
-- يُستخدم فقط لحماية نقاط إدارة تراخيص التفعيل (توليد/عرض/إلغاء مفاتيح كل الشركات)
-- من وصول أي أدمن شركة عادية إليها.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;
