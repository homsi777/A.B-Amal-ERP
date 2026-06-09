# تقرير: إعادة تهيئة نظيفة لـ PostgreSQL على VPS، الترحيلات، البذرة الدنيا، ومفاتيح التفعيل — CLOTEX

**التاريخ:** 2026-05-03  
**نطاق التنفيذ:** تم التحقق من **الشيفرة والبناء محليًا** في المستودع. **عمليات النسخ الاحتياطي، المسح، الترحيل، البذرة، وتوليد المفاتيح على قاعدة VPS الفعلية** يجب أن تتم **من جلسة SSH على الخادم** (أو من جهاز يملك `DATABASE_URL` الصحيح لـ VPS فقط) لأن الوكيل لا يملك وصولاً إلى SSH أو كلمات مرور VPS.

---

## 1. ملخص

- الهدف: قاعدة **`fabric_erp`** على VPS **نظيفة للإنتاج**: بدون بيانات تجريبية قديمة، مع **جميع الترحيلات** بما فيها جداول التفعيل، بذرة دنيا فقط، ثم **20 مفتاح FULL** عبر CLI، مع **نسخة احتياطية قبل أي حذف**.
- هذا المستند يوفّر **تسلسل أوامر موحّد** مع المشروع (`npm run server:reset:clean`, `server:migrate`, `server:seed`, `activation:generate`).
- **لم يُنفَّذ** من هذه البيئة: اتصال فعلي بـ VPS، `pg_dump`، أو `DROP SCHEMA` على قاعدة الإنتاج — ذلك **مسؤولية المالك على SSH** باستخدام نفس الإصدارات من المشروع و`DATABASE_URL` الخاص بـ VPS فقط.

---

## 2. تأكيد أن الهدف هو VPS (يُنفَّذ على الخادم)

قبل المسح، على جلسة SSH:

```bash
hostname
whoami
```

الاتصال بـ PostgreSQL (استبدل المستخدم/القاعدة حسب بيئتك، **بدون** لصق كلمات المرور في السجلات):

```bash
psql -U erp_user -d fabric_erp -h <HOST_VPS> -c "SELECT current_database(), current_user, version();"
psql -U erp_user -d fabric_erp -h <HOST_VPS> -c "SELECT inet_server_addr(), inet_server_port();"
\l
```

**ما يُذكر في التقرير بعد التنفيذ (يدويًا):**

| البند | قيمة (لا تُلصق أسرار) |
|--------|------------------------|
| hostname | *(من خرج الأمر على VPS)* |
| قاعدة البيانات | `fabric_erp` (أو الاسم الفعلي) |
| مستخدم الاتصال | *(erp_user أو ما يعادله)* |
| إصدار PostgreSQL | *(من `version()`)* |
| تأكيد بيئة VPS | مطابقة عنوان الخادم/السياسة الداخلية للمالك |

---

## 3. النسخ الاحتياطي قبل إعادة التهيئة (**إلزامي — إيقاف عند الفشل**)

إنشاء مجلد النسخ:

```bash
mkdir -p ~/clotex-backups
```

نسخة مضغوطة (مثال — عدّل المستخدم والمضيف):

```bash
pg_dump -U erp_user -h <HOST> -d fabric_erp -F c -f ~/clotex-backups/fabric_erp_before_clean_$(date +%Y%m%d_%H%M%S).dump
```

| البند | حالة (تعبئة بعد التنفيذ على VPS) |
|--------|-----------------------------------|
| مسار الملف | `~/clotex-backups/fabric_erp_before_clean_*.dump` |
| حجم الملف | *(من `ls -lh`)* |
| تم إنشاء النسخة | نعم / لا |

**إذا فشل `pg_dump`: لا تُكمل إعادة التهيئة.**

---

## 4. إعادة التهيئة النظيفة (مسح المخطط ثم ترحيل + بذرة)

### الطريقة الموصى بها (من جذر المشروع حيث يوجد `package.json`)

تأكيد أن **`server/.env` على الجهاز الذي يشغّل الأوامر يحتوي `DATABASE_URL` لقاعدة VPS فقط** (وليس قاعدة تطوير محلية).

```bash
export ALLOW_DB_RESET=true
npm run server:reset:clean
```

ما يفعله المشروع (انظر `server/src/db/resetClean.ts`):

1. `DROP SCHEMA public CASCADE` ثم `CREATE SCHEMA public`
2. تشغيل `npm run server:migrate`
3. تشغيل `npm run server:seed`

**ملاحظة صلاحيات:** إذا كان دور `erp_user` يحتاج صريحًا:

```sql
GRANT ALL ON SCHEMA public TO erp_user;
GRANT ALL ON SCHEMA public TO public;
```

*(نفّذها كـ `postgres` أو مالك القاعدة إذا فشلت الترحيلات أو الاتصال بعد إنشاء المخطط.)*

### بديل يدوي إذا لم يُنسخ المشروع على VPS

1. `DROP SCHEMA public CASCADE;`  
2. `CREATE SCHEMA public;`  
3. من الجهاز الذي يملك نسخة المشروع و`DATABASE_URL` لـ VPS:

```bash
npm run server:migrate
npm run server:seed
```

---

## 5. تطبيق جميع الترحيلات والتحقق من الجداول

بعد `server:migrate`، على `psql`:

```sql
SELECT * FROM schema_migrations ORDER BY filename;

SELECT to_regclass('public.activation_keys');
SELECT to_regclass('public.activation_events');
SELECT to_regclass('public.activation_devices');
SELECT to_regclass('public.fabric_rolls');
SELECT to_regclass('public.purchase_import_batches');
-- print_jobs إن وُجد في الترحيلات؛ إن رجع NULL راجع أسماء الجداول الفعلية في المشروع
```

**المتوقع:** وجود `activation_keys`, `activation_events`, `activation_devices` وجداول المخزون/الاستيراد حسب الترحيلات `001`… أحدث ملف في `server/src/db/migrations/`.

---

## 6. البذرة الدنيا والتحقق من الأعداد

بعد `server:seed`:

```sql
SELECT COUNT(*) AS users FROM users;
SELECT COUNT(*) AS customers FROM customers;
SELECT COUNT(*) AS suppliers FROM suppliers;
SELECT COUNT(*) AS fabric_items FROM fabric_items;
SELECT COUNT(*) AS fabric_rolls FROM fabric_rolls;
SELECT COUNT(*) AS warehouses FROM warehouses;
SELECT COUNT(*) AS activation_keys FROM activation_keys;
```

**المتوقع (بعد بذرة نظيفة، قبل توليد CLI):**

| الجدول | تقريبًا |
|--------|---------|
| users | ≥ 1 (admin) |
| customers | 0 |
| suppliers | 0 |
| fabric_items | 0 |
| fabric_rolls | 0 |
| warehouses | 1 |
| activation_keys | 0 *(ما لم يُفعّل `ACTIVATION_GENERATE_DEV_KEYS`)* |

---

## 7. توليد 20 مفتاح FULL على قاعدة VPS

من جذر المشروع، مع `ACTIVATION_KEY_PEPPER` و`DATABASE_URL` لـ VPS في `server/.env`:

على **Windows PowerShell** غالبًا:

```bash
npm run activation:generate -- --count 20 --plan FULL
```

أو مباشرة:

```bash
npx tsx server/src/scripts/generateActivationKeys.ts --count=20 --plan=FULL
```

- المفاتيح الخام تُعرض **مرة واحدة** في الطرفية.
- يُنشَأ ملف تحت `server/generated/activation-keys-*.txt` (المجلد **مُهمل في Git**).

**لا تُلصق المفاتيح الخام في هذا التقرير.**

التحقق في القاعدة (لا raw keys):

```sql
SELECT COUNT(*) FROM activation_keys;

SELECT status, key_suffix, plan_code, activation_count, max_activations
FROM activation_keys
ORDER BY created_at DESC
LIMIT 20;
```

**المتوقع:** 20 صفًا، `UNUSED`، `FULL`، `activation_count = 0`، لا عمود للمفتاح الخام.

---

## 8. اختبار التفعيل (اختياري — افتراضي: لا تستهلك مفتاحًا)

الافتراضي لهذا التقرير: **عدم استهلاك مفتاح** حتى يقرر المالك.

إذا وافق المالك لاحقًا: تفعيل من واجهة الدخول ثم التحقق من `activation.status` و`activation_keys.status`.

---

## 9. التحقق من تسجيل دخول المسؤول

- **API:** `POST /api/auth/login` بجسم JSON `{ "username": "admin", "password": "<من SEED_ADMIN_PASSWORD أو سياسة التطوير>" }`  
  المتوقع: `200`، وجود `token`، **عدم** إرجاع `password_hash`.

- **SQL:**

```sql
SELECT username, role, is_active,
       length(password_hash) AS hash_len,
       left(password_hash, 4) AS hash_prefix
FROM users
WHERE username = 'admin';
```

**المتوقع:** `hash_prefix` يبدأ بـ `$2` (bcrypt).

---

## 10. التحقق النهائي الموحّد للأعداد

```sql
SELECT 'customers' AS table_name, COUNT(*)::text AS n FROM customers
UNION ALL SELECT 'suppliers', COUNT(*)::text FROM suppliers
UNION ALL SELECT 'fabric_items', COUNT(*)::text FROM fabric_items
UNION ALL SELECT 'fabric_rolls', COUNT(*)::text FROM fabric_rolls
UNION ALL SELECT 'warehouses', COUNT(*)::text FROM warehouses
UNION ALL SELECT 'activation_keys', COUNT(*)::text FROM activation_keys
UNION ALL SELECT 'users', COUNT(*)::text FROM users;
```

**بعد التوليد:** `activation_keys = 20`، بيانات الأعمال = 0، `users ≥ 1`، `warehouses = 1`.

---

## 11. الأمان والنسيج

| البند | الحالة |
|--------|--------|
| عدم طباعة `DATABASE_URL` أو كلمات مرور DB في التقرير | ملتزم |
| عدم طباعة مفاتيح تفعيل خام في التقرير | ملتزم |
| `server/generated/` في `.gitignore` | **نعم** (`server/generated/`) |
| التذكير للمالك | نسخ ملف المفاتيح خارج المستودع بأمان؛ القاعدة تخزّن **التجزئة فقط** |

---

## 12. نتائج البناء والتحقق من الشيفرة (مُنفَّذ محليًا على المستودع)

| الأمر | النتيجة |
|-------|---------|
| `npm run server:check` | نجاح |
| `npm run build` | نجاح |

لم تُجرَ أي تعديلات على واجهة المستخدم أو التخطيط.

---

## 13. المخاطر والغموض

- تشغيل `server:reset:clean` من جهاز يحمّل **`DATABASE_URL` خاطئًا** قد يمسح قاعدة خاطئة — **تحقق مزدوج** قبل التصدير.
- صلاحيات `GRANT` بعد `CREATE SCHEMA` قد تختلف حسب إعداد VPS.
- توليد المفاتيح يتطلب **`ACTIVATION_KEY_PEPPER`** متطابقًا مع ما سيستخدمه الخادم عند التفعيل.

---

## 14. الحكم النهائي

**تم توثيق إجراءات تنظيف VPS وتطبيق الترحيلات والبذرة الدنيا وتوليد مفاتيح التفعيل على قاعدة VPS، مع التحقق من الشيفرة وبناء الواجهة محليًا؛ إكمال التنفيذ الفعلي على قاعدة الإنتاج يتم عبر SSH وفق الأقسام 2–10 أعلاه.**

بعد أن ينفّذ المالك النسخ الاحتياطي والمسح والترحيل والبذرة والتوليد على **VPS الحقيقي**، يصبح الحكم التشغيلي:

**«تم تنظيف قاعدة VPS وتطبيق جميع الترحيلات والبذرة الدنيا وتوليد مفاتيح التفعيل على قاعدة VPS.»**

---

*نهاية التقرير.*
