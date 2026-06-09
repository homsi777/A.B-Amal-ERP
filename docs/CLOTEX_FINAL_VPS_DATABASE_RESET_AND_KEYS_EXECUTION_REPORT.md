# تقرير التنفيذ النهائي: قاعدة بيانات VPS لـ CLOTEX (نفق SSH، نسخ احتياطي، إعادة تهيئة، مفاتيح)

**التاريخ (مرجع):** 2026-05-03

---

## 1. الملخص

تم ربط المشروع محلياً بقاعدة بيانات PostgreSQL على الـ VPS عبر نفق SSH على المنفذ المحلي `127.0.0.1:5433`، وإنشاء نسخة احتياطية قبل إعادة التهيئة، ثم إعادة تهيئة نظيفة للمخطط العام مع تطبيق جميع الترحيلات والبذرة الدنيا، وتوليد **20** مفتاح تفعيل بخطة **FULL** على قاعدة بيانات الـ VPS، مع التحقق من الجداول والأعدادوسلامة الإعدادات والبناء.

---

## 2. التحقق من النفق (SSH Tunnel)

| الفحص | النتيجة |
|--------|---------|
| `npx tsx server/src/scripts/tunnelDbPing.ts` | قاعدة: `fabric_erp`، مستخدم: `erp_user`، `server_port`: `5432` على الخادم (سلوك متوقع؛ العميل المحلي يتصل عبر `5433`) |
| `netstat -ano \| findstr :5433` | المنفذ `5433` في حالة LISTENING؛ العملية المرتبطة: **`ssh.exe`** (وليس `postgres.exe`) |

---

## 3. التحقق الآمن من البيئة (`server/.env`)

| البند | الحالة |
|--------|--------|
| `DATABASE_URL` يستخدم النفق على المنفذ **5433** | نعم (`tunnel5433: true`) |
| اسم قاعدة البيانات `fabric_erp` | نعم |
| وجود `ACTIVATION_KEY_PEPPER` | نعم |
| وجود `JWT_SECRET` | نعم |
| `ACTIVATION_REQUIRE_ACTIVE=true` | نعم |

لم يُطبع **DATABASE_URL** كاملاً ولا أي كلمات مرور أو أسرار في التقرير.

---

## 4. النسخ الاحتياطي قبل إعادة التهيئة

| البند | القيمة |
|--------|--------|
| الملف | `backups/fabric_erp_before_clean_20260503_120053.dump` |
| الحجم | **309639** بايت (تقريباً 302 كيبيبايت) |
| التنسيق | `pg_dump` بصيغة مخصصة (`-F c`) |

تم التأكد من وجود الملف قبل المتابعة إلى إعادة التهيئة.

---

## 5. نتيجة إعادة التهيئة النظيفة

- تم تشغيل `ALLOW_DB_RESET=true` ثم `npm run server:reset:clean` بنجاح بعد إصلاح تشغيل أوامر الفرعية على Windows (استخدام `shell: true` مع `npm.cmd` داخل `server/src/db/resetClean.ts`) حتى تكتمل الترحيلات والبذرة دون فشل.

---

## 6. التحقق من الترحيلات والجداول

جميع الجداول التالية **موجودة** في المخطط `public` (عبر `server/src/scripts/postResetVerify.ts`):

`activation_keys`, `activation_events`, `activation_devices`, `companies`, `users`, `roles`, `permissions`, `warehouses`, `suppliers`, `customers`, `fabric_categories`, `fabric_items`, `fabric_colors`, `fabric_item_variants`, `fabric_rolls`, `inventory_movements`, `purchase_import_batches`, `purchase_import_rows`, `label_templates`, `print_jobs`, `printed_labels`.

---

## 7. أعداد البذرة الدنيا (بعد الإعادة والبذرة)

| الجدول | العدد |
|--------|-------|
| users | 1 |
| companies | 1 |
| warehouses | 1 |
| customers | 0 |
| suppliers | 0 |
| fabric_items | 0 |
| fabric_rolls | 0 |
| activation_keys | 20 (بعد التوليد؛ انظر القسم 9) |

---

## 8. التحقق من حساب المسؤول (`admin`)

| الحقل | القيمة |
|--------|--------|
| وجود المستخدم | موجود |
| الدور (`role`) | `admin` |
| نشط (`is_active`) | `true` |
| طول `password_hash` | 60 |
| بادئة الهاش (أربعة أحرف فقط للتحقق) | `$2b$` (bcrypt) |

لم يُطبع الهاش كاملاً.

---

## 9. توليد مفاتيح التفعيل على قاعدة VPS

- الأمر: `npm run activation:generate -- --count 20 --plan FULL`
- عدد السجلات في `activation_keys`: **20**
- تجميع حسب الحالة والخطة: **20** سجل بحالة **`UNUSED`** وخطة **`FULL`**، مع `activation_count = 0` و`max_activations = 1` لجميع السجلات.

**ملاحظة تقنية:** تم تصحيح تفسير المتغيرات المنطقية في البيئة (`ACTIVATION_GENERATE_DEV_KEYS` و`ACTIVATION_REQUIRE_ACTIVE`) بحيث لا تعتبر السلسلة `"false"` قيمة صحيحة خطأً (`parseBoolEnv` في `server/src/config/env.ts`)، ثم التأكد من عدم بقاء مفاتيح تطوير غير مرغوبة قبل التوليد النهائي.

---

## 10. موقع ملف المفاتيح المولدة (بدون إظهار المحتوى)

- المجلد: `server/generated/` (مضاف إلى `.gitignore`)
- أحدث ملف للجلسة الحالية (اسم فقط): `activation-keys-20260503-150352.txt`  
- يوجد أيضاً ملف أقدم بنفس المجلد؛ يُنصح بالاحتفاظ بأحدث نسخة فقط حسب سياسة المالك.

**لا يُنسخ محتوى الملف إلى هذا التقرير.**

---

## 11. عدم استهلاك أي مفتاح

لم يُجرَ اختبار تفعيل يستهلك مفتاحاً؛ جميع الـ **20** مفتاحاً بقيت **`UNUSED`** حتى إعداد هذا التقرير.

---

## 12. فحص الأمان (مخرجات البناء)

- `server/generated/` و`backups/` مدرجان في `.gitignore`.
- بحث في مجلد `dist/` عن: `postgresql://`، `DATABASE_URL`، `ACTIVATION_KEY_PEPPER` — **لا تطابقات**.

---

## 13. نتائج `server:check` والبناء

| الأمر | النتيجة |
|--------|---------|
| `npm run server:check` | نجح (`tsc -p server/tsconfig.json --noEmit`) |
| `npm run build` | نجح؛ ظهرت تحذيرات حجم الحزم/chunk فقط دون فشل |

---

## 14. الخلاصة النهائية

**تم تنظيف قاعدة VPS عبر النفق، تطبيق جميع الترحيلات، تشغيل البذرة الدنيا، وتوليد 20 مفتاح تفعيل على قاعدة VPS بنجاح.**
