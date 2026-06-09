# تقرير المرحلة 1 — أساس الخادم وربط PostgreSQL

**المشروع:** نظام مستودعات الأقمشة (ERP)  
**التاريخ:** 2026-05-02  
**النطاق:** أساس backend + اتصال PostgreSQL + هجرات + بذور + مصادقة + عميل API في الواجهة — **دون** إزالة بيانات Zustand الوهمية ودون استيراد Excel/طباعة تيليغرام إنتاجي.

---

## 1. الملخص

- أُضيف مجلد **`server/`** يشغّل **Fastify 5** على **Node.js** مع **TypeScript** واتصال **PostgreSQL** عبر **`pg` Pool** و**UTF-8** (اتصال عربي عبر `client_encoding` الافتراضي لـ `pg` وترميز JSON `UTF-8`).
- تُنفَّذ **الهجرات** تلقائياً عبر `schema_migrations` وملفات SQL مرتبة.
- تُوفّر نقاط **المصادقة** الأساسية: تسجيل دخول، جلسة JWT، تعرف على المستخدم، تسجيل خروج شكلي.
- أُعدّ **العميل الأمامي** (`src/lib/api/*`) مع صفحة **`/login`** ومؤشر **اتصال الخادم** في الشريط العلوي — دون استبدال المتجر المحلي بعد.
- تُعرَّض **أسرار VPS/PostgreSQL/Telegram فقط في `server/.env`** على الخادم؛ **لا** توجد اعتمادات قاعدة بيانات في الواجهة أو في ملفات القوالب المرفوعة.

---

## 2. الملفات المُنشأة

| المسار | الوصف |
|--------|--------|
| `server/tsconfig.json` | إعدادات TypeScript للخادم (`module: NodeNext`) |
| `server/.env.example` | قالب متغيرات الخادم (**بدون قيم سرّية**) |
| `server/src/index.ts` | نقطة تشغيل الخادم |
| `server/src/app.ts` | تسجيل Fastify، CORS، المسارات، معالج الأخطاء |
| `server/src/config/env.ts` | تحميل `server/.env`، تحقق **zod**، **JWT_SECRET** افتراضي في التطوير فقط مع تحذير |
| `server/src/db/pool.ts` | مجمع اتصالات PostgreSQL وفحص `SELECT 1` |
| `server/src/db/migrate.ts` | تشغيل الهجرات مرة واحدة لكل ملف مع معاملات |
| `server/src/db/seed.ts` | بذور idempotent (شركة، عملات، أدوار، صلاحيات، مستخدم admin، مستودع) |
| `server/src/db/migrations/001_core_foundation.sql` | نواة: شركات، مستخدمون، أدوار، صلاحيات، مستودعات، عملات، إعدادات، تدقيق |
| `server/src/db/migrations/002_textile_master_data.sql` | أطراف ومستودعات فرعية وأصناف أقمشة وألوان ومتغيرات |
| `server/src/middleware/auth.ts` | JWT موقّع ومتحقق، سياق مستخدم على الطلب |
| `server/src/middleware/errorHandler.ts` | أخطاء موحدة مع رسائل عربية آمنة |
| `server/src/routes/healthRoutes.ts` | `GET /api/health` |
| `server/src/routes/authRoutes.ts` | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| `server/src/routes/systemRoutes.ts` | `GET /api/system/info` |
| `server/src/utils/apiResponse.ts` | مساعدات استجابة |
| `server/src/utils/arabicErrors.ts` | رسائل خطأ للعرض |
| `.env.example` (جذر المشروع) | **`VITE_API_BASE_URL` فقط** للواجهة |
| `VPS.example.md` | قالب لبيانات الخادم دون أسرار |
| `src/lib/api/client.ts` | عميل HTTP + تخزين الرمز |
| `src/lib/api/authApi.ts` | دوال تسجيل الدخول / الخروج / المستخدم الحالي |
| `src/lib/api/systemApi.ts` | صحة النظام بدون مصادقة، ومعلومات النظام |
| `src/vite-env.d.ts` | أنواع `import.meta.env` |
| `src/pages/Login.tsx` | صفحة تسجيل دخول عربية RTL |
| `src/components/BackendConnectionBadge.tsx` | مؤشر «متصل / غير متصل بالخادم» |

---

## 3. الملفات المُعدَّلة

| الملف | التعديل |
|--------|---------|
| `package.json` | اعتماديات Fastify، pg، zod، bcrypt، jsonwebtoken، @fastify/cors؛ سكربتات `server:*` |
| `tsconfig.json` | استبعاد مجلد `server` من فحص الواجهة الأمامية |
| `src/App.tsx` | مسار `/login` |
| `src/layouts/DashboardLayout.tsx` | رابط «دخول API»، مؤشر الاتصال |
| `vite.config.ts` | تعليق TODO للمرحلة 7 (تيليغرام الإنتاجي) |
| `.gitignore` | `VPS.md`، `server/.env`، استثناء `server/.env.example` |

---

## 4. تنظيف الأمان لأسرار VPS

- **`VPS.md`**: إضافته إلى `.gitignore` حتى لا يُرفع إلى Git وهو يُفترض أن يحتوي بيانات حساسة.
- **`VPS.example.md`**: قالب بدون كلمات مرور أو عناوين فعلية؛ يوضح أن **`DATABASE_URL`** تُوضع في **`server/.env` فقط**.
- **يجب تدوير كلمات المرور لأنها ظهرت في ملف داخل المشروع** — إذا كان `VPS.md` أو أي ملف يحتوي أسراراً قد وُسِم في سجل Git سابقاً؛ لا يُعاد نشر الأسرار في التقارير أو الشيفرة.
- الواجهة لا تحتوي على `DATABASE_URL` أو توكن تيليغرام؛ **`TELEGRAM_*`** تبقى في **`server/.env.example`** كحقول فارغة للاستعداد للمرحلة 7.

---

## 5. مكدس الخادم

| المكوّن | الاختيار |
|---------|-----------|
| وقت التشغيل | Node.js |
| اللغة | TypeScript (`tsx` للتشغيل والمراقبة) |
| الإطار | **Fastify 5** |
| قاعدة البيانات | **PostgreSQL** عبر **`pg` Pool** |
| التحقق من المدخلات | **zod** |
| كلمات المرور | **bcrypt** |
| الجلسات | **JWT** (`jsonwebtoken`) |
| CORS | **`@fastify/cors`** مع مصادر منفصلة بفاصلة |

---

## 6. متغيرات البيئة

**الخادم (`server/.env` — لا يُرفع):**

| المتغير | الغرض |
|---------|--------|
| `NODE_ENV` | بيئة التشغيل |
| `PORT` | منفذ API (افتراضي 4010) |
| `DATABASE_URL` | سلسلة اتصال PostgreSQL كاملة (**خلفية فقط**) |
| `JWT_SECRET` | سر توقيع JWT (إلزامي في الإنتاج؛ افتراضي مع تحذير في التطوير فقط) |
| `JWT_EXPIRES_IN` | مدة الرمز (مثل `7d`) |
| `CORS_ORIGIN` | مصادر مسموحة، مفصولة بفواصل |
| `APP_BASE_URL` | عنوان أساس للـ API |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | للمرحلة 7؛ فارغان الآن |
| `SEED_ADMIN_PASSWORD` | كلمة مرور مستخدم البذرة `admin`؛ مطلوبة في الإنتاج |

**الواجهة (جذر المشروع، مثال `.env`):**

| المتغير | الغرض |
|---------|--------|
| `VITE_API_BASE_URL` | عنوان خادم API فقط (مثل `http://localhost:4010`) — **بدون** اعتمادات DB |

---

## 7. حالة اتصال PostgreSQL

- الاتصال يتم عبر **`DATABASE_URL`** في **`server/.env`** فقط.
- فحص الصحة: **`GET /api/health`** ينفّذ **`SELECT 1`**؛ عند النجاح يظهر `"database": "connected"`.
- في بيئة التنفيذ الحالية للتقرير، **`npm run server:migrate`** أُجري دون تعريف صالح لـ **`DATABASE_URL`** في `server/.env`، فظهر: **`[migrate] DATABASE_URL غير معرّف في server/.env`** — هذا متوقع حتى يضيف المالك سلسلة الاتصال الفعلية لخادم VPS.
- بعد ضبط **`DATABASE_URL`** على جهاز يصل إلى PostgreSQL، يُتوقع نجاح الهجرات والبذور وتشغيل الخادم مع **`database: connected`**.

---

## 8. نظام الهجرات

- جدول التتبع: **`schema_migrations`** (`filename`، `applied_at`)، يُنشأ تلقائياً قبل أول هجرة.
- الملفات في **`server/src/db/migrations/*.sql`** تُرتَّب أبجدياً (`001_...` ثم `002_...`).
- كل هجرة تُنفَّذ داخل **معاملة** (`BEGIN` / `COMMIT` أو `ROLLBACK` عند الفشل).
- يُسجَّل في الطرفية **اسم الملف فقط** بعد النجاح (`تم تطبيق: ...`)، دون أسرار.

**الأمر:** `npm run server:migrate`

---

## 9. الجداول المُنشأة

**الهجرة `001_core_foundation.sql`:**

- `companies`, `users`, `roles`, `permissions`, `role_permissions`, `warehouses`, `currencies`, `system_settings`, `audit_logs`
- امتداد **`pgcrypto`** لـ `gen_random_uuid()`.

**الهجرة `002_textile_master_data.sql`:**

- `suppliers`, `customers`, `fabric_categories`, `fabric_items`, `fabric_colors`, `fabric_item_variants`, `warehouse_locations`

---

## 10. بيانات البذرة

- **شركة:** رمز `TEXTILE-MAIN`، اسم «تيكس ماتريكس ERP».
- **عملات:** `USD`, `TRY`, `SYP`.
- **مستودع:** رمز `MAIN`، اسم «المستودع الرئيسي».
- **أدوار:** admin, manager, inventory, accountant, viewer.
- **صلاحيات:** القائمة المطلوبة في المهمة (مثل `dashboard.view`, `inventory.manage`, …).
- **ربط الصلاحيات:** دور **admin** يحصل على كل الصلاحيات؛ دور **viewer** على `dashboard.view` و `reports.view` فقط.
- **مستخدم:** `admin` — كلمة المرور من **`SEED_ADMIN_PASSWORD`**؛ في التطوير فقط، إن لم تُعرَّف، تُستخدم كلمة مرور افتراضية مع **تحذير في الطرفية دون طباعة كلمة المرور**.

**الأمر:** `npm run server:seed`

---

## 11. نقاط المصادقة

| الطريقة | المسار | الوصف |
|---------|--------|--------|
| POST | `/api/auth/login` | جسم: `{ username, password }` — يعيد `token` و `user` (مع `permissions`) |
| POST | `/api/auth/logout` | يعيد `{ ok: true }`؛ الواجهة تمسح الرمز محلياً |
| GET | `/api/auth/me` | ترويسة: `Authorization: Bearer <token>` — يعيد الملف الشخصي محدثاً من قاعدة البيانات |

---

## 12. أساس عميل API في الواجهة

- **`src/lib/api/client.ts`:** قاعدة **`VITE_API_BASE_URL`**، JSON، رمز في **`localStorage`** تحت مفتاح ثابت، أخطاء **`ApiRequestError`** مع رسالة مناسبة للعرض بالعربية.
- **`authApi` / `systemApi`:** طبقة رقيقة فوق العميل.
- **لا** تُستبدل بيانات Zustand بعد — التطبيق يبقى تجريبياً بدون إجبار تسجيل الدخول.

---

## 13. نقطة الصحة

**`GET /api/health`**

مثال للاستجابة عند اتصال قاعدة البيانات:

```json
{
  "ok": true,
  "service": "fabric-warehouse-api",
  "database": "connected",
  "time": "2026-05-02T..."
}
```

عند فشل الاتصال: رمز حالة **503** و `"database": "disconnected"`.

---

## 14. الأوامر التي تم تشغيلها والنتائج

| الأمر | النتيجة |
|--------|---------|
| `npm install` | نجاح؛ إضافة الحزم المطلوبة للخادم |
| `npm run server:check` (`tsc -p server`) | **نجاح** |
| `npm run build` (Vite) | **نجاح** |
| `npm run lint` (`tsc` للواجهة) | **نجاح** |
| `npm run server:migrate` | **فشل متوقع محلياً:** `DATABASE_URL` غير معرّف في `server/.env` — يُعاد التشغيل على الخادم بعد ضبط الاعتمادات |

*(لم يُشغَّل `server:seed` بنجاح في هذه الجلسة لغياب اتصال قاعدة البيانات؛ يُنفَّذ بعد نجاح `migrate`.)*

---

## 15. قيود معروفة

- **لا** يوجد بعد محرك لفات المخزون أو فواتير أو استيراد Excel على الخادم.
- **تيليغرام الإنتاجي** غير مطبّق؛ وسيط Vite للتطوير فقط مع **TODO** للمرحلة 7.
- مصادقة الواجهة **اختيارية** — المستخدم يمكنه تصفح الواجهة الوهمية دون تسجيل دخول.
- `GET /api/system/info` يستخدم **عميلاً يضيف مصادقة** إن وُجد رمز؛ يمكن جعله عاماً لاحقاً إذا لزم.

---

## 16. التوصية للمرحلة 2

1. ربط **`DATABASE_URL`** الفعلي على VPS وتشغيل **`server:migrate`** و **`server:seed`** والتحقق من **`/api/health`** و **`/api/auth/login`** يدوياً.
2. بدء **CRUD** للبيانات الرئيسية (عملاء، موردون، مستودعات، أصناف أقمشة) عبر REST مع ربط تدريجي للواجهة بـ **`apiFetch`**.
3. توحيد **المستخدم والصلاحيات** مع واجهة إعدادات لاحقاً.
4. الإبقاء على بيانات Zustand كطبقة احتياط حتى اكتمال استبدال الواجهات.

---

**خاتمة:** أكملت المرحلة 1 من ناحية الشيفرة والهيكل؛ يبقى التحقق النهائي على VPS بعد تعبئة **`server/.env`** بأمان **بدون** إدراج أسرار في Git أو في هذا التقرير.
