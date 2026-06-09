# تقرير إصلاح هدف قاعدة البيانات وتهيئة مستخدم admin في CLOTEX

تاريخ التقرير: 2026-05-03  
نوع المهمة: إصلاح/تحقق محدود بدون تعديل واجهة أو منطق وحدات الأعمال.

## 1. الملخص

تمت معالجة المشكلة الثانية بنجاح: جدول `users` كان فارغاً أو لا يحتوي على المستخدم `admin`، وتم تشغيل مسار التهيئة الرسمي `npm run server:seed`، ثم تم إثبات أن:

- المستخدم `admin` أصبح موجوداً في PostgreSQL.
- كلمة مرور `admin` محفوظة كـ bcrypt hash.
- تسجيل الدخول عبر API نجح.
- الرد من API لا يعيد `password_hash`.
- حالة التفعيل بقيت فعالة `active=true`.
- لم يتم إنشاء بيانات أعمال وهمية مثل عملاء أو موردين أو خامات أو أتواب.

أما المشكلة الأولى الخاصة بإثبات VPS:

- `DATABASE_URL` الحالي يستخدم host محلي: `127.0.0.1` على المنفذ `5432`.
- فحص مالك المنفذ أظهر أن process المحلي المستمع على `5432` هو `postgres` وليس `ssh`.
- لم يتم العثور على process نشط باسم `ssh` أو `plink` أو `putty`.
- محاولة SSH آمنة عبر المفتاح و `BatchMode` انتهت بمهلة اتصال، لذلك لم يكتمل إثبات VPS مباشر من هذه الجلسة.

الخلاصة: تم إصلاح admin والتحقق من login والتفعيل، لكن إثبات VPS/tunnel لا يزال غير مكتمل لأن الاتصال الحالي يبدو PostgreSQL محلياً أو نقطة محلية غير مثبتة كـ tunnel.

## 2. وضع هدف قاعدة البيانات

تم فحص `DATABASE_URL` بشكل آمن بدون طباعة كلمة المرور أو الرابط الكامل.

| البند | النتيجة |
|---|---|
| هل `DATABASE_URL` موجود؟ | نعم |
| البروتوكول | `postgresql` |
| host | `127.0.0.1` |
| port | `5432` |
| database | `fabric_erp` |
| user | مقنّع فقط |
| هل host محلي؟ | نعم |
| `NODE_ENV` | `development` |
| `SEED_ADMIN_PASSWORD` | موجود |
| `ACTIVATION_REQUIRE_ACTIVE` | `true` |

لم يتم عرض `DATABASE_URL` أو كلمة المرور.

## 3. هل 127.0.0.1 ناتج عن SSH tunnel؟

تم فحص العمليات النشطة:

- لم تظهر عملية نشطة باسم `ssh`.
- لم تظهر عملية نشطة باسم `plink`.
- لم تظهر عملية نشطة باسم `putty`.

تم فحص المنفذ المحلي `5432`:

| البند | النتيجة |
|---|---|
| `127.0.0.1:5432` | LISTEN |
| `[::1]:5432` | LISTEN |
| مالك المنفذ | process باسم `postgres` |
| هل المالك `ssh`؟ | لا |

بناءً على هذا الدليل، لا يمكن اعتبار `127.0.0.1:5432` tunnel نشطاً في هذه الجلسة. الوضع الظاهر حالياً هو PostgreSQL محلي على جهاز التشغيل.

توجد في المشروع سكربتات ووثائق سابقة تشير إلى تصميم tunnel على منفذ مختلف غالباً `5433` باتجاه PostgreSQL على VPS، لكن `DATABASE_URL` الحالي لا يستخدم `5433`، ولا توجد عملية tunnel نشطة على 5432 أثناء الفحص.

## 4. محاولة إثبات VPS مباشر

تمت محاولة SSH آمنة بدون كلمة مرور وبوضع:

- `BatchMode=yes`
- مفتاح SSH محلي إن وجد
- بدون طباعة بيانات اعتماد

النتيجة:

- فشلت المحاولة بسبب انتهاء مهلة الاتصال.
- لم يتم تشغيل استعلامات SQL مباشرة على VPS من هذه الجلسة.

لذلك لا يوجد إثبات قوي جديد أن قاعدة البيانات الحالية هي VPS بعيد. الإثبات المتاح حالياً هو أن backend يتصل بنجاح بقاعدة PostgreSQL الموجودة في `DATABASE_URL` الحالي، لكن هذا الهدف يظهر محلياً.

## 5. إجراء تهيئة admin

تم تشغيل المسار الرسمي:

```powershell
npm run server:seed
```

نتيجة seed:

- تم إنشاء مستخدم `admin`.
- تم التحقق من قالب اللصاقات الافتراضي.
- توليد مفاتيح التفعيل بقي معطلاً افتراضياً.
- اكتمل seed بنجاح.

مهم:

- لم يتم إنشاء مفاتيح تفعيل إنتاجية من seed.
- لم يتم إنشاء عملاء أو موردين أو خامات أو أتواب.
- كلمة مرور admin لم تُطبع في السجلات.
- بما أن `SEED_ADMIN_PASSWORD` موجود في البيئة، تم الاعتماد عليه في اختبار login بدلاً من طباعة أو افتراض كلمة مرور داخل التقرير.

## 6. تحقق مستخدم admin بعد الإصلاح

تم تشغيل استعلام آمن:

```sql
SELECT
  username,
  role,
  is_active,
  created_at,
  length(password_hash) AS password_hash_length,
  left(password_hash, 4) AS password_hash_prefix
FROM users
WHERE username='admin';
```

النتيجة:

| البند | القيمة |
|---|---|
| username | `admin` |
| role | `admin` |
| active | نعم |
| طول hash كلمة المرور | 60 |
| بادئة hash | `$2b$` |
| هل كلمة المرور مخزنة كـ bcrypt hash؟ | نعم |
| هل تم عرض hash الكامل؟ | لا |

كما تم التحقق من وجود أساسيات الصلاحيات:

| الجدول | العدد |
|---|---:|
| `roles` | 5 |
| `permissions` | 13 |
| `role_permissions` | 15 |

هذا كافٍ لإثبات أن seed أنشأ RBAC الأساسي اللازم للمستخدم الإداري.

## 7. تحقق تسجيل الدخول

تم اختبار تسجيل الدخول عبر API:

```http
POST /api/auth/login
```

باستخدام:

- `username=admin`
- كلمة المرور من `SEED_ADMIN_PASSWORD` عند وجودها، بدون طباعتها.

النتيجة:

| البند | النتيجة |
|---|---|
| HTTP status | 200 |
| login ok | نعم |
| هل عاد token؟ | نعم |
| هل تم عرض token كاملاً؟ | لا، تم التحقق من وجوده فقط |
| user.username | `admin` |
| user.role | `admin` |
| هل عاد `password_hash` في الرد؟ | لا |

هذا يثبت أن login يعمل بعد تهيئة admin.

## 8. تحقق حالة التفعيل بعد الإصلاح

تم تشغيل:

```sql
SELECT key, value
FROM system_settings
WHERE key='activation.status';
```

النتيجة:

| البند | القيمة |
|---|---|
| `activation.status` موجود | نعم |
| active | true |
| planCode | `FULL` |
| keySuffix | موجود: `6ZM3` |
| requireActive | true |

التفعيل بقي فعالاً بعد seed، ولم يتم كسره.

## 9. تحقق seed نظيف بدون بيانات وهمية

تم تشغيل عدادات الجداول المطلوبة:

```sql
SELECT COUNT(*) FROM customers;
SELECT COUNT(*) FROM suppliers;
SELECT COUNT(*) FROM fabric_items;
SELECT COUNT(*) FROM fabric_rolls;
SELECT COUNT(*) FROM warehouses;
```

النتيجة:

| الجدول | العدد |
|---|---:|
| `customers` | 0 |
| `suppliers` | 0 |
| `fabric_items` | 0 |
| `fabric_rolls` | 0 |
| `warehouses` | 1 |

الاستنتاج:

- لا توجد بيانات عملاء/موردين/خامات/أتواب وهمية أُنشئت من seed.
- يوجد مستودع واحد، وهذا متوقع كتهيئة أساسية `MAIN` أو مستودع رئيسي.

## 10. Build / Check

تم تشغيل:

```powershell
npm run server:check
```

النتيجة:

- نجح بدون أخطاء TypeScript في backend.

تم تشغيل:

```powershell
npm run build
```

النتيجة:

- نجح build.
- ظهرت تحذيرات Vite اعتيادية عن حجم بعض chunks وعن استخدام `xlsx` ديناميكياً وستاتيكياً في نفس الوقت.
- لا توجد أخطاء build.

## 11. ما الذي تم تعديله؟

لم يتم تعديل أي ملف إنتاجي أو تصميم أو منطق وحدات أعمال.

الإجراءات التي تمت:

1. تشغيل `npm run server:seed` لإصلاح غياب `admin`.
2. تشغيل استعلامات قراءة آمنة للتحقق.
3. اختبار login عبر API.
4. تشغيل `server:check` و `build`.
5. إنشاء هذا التقرير فقط:
   - `docs/CLOTEX_VPS_TARGET_AND_ADMIN_BOOTSTRAP_FIX_REPORT.md`

## 12. الحكم النهائي

Verification still incomplete because هدف قاعدة البيانات الحالي في `DATABASE_URL` يظهر كـ `127.0.0.1:5432`، ومالك المنفذ هو process محلي باسم `postgres` وليس SSH tunnel، كما أن محاولة SSH المباشرة انتهت بمهلة اتصال. لذلك لم يثبت من هذه الجلسة أن الاتصال الحالي هو VPS/tunnel.

لكن تم إصلاح مشكلة `admin` بالكامل:

- `admin` موجود الآن في PostgreSQL.
- كلمة المرور محفوظة كـ bcrypt hash.
- تسجيل الدخول عبر API نجح.
- التفعيل بقي فعالاً.
- لم يتم إنشاء بيانات أعمال وهمية.
- `server:check` و `build` نجحا.

للوصول إلى حكم: **"VPS/tunnel target verified and admin user fixed."** يجب تشغيل backend مع `DATABASE_URL` يشير إلى tunnel فعلي مثبت، مثل منفذ tunnel الصحيح، أو تشغيل نفس استعلامات الإثبات من داخل VPS نفسه.

