# تقرير المراجعة الشاملة — مشروع CLOTEX (نظام إدارة مستودعات الأقمشة)

**تاريخ التقرير:** 2026-05-03  
**نطاق المراجعة:** قراءة ملفات الكود الفعلية في المستودع، مسارات الـ API، الترحيلات، الواجهة، Electron، والإعدادات — دون تعديل على كود الإنتاج.  
**استثناءات التحليل المعمّق:** وحدة التصنيع (Manufacturing) ووحدة الشركاء (Partners) — ذكر موجز فقط حسب طلب العميل.

---

## 1. هوية المشروع والملخص التنفيذي

### اسم المشروع والنشاط
- **الاسم:** CLOTEX (في `package.json`: FabricWarehouse — وصف: «CLOTEX — Clothes Textile · نظام إدارة مستودعات الأقمشة»).
- **النشاط:** ERP لمستودع أقمشة / منسوجات (قراءة البيانات الرئيسية، الأتواب، الاستيراد من Excel، اللصاقات والطباعة).

### البنية المعمارية الحالية
| الطبقة | التقنية |
|--------|---------|
| الواجهة | React 19 + Vite 6 + Tailwind 4 |
| الـ API | Fastify 5 (Node) |
| قاعدة البيانات | PostgreSQL عبر `pg` — الاتصال من الخادم فقط (`DATABASE_URL` في `server/.env`) |
| تطبيق سطح المكتب | Electron 36 — الحزمة تُخرج إلى مجلد `release/`، اسم المنتج في الإعدادات: «CLOTEX — Clothes Textile» |
| الويب | نفس تطبيق SPA؛ يعمل عبر المتصفح مع ضبط `VITE_API_BASE_URL` |

### الحالة العامة (صريحة)
- **جاهز أو قريب من الإنتاج (متصل بـ PostgreSQL عبر الـ API):** المصادقة، التفعيل، الموردون، العملاء، المستودعات والمواقع، تصنيفات الأقمشة، الخامات، الألوان، المتغيرات، أتواب المخزون (`fabric_rolls`)، حركات المخزون، استيراد شراء Excel (دُفعات وصفوف)، قوالب اللصاقات، معاينة الطباعة، سجل مهام الطباعة، استيراد مخزون ذكي عبر `/api/inventory/stock-import`، إعدادات النظام والمستخدمين (جزء من `/api/system`)، Telegram (إعدادات وربط محادثات)، التفعيل بالمفاتيح.
- **واجهات تجريبية / بيانات ثابتة في الذاكرة (useState) أو Zustand محلي:** لوحة التحكم الرئيسية، جزء كبير من المحاسبة والخزينة والسندات والفواتير العامة، التقارير المركزية، الصفحات التجريبية للمناقلة والإهلاك وسجلات العملاء/الموردين، التصنيع، الشركاء، وغيرها (تفصيل في الأقسام التالية).
- **غير مكتمل أو خارج نطاق التسليم الحالي:** نشر الإنتاج الكامل على VPS (Nginx/SSL/خدمة systemd) كعملية تشغيل موحّدة غير مُثبتة داخل هذا المستودع كسكربت جاهز؛ دعم العمل دون إنترنت غير مطلوب في هذه المرحلة وغير مطبّق.
- **يعتمد على الإنترنت/الشبكة:** أي عميل (متصفح أو Electron) يحتاج الوصول إلى **عنوان الـ API الخلفي**؛ قاعدة البيانات على VPS تُخدم **فقط** من خلال الخادم الخلفي، وليس من المتصفح أو Electron مباشرة.

### الحكم النهائي
- **هل المشروع «واجهة فقط»؟** **لا.** يوجد خادم Fastify حقيقي، ترحيلات SQL، وجداول PostgreSQL، وواجهات ملزمة بالـ API لمسارات المخزون والبيانات الرئيسية والاستيراد والطباعة والإعدادات.
- **ما الذي يتصل بـ PostgreSQL؟** كل ما يمر عبر مسارات `/api/*` الموثقة أدناه مع `authenticateRequest` يقرأ/يكتب في الجداول ذات الصلة (شركة واحدة عبر `company_id` من JWT).
- **ما الذي لا يزال Zustand/mock؟** لوحة التحكم، الفواتير المحلية، جزء من إنشاء المادة (مسارات احتياطية)، الطلبيات، كشوف الحسابات المحسوبة من Zustand، التقارير، المحاسبة، والعديد من صفحات الواجهة الإدارية الأخرى.

---

## 2. البنية التحتية وقاعدة البيانات السحابية

### VPS و PostgreSQL
- الخادم الخلفي يتصل بقاعدة البيانات عبر **`DATABASE_URL`** في `server/.env` (غير مرفوع في Git — `.gitignore` يتضمن `server/.env`).
- لا يوجد في الواجهة أو Electron أي متغير لاعتمادات PostgreSQL؛ هذا مطابق لمتطلب الأمان.

### نموذج الاتصال
```
المتصفح / Electron  →  HTTP(S) إلى Backend API (Fastify)
Backend API           →  PostgreSQL على VPS (connection string على الخادم فقط)
```
**ممنوع:** المتصفح أو Electron → PostgreSQL مباشرة.

### نفق SSH في التطوير
- لا يظهر في الكود إلزام بنفق SSH؛ الاتصال العادي هو `DATABASE_URL` يشير إلى استضافة PostgreSQL. يمكن للمطور استخدام نفق يدوي خارج التطبيق دون أن يفرضه المشروع.

### تشغيل الخادم ضد قاعدة VPS
- نعم: أي `DATABASE_URL` صالح (محلي أو VPS) يعمل مع `npm run server:dev` / `server:start` بعد `server:migrate` و`server:seed` حسب الحاجة.

### متغيرات البيئة الأساسية (الخادم)
من `server/src/config/env.ts` و `server/.env.example`:
- `NODE_ENV`, `PORT` (افتراضي 4010), **`DATABASE_URL`** (إلزامي), `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`, `APP_BASE_URL`
- اختياري/تخصصي: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ACTIVATION_KEY_PEPPER`, `ACTIVATION_GENERATE_DEV_KEYS`, **`ACTIVATION_REQUIRE_ACTIVE`** (افتراضي true), `SEED_ADMIN_PASSWORD`

### الواجهة (`vite`)
- **`VITE_API_BASE_URL`**: عنوان قاعدة الـ API للبناء/التشغيل (انظر جذر `.env.example`: `http://localhost:4010`).
- يمكن للمستخدم في المتصفح **تجاوز** ذلك بتخزين `fabric_erp_api_base_url` في `localStorage` (انظر `src/lib/api/client.ts`).

### لماذا يحتاج المشروع إنترنتاً؟
- لأن الـ API والـ DB **بعيدان** عن الجهاز؛ لا يوجد قاعدة بيانات محلية في العميل.

### ماذا يحدث عند انقطاع الشبكة أو الـ API؟
- `apiFetch` يرمي خطأ عربياً: «تعذر الاتصال بالخادم...» عند فشل `fetch` (`src/lib/api/client.ts`).
- عند غياب `VITE_API_BASE_URL` وعدم وجود بديل في `localStorage`: رسالة «لم يُضبط VITE_API_BASE_URL».
- `/api/health`: إذا كانت قاعدة البيانات غير متصلة يرجع **503** مع `ok: false` و`database: 'disconnected'` (`server/src/routes/healthRoutes.ts`).

### Electron وعنوان الـ API
- إعدادات سطح المكتب (بما فيها `apiBaseUrl`) تُحفظ في ملف JSON تحت `userData` عبر IPC (`electron/main.ts` / `preload.ts`).
- في الواجهة: دمج مع `getApiBaseUrl()` — أولوية لـ `localStorage` ثم `VITE_API_BASE_URL`.

---

## 3. مراجعة قاعدة البيانات (الترحيلات)

جميع الملفات تحت `server/src/db/migrations/` وتُطبَّق بالترتيب الأبجدي عبر `migrate.ts` مع جدول `schema_migrations`.

| الملف | الغرض | الجداول / التعديلات الرئيسية | الدور التجاري | نشاط في الواجهة |
|-------|--------|-------------------------------|---------------|------------------|
| **001_core_foundation.sql** | أساس الشركات والمستخدمين والمستودعات | `companies`, `roles`, `permissions`, `role_permissions`, `users`, `warehouses`, `currencies`, `system_settings`, `audit_logs` | شركة، مستخدم، صلاحيات، مستودع، عملات، إعدادات | مستخدمون وإعدادات عبر API |
| **002_textile_master_data.sql** | بيانات الأطراف والكتالوج | `suppliers`, `customers`, `fabric_categories`, `fabric_items`, `fabric_colors`, `fabric_item_variants`, `warehouse_locations` | موردون، عملاء، تصنيف، خامات، ألوان، متغيرات، مواقع | شاشات CRUD المرتبطة بالـ API |
| **003_master_data_improvements.sql** | تحسين النطاق والفهرسة | `fabric_colors.company_id`, `is_active`؛ فهارس GIN/B-tree | عزل الألوان حسب الشركة، بحث أسرع | يخدم كل شاشات الألوان/البحث |
| **004_fabric_rolls_inventory_engine.sql** | محرك الأتواب | `fabric_rolls`, `inventory_movements` مع أنواع حركة وقيود | مخزون فعلي وتدقيق حركات | شاشة الأتواب، النقل، الحالة، الاستيراد |
| **005_purchase_excel_import_batches.sql** | استيراد فواتير الشراء Excel | `purchase_import_batches`, `purchase_import_rows` | معاينة ثم تأكيد وإنشاء أتواب | `ImportExcel`, `ImportBatches` |
| **006_label_printing_foundation.sql** | الطباعة | `label_templates`, `print_jobs`, `printed_labels` | قوالب، مهام طباعة، تدقيق | `StickerPrinting`, `PrintJobs` |
| **007_telegram_messaging_foundation.sql** | تيليجرام للأطراف | أعمدة `telegram_*` على `customers`/`suppliers`; `telegram_delivery_logs` | إرسال/تسجيل مستقبلي | إعدادات في النظام |
| **008_telegram_chat_identity_linking.sql** | إعدادات البوت والربط | `telegram_bot_settings`, `telegram_chat_links`, `telegram_update_cache`; توسعة `telegram_delivery_logs` | ربط محادثات بالعملاء/الموردين | إعدادات Telegram |
| **009_activation_keys.sql** | ترخيص | `activation_keys`, `activation_events` | مفاتيح تفعيل ومتابعة | تفعيل الدخول، لوحة المفاتيح للمسؤول |
| **010_cloud_license_authority_hardening.sql** | تشديد الترخيص | توسعة حالات المفاتيح والأحداث؛ `activation_devices` | أجهزة مرتبطة بالتفعيل | تتبع الأجهزة |

### تصنيف الجداول (ملخص)
- **A — أساس/مصادقة/إعدادات:** `companies`, `users`, `roles`, `permissions`, `role_permissions`, `system_settings`, `audit_logs`, `currencies`
- **B — بيانات رئيسية:** `suppliers`, `customers`, `fabric_categories`, `fabric_items`, `fabric_colors`, `fabric_item_variants`, `warehouses`, `warehouse_locations`
- **C — أتواب ومخزون:** `fabric_rolls`, `inventory_movements`
- **D — استيراد Excel للشراء:** `purchase_import_batches`, `purchase_import_rows`
- **E — لصاقات وطباعة:** `label_templates`, `print_jobs`, `printed_labels`
- **F — Telegram:** `telegram_bot_settings`, `telegram_chat_links`, `telegram_update_cache`, `telegram_delivery_logs` + أعمدة على العملاء/الموردين
- **G — تفعيل:** `activation_keys`, `activation_events`, `activation_devices`
- **H — ميتا الترحيل:** `schema_migrations`

---

## 4. مراجعة واجهة الـ API الخلفية

**ملاحظة عامة:** معظم المسارات تحت `/api/...` تستخدم `authenticateRequest` وتفرض **`company_id`** من JWT (`server/src/middleware/auth.ts`). استثناءات واضحة: `/api/health`, `/api/system/info` (جزء من health/system)، `/api/auth/login`, مسارات التفعيل العامة، وبعض مسارات التفعيل الإدارية بعد تسجيل الدخول.

### المجموعات (ملف → بادئة → الحالة)

#### `healthRoutes.ts` — `/api`
| الطريقة | المسار | مصادقة | الجداول/الوظيفة | الحالة |
|---------|--------|--------|------------------|--------|
| GET | `/health` | لا | فحص اتصال DB عبر `dbHealthCheck` | **WORKING** |

#### `systemRoutes.ts` — `/api/system`
| الطريقة | المسار | مصادقة | ملاحظات |
|---------|--------|--------|---------|
| GET | `/info` | لا (عام) | معلومات النظام |
| GET | `/settings` | نعم | `system_settings` |
| PUT | `/settings/:key` | نعم | تحديث إعداد |
| POST | `/telegram/test` | نعم | اختبار بوت |
| GET | `/telegram/updates` | نعم | جلب تحديثات للمحادثات المرشحة |
| GET | `/permissions` | نعم | صلاحيات |
| PUT | `/roles/:code` | نعم | أدوار |
| GET/POST/PUT | `/users`, `/users/:id` | نعم | مستخدمون |

**الواجهة:** `SystemSettings.tsx` + `settingsApi.ts`.  
**الحالة:** **WORKING** للمسارات المستخدمة؛ أجزاء RBAC قد تكون **PARTIAL** حسب استخدام الواجهة الفعلي.

#### `authRoutes.ts` — `/api/auth`
| POST `/login` | POST `/logout` | GET `/me` |
**الجداول:** `users`، أدوار/صلاحيات للـ JWT.  
**الواجهة:** `Login.tsx`. **WORKING**.

#### `activationRoutes.ts` — `/api/activation`
| GET `/status` | POST `/activate` | GET `/keys` | POST `/keys/generate` | PATCH `/keys/:id/revoke` | GET `/events` | GET `/devices` |
**الجداول:** `activation_keys`, `activation_events`, `activation_devices`.  
**الواجهة:** `RequireActivation`, `ActivationSettingsPanel`, `ActivationKeyInput`, `activationApi.ts`.  
**الحالة:** **WORKING** (مع `ACTIVATION_REQUIRE_ACTIVE` يفرض التفعيل على باقي الـ API).

#### `supplierRoutes.ts` — `/api/suppliers`
CRUD + `PATCH .../toggle-status` — جدول `suppliers`.  
**الواجهة:** `Suppliers.tsx`. **WORKING**.

#### `customerRoutes.ts` — `/api/customers`
مثل الموردين — `customers`.  
**الواجهة:** `Customers.tsx`. **WORKING**.

#### `warehouseRoutes.ts` — `/api/warehouses`
قائمة، تفاصيل، CRUD، تبديل حالة، **مواقع:** `GET|POST /:warehouseId/locations` — `warehouse_locations`.  
**الواجهة:** `Warehouses.tsx`. **WORKING**.

#### `warehouseRoutes.ts` (plugin ثانٍ) — `/api/warehouse-locations`
`PUT /:id`, `PATCH /:id/toggle-status` — تحديث موقع. **WORKING**.

#### `fabricCategoryRoutes.ts` — `/api/fabric/categories`
`GET /`, `/tree`, `/:id`, POST, PUT, `PATCH .../toggle-status`.  
**الواجهة:** `Categories.tsx`. **WORKING**.

#### `fabricItemRoutes.ts` — `/api/fabric/items`
CRUD كامل للخامات. **WORKING** — `FabricMasterData`, `CreateItem` (جزء الحفظ).

#### `fabricColorRoutes.ts` — `/api/fabric/colors`
CRUD. **WORKING**.

#### `fabricVariantRoutes.ts` — `/api/fabric/variants`
CRUD. **WORKING**.

#### `fabricRollRoutes.ts` — `/api/inventory/rolls`
قائمة، تفاصيل، إنشاء، تحديث، تغيير حالة، نقل، حركات.  
**الجداول:** `fabric_rolls`, `inventory_movements`, مستودعات، مواقع.  
**الواجهة:** `Inventory.tsx`, `CreateRoll.tsx`, `RollDetails.tsx`. **WORKING**.

#### `stockImportRoutes.ts` — `/api/inventory/stock-import`
`POST /` — استيراد بالجملة من صفوف محللة مسبقاً.  
**الواجهة:** `StockExcelImportModal.tsx`. **WORKING**.

#### `purchaseImportRoutes.ts` — `/api/purchases/import`
`POST /preview`, `GET /`, `GET /:id`, `GET /:id/rows`, `POST /:id/confirm`, `POST /:id/cancel`.  
**الواجهة:** `ImportExcel.tsx`, `ImportBatches.tsx`. **WORKING**.

#### `labelPrintRoutes.ts` — `/api/labels`
قوالب، معاينة أدوات، مهام طباعة، تحديث حالة المهمة، قوائم.  
**الواجهة:** `StickerPrinting.tsx`, `PrintJobs.tsx`, طباعة مرتبطة بالأدوات. **WORKING** / **PARTIAL** إن وُجدت ميزات طباعة تعتمد على سيناريوهات غير مكتملة على الجهاز.

#### `telegramRoutes.ts` — `/api/telegram`
إعدادات، اختبار، جلب تحديثات، محادثات مكتشفة، روابط محادثات CRUD، رسالة تجريبية.  
**الواجهة:** تبويبات/استدعاءات من `telegramApi.ts` و`SystemSettings`. **WORKING** للإعدادات؛ إرسال فواتير PDF تلقائي قد يكون **FUTURE** حسب الربط مع مستندات الفوترة.

---

## 5. خريطة المسارات في الواجهة

| المسار | التسمية العربية | المكوّن | الغرض | مصدر البيانات | الحالة | ملاحظات |
|--------|-----------------|---------|--------|---------------|--------|---------|
| `/login` | تسجيل الدخول | `Login.tsx` | JWT + فحص تفعيل | PostgreSQL API | **REAL_CONNECTED** | — |
| `/` | الرئيسية | `Dashboard.tsx` | لوحة معلومات | **Zustand** (`mockInitialData`) | **MOCK** | لا يقرأ KPI من الـ API |
| `/inventory` | أتواب الأقمشة | `Inventory.tsx` | قائمة الأتواب | PostgreSQL API | **REAL_CONNECTED** | — |
| `/inventory/create` | إنشاء مادة | `CreateItem.tsx` | خامة + توليد ثوب | **مختلط:** API + Zustand احتياطي | **PARTIAL** | شجرة التصنيف من Zustand إن لم تُستبدل |
| `/inventory/edit/:id` | تعديل مادة | `CreateItem.tsx` | كإنشاء مادة | **PARTIAL** | يعتمد على تطابق id مع Zustand للتحرير القديم |
| `/inventory/settings` | إعدادات المخزون | `InventorySettings.tsx` | عتبات محلية | localStorage | **PARTIAL** | ليس تزامناً مع الخادم |
| `/inventory/labels` | طباعة الاستيكرات | `StickerPrinting.tsx` | معاينة/طباعة | PostgreSQL API | **REAL_CONNECTED** | Electron للطباعة الأصلية |
| `/inventory/bulk-pricing` | تسعير جماعي | `BulkPricing.tsx` | أسعار حسب الاسم | Zustand | **MOCK** | — |
| `/inventory/warehouses` | المستودعات | `Warehouses.tsx` | CRUD | PostgreSQL API | **REAL_CONNECTED** | — |
| `/inventory/transfers` | المناقلة | `Transfers.tsx` | واجهة ثابتة | static UI | **DEMO_ONLY** | النقل الحقيقي عبر `rolls/:id/move` في API |
| `/inventory/depreciation` | إهلاك | `Depreciation.tsx` | عرض ثابت | static/demo | **DEMO_ONLY** | — |
| `/inventory/categories` | تصنيفات الأقمشة | `Categories.tsx` | شجرة | PostgreSQL API | **REAL_CONNECTED** | — |
| `/inventory/fabric-master-data` | تعريفات الأقمشة | `FabricMasterData.tsx` | لوحة رئيسية للبيانات | PostgreSQL API | **REAL_CONNECTED** | مسار مخفي من القائمة الرئيسية |
| `/inventory/rolls/new` | ثوب جديد | `CreateRoll.tsx` | إنشاء `fabric_rolls` | PostgreSQL API | **REAL_CONNECTED** | — |
| `/inventory/rolls/:id` | تفاصيل ثوب | `RollDetails.tsx` | تفاصيل/تعديل | PostgreSQL API | **REAL_CONNECTED** | — |
| `/inventory/rolls/:id/edit` | تعديل ثوب | `RollDetails.tsx` | كتفاصيل الثوب | **REAL_CONNECTED** | — |
| `/inventory/rolls/:id/move` | نقل ثوب | `RollDetails.tsx` | حركة مخزون | **REAL_CONNECTED** | — |
| `/purchases/import-excel` | استيراد Excel | `ImportExcel.tsx` | دفعات شراء | PostgreSQL API | **REAL_CONNECTED** | — |
| `/purchases/import-batches` | دفعات الاستيراد | `ImportBatches.tsx` | سجل الدفعات | **REAL_CONNECTED** | — |
| `/inventory/print-jobs` | سجل الطباعة | `PrintJobs.tsx` | `print_jobs` | **REAL_CONNECTED** | — |
| `/invoices/sales` | فواتير البيع | `Sales.tsx` | قائمة | Zustand | **MOCK** | — |
| `/invoices/sales/new` | فاتورة بيع جديدة | `InvoiceForm.tsx` | إنشاء | Zustand + زر تعبئة تجريبية | **MOCK** | يوجد زر «تعبئة بيانات تجريبية» |
| `/invoices/purchases` | فواتير الشراء | `Purchases.tsx` | قائمة | Zustand | **MOCK** | — |
| `/invoices/purchases/new` | فاتورة شراء | `InvoiceForm.tsx` | كفاتورة البيع | **MOCK** | — |
| `/invoices/exchange` | فواتير الصرف | `ExchangeInvoices.tsx` | واجهة | static | **DEMO_ONLY** | — |
| `/invoices/returns` | المرتجعات | `ReturnInvoices.tsx` | (نمطي) | static | **DEMO_ONLY** | يُفترض نفس النمط |
| `/invoices/statement` | كشف فاتورة | `InvoiceStatement.tsx` | كشف | Zustand | **MOCK** | — |
| `/orders` | الطلبيات | `CustomerOrdersPage.tsx` | طلبات عملاء | Zustand + زر «بيانات وهمية» | **MOCK** | — |
| `/treasury`, `/treasury/safes` | الخزينة | `Safes.tsx` | صناديق | static | **DEMO_ONLY** | — |
| `/treasury/log` | سجل الصندوق | `TreasuryLog.tsx` | — | static | **DEMO_ONLY** | — |
| `/treasury/settings` | إعدادات الصندوق | `TreasurySettings.tsx` | — | static | **DEMO_ONLY** | — |
| `/bonds/*` | السندات | صفحات السندات | — | static | **DEMO_ONLY** | — |
| `/salaries` | الرواتب | `Salaries.tsx` | — | static | **DEMO_ONLY** | — |
| `/reports` | التقارير | `ReportsCenter.tsx` | تقارير وهمية جزئياً | Zustand | **MOCK** | نصوص صريحة عن mockup |
| `/customers` | العملاء | `Customers.tsx` | CRUD | PostgreSQL API | **REAL_CONNECTED** | — |
| `/customers/log` | سجل العملاء | `CustomersLog.tsx` | سجل | static | **DEMO_ONLY** | — |
| `/customers/statement` | كشف عميل | `CustomerStatement.tsx` | كشف + زر وهمي | Zustand + صف وهمي | **PARTIAL** | زر «بيانات وهمية» |
| `/suppliers` | الموردون | `Suppliers.tsx` | CRUD | PostgreSQL API | **REAL_CONNECTED** | — |
| `/suppliers/log` | سجل الموردين | `SuppliersLog.tsx` | — | static | **DEMO_ONLY** | — |
| `/suppliers/statement` | كشف مورد | `SupplierStatement.tsx` | كشف + وهمي | Zustand | **PARTIAL** | — |
| `/expenses` | المصاريف | `Expenses.tsx` | — | Zustand | **MOCK** | — |
| `/chart-of-accounts` | شجرة الحسابات | `Accounting.tsx` | — | Zustand | **MOCK** | — |
| `/journal` | دفتر اليومية | `Journal.tsx` | — | Zustand | **MOCK** | — |
| `/manufacturing` | التصنيع | `Manufacturing.tsx` | عرض ثابت | static | **EXCLUDED** | استثناء التحليل المعمّق |
| `/partners` | الشركاء | `Partners.tsx` | عرض ثابت | static | **EXCLUDED** | استثناء التحليل المعمّق |
| `/settings` | إعدادات النظام | `SystemSettings.tsx` | API، Telegram، تفعيل، مستخدمون | PostgreSQL API + endpoints | **PARTIAL** | تبويبات متعددة؛ بعضها تجريبي في النصوص |
| `/settings/desktop` | إعدادات سطح المكتب | `DesktopSettings.tsx` | طابعات، URL | Electron IPC / localStorage | **PARTIAL** | يتطلب Electron للميزات الكاملة |

---

## 6. تدقيق المعالج النشط (ملخص معمّق)

### أ) لوحة التحكم
- تعرض إجمالي ياردات، عدد عملاء/موردين من **Zustand**، ديون عملاء، تنبيهات طلبيات من **Zustand**، روابط سريعة من `localStorage`.
- **ليست** متصلة بـ PostgreSQL للمؤشرات الرئيسية.

### ب) الموردون / ج) العملاء
- حقول مطابقة للجدول؛ بحث وتصفية عبر API؛ CRUD كامل. **مصدر الحقيقة: PostgreSQL.**

### د) المستودعات
- CRUD مستودعات؛ مواقع تحت كل مستودع؛ البذرة تنشئ **`MAIN`** «المستودع الرئيسي» (`seed.ts`). **PostgreSQL.**

### هـ) تصنيفات الأقمشة
- شجرة (`/tree`)؛ علاقة `parent_id`. التصميم المعتمد موثّق في مستودع `docs/`؛ أي تغيير حديث يجب مقارنته مع تقارير «approved design» الموجودة لتجنب الانحراف.

### و) الخامات / ز) الألوان / ح) المتغيرات
- خامات: `internal_code`, `supplier_code`, ارتباط تصنيف ومورد.
- ألوان: `name_ar`, `name_tr`, `color_code`, `supplier_color_code`, `hex_color`.
- متغيرات: `item_id`, `color_id`, `width_cm`, `gsm`, `variant_code` — محور الربط في إنشاء الثوب واستيراد Excel.

### ط) المخزون والأتواب
- `fabric_rolls`: باركود فريد لكل شركة، حالات، أوزان محسوبة/فعلية، ربط مستودع/موقع، حركات `inventory_movements`، ربط بالاستيراد واللصاقات.

### ي) استيراد فاتورة الشراء (Excel)
- معاينة، تحقق، أوضاع `MATCH_ONLY` و`CREATE_MISSING_MASTER_DATA`، دفعات وصفوف، تأكيد يُنشئ أتواباً وحركات `PURCHASE_RECEIPT`، قيود وأداء موثّقة في الخادم.

### ك) اللصاقات والطباعة
- قوالب افتراضية من البذرة؛ معاونة HTML؛ أوضاع A4 وملصق 100×80؛ `printed_labels`؛ في Electron: `printHtml` مع خيار silent — الطباعة الصامتة تابعة لإعدادات الجهاز والمسار في `main.ts`.

### ل) Electron (ويندوز)
- `contextIsolation`, بدون `nodeIntegration` في الواجهة؛ الإعدادات في `userData`; QR محلي عبر مكتبة `qrcode` دون طلبات شبكة خارجية (`qrGenerator.ts`). القيود: يحتاج API شغال؛ الطباعة الصامتة تعتمد على إعدادات الطابعة.

### م) Telegram
- تخزين التوكن مشفّر في `telegram_bot_settings`; حقول `telegram_*` على العملاء/الموردين؛ روابط محادثات وسجل `telegram_delivery_logs`. الإرسال الفعلي لملفات PDF للفواتير قد لا يكون مكتملاً لكل مسار محاسبي في الواجهة الوهمية.

### ن) التفعيل
- شكل المفتاح `XXXX.XXXX.XXXX.XXXX`؛ التخزين **hashed** (`sha256` مع pepper)؛ توليد من API للمسؤول؛ بذرة التطوير قد تولّد مفاتيح إذا `ACTIVATION_GENERATE_DEV_KEYS=true` داخل DB وليس ملف نصي منفصل للعميل.

### س) الإعدادات
- دمج «تطبيق سطح المكتب» داخل `SystemSettings`; اختبار اتصال `/api/health`; Telegram؛ تفعيل؛ مستخدمون من `/api/system/users`.

### ع) التقارير
- تعتمد على Zustand وبيانات وهمية جزئية؛ **ليست** تقارير إنتاج على PostgreSQL بالمعنى الكامل.

---

## 7. الوحدات المستثناة (موجز)

- **التصنيع** (`/manufacturing`, `Manufacturing.tsx`): بيانات `useState` ثابتة، أزرارwithout backend — **عرض تجريبي فقط**، خارج التسليم الحالي للعميل.
- **الشركاء** (`/partners`, `Partners.tsx`): نفس الأسلوب — **تجريبي**، خارج النطاق الحالي.

---

## 8) مراجعة البيانات الوهمية / التجريبية

| الزر/الميزة | الملف | الوحدة | ماذا ينشئ | التخزين | الخطورة | توصية |
|-------------|-------|--------|-----------|---------|---------|--------|
| «بيانات وهمية» | `CustomerOrdersPage.tsx` | الطلبيات | طلبيات وهمية + قوالب | Zustand | متوسطة | إخفاء أو تقييد قبل التسليم إن لم تُستخدم |
| «بيانات وهمية» | `CustomerStatement.tsx`, `SupplierStatement.tsx` | الكشوف | أسطر كشف وهمية | حالة محلية | متوسطة | توضيح أنها للمعاينة فقط أو إخفاء |
| «تعبئة بيانات تجريبية» | `InvoiceForm.tsx` | الفواتير | 20 سطراً وهمياً | حالة النموذج | متوسطة | يوجد TODO إزالة قبل الإنتاج في الكود |
| KPI وقوائم لوحة التحكم | `Dashboard.tsx` | الرئيسية | عرض أرقام من mock | Zustand | عالية للقرار التجاري | استبدال بـ API أو إخفاء الأرقام المضللة |
| `mockInitialData` / `seedDummyCustomerOrders` | `useStore.ts` | متعدد | بذرة ضخمة | Zustand مبدئي | عالية | لا تؤثر على PostgreSQL؛ خطر بصري/تشغيلي |
| طباعة تجريبية | `DesktopSettings.tsx` | سطح المكتب | اختبار طابعة | — | منخفضة | بقاءها مقبولاً |
| تقارير مع mockup | `ReportsCenter.tsx` | التقارير | عرض وهمي | Zustand | عالية | توضيح للعميل أو تعطيل الأقسام |
| تسميات «تجريبي» في Modal الطلبية | `OrderDetailModal.tsx` | الطلبيات | نص فقط | — | منخفضة | — |

---

## 9) خريطة مصدر الحقيقة (Truth Map)

| المجال | مصدر الحقيقة المطلوب | المصدر الحالي | الحالة |
|--------|----------------------|---------------|--------|
| الموردون | `suppliers` | PostgreSQL عبر API | مواءمة |
| العملاء | `customers` | PostgreSQL عبر API | مواءمة |
| المستودعات/المواقع | `warehouses`, `warehouse_locations` | PostgreSQL | مواءمة |
| التصنيفات | `fabric_categories` | PostgreSQL | مواءمة |
| الخامات/الألوان/المتغيرات | الجداول المعنية | PostgreSQL | مواءمة |
| الأتواب | `fabric_rolls` | PostgreSQL | مواءمة |
| الحركات | `inventory_movements` | PostgreSQL | مواءمة |
| استيراد الشراء | `purchase_import_*` | PostgreSQL | مواءمة |
| اللصاقات | `label_templates`, `print_jobs`, `printed_labels` | PostgreSQL | مواءمة |
| المستخدمون/إعدادات النظام | `users`, `system_settings` | PostgreSQL | مواءمة جزئياً مع واجهة |
| التفعيل | `activation_*` | PostgreSQL | مواءمة |
| Telegram | جداول Telegram + إعدادات | PostgreSQL | بنية جاهزة؛ محتوى الإرسال الكامل قد يكون ناقصاً |
| لوحة التحكم، الفواتير، التقارير، المحاسبة، الطلبيات | يجب أن تكون DB في الإنتاج | **Zustand / static** | **غير مواءمة** |
| التصنيع/الشركاء | — | static UI | demo |

---

## 10) تقرير اعتماد الإنترنت

**لماذا يلزم الاتصال؟**
- الـ API على خادم؛ PostgreSQL على VPS؛ العميل لا يحمل قاعدة بيانات محلية.

**ما يعمل دون إنترنت (عملياً):**
- واجهات تعتمد فقط على Zustand المبدئي (غير موثوقة للأعمال)؛ توليد QR للطباعة محلياً داخل الصفحة؛ عرض صفحات ثابتة.

**ما لا يعمل:**
- تسجيل الدخول، CRUD الحقيقي، المخزون، الاستيراد، الإعدادات من الخادم، التفعيل، فحص الصحة.

**رسائل الخطأ:** `apiFetch` يعطي عربية للشبكة؛ عند غياب عنوان الـ API رسالة تقنية نسبياً («لم يُضبط VITE_API_BASE_URL»).  
**مقترح احترافي (كما طلب المالك):** «تعذر الاتصال بالخادم. يرجى التحقق من إعدادات الاتصال.» — يمكن توحيدها مع رسالة `fetch` الحالية.

---

## 11) المراجعة الأمنية (بدون كشف أسرار)

| البند | النتيجة |
|------|---------|
| اعتمادات DB في الواجهة | **لا** — غير موجودة |
| أسرار في حزمة Electron | الحزمة تستثني `.env*`, `server`, `VPS.md` (`package.json` build.files) |
| `server/.env` في Git | **مُستبعد** |
| `VPS.md` في Git | **مُستبعد** |
| توكن Telegram في الواجهة | يُعرض **مقنع** عبر `tokenMasked` في DTO |
| مفاتيح التفعيل | تُخزَّن **م hashed**؛ الصيغة النصية لا تُخزَّن كاملة في DB |
| مصادقة API | JWT على المسارات المحمية |
| نطاق الشركة | `company_id` من التوكن في الاستعلامات |
| نقاط خطرة محتملة | مسارات التفعيل العامة مع rate limit؛ يجب حماية `ACTIVATION_KEY_PEPPER` و`JWT_SECRET` في الإنتاج |

---

## 12) أوضاع التشغيل

### أ) ويب (المتصفح)
- **تطوير:** `npm run dev` (Vite منفذ 3000 في السكربت) + `npm run server:dev` (4010).
- **إنتاج واجهة:** `npm run build` → مجلد `dist/`؛ يحتاج استضافة ملفات ثابتة وضبط `VITE_API_BASE_URL` أثناء البناء أو عبر `localStorage`.
- **قيود:** لا صمت طباعة أصلي كامل إلا عبر المتصفح/OS.

### ب) Electron التطوير
- **الأمر:** `npm run electron:dev` (يشغّل الخادم + Vite + Electron).
- **متطلبات:** backend reachable؛ للاختبار المحلي نفس الجهاز.

### ج) Electron المُجمَّع
- **المخرجات:** `release/` (حسب `package.json` directories.output).
- **الحدود:** يعتمد على إتاحة الـ API؛ الطباعة الصامتة عبر `silent` + اسم الطابعة في الإعدادات.

### د) إنتاج VPS (ويب + API)
- غير مُوثَّق هنا كسكربت جاهز واحد: يُنصح بـ systemd للـ API، Nginx كبروكسي، SSL، نطاق فرعي للـ API والتطبيق.

---

## 13) خريطة الملفات المهمة

| الفئة | مسارات أهمية |
|------|----------------|
| دخول الخادم | `server/src/index.ts`, `server/src/app.ts` |
| الترحيلات | `server/src/db/migrations/*.sql`, `server/src/db/migrate.ts` |
| البذور | `server/src/db/seed.ts` |
| المسارات | `server/src/routes/*.ts` |
| الإعدادات | `server/src/config/env.ts` |
| عميل API | `src/lib/api/*.ts`, `src/lib/api/client.ts` |
| صفحات رئيسية | `src/pages/**/*.tsx`, `src/App.tsx`, `src/layouts/DashboardLayout.tsx` |
| Electron | `electron/main.ts`, `electron/preload.ts`, `electron/types.ts` |
| الطباعة | `src/lib/printing/*`, `src/components/labels/*` |
| استيراد Excel | `src/lib/stockExcelImport.ts`, `server/src/utils/importColumnDetector.ts`, `purchaseImportRoutes.ts` |

---

## 14) مصفوفة اكتمال الوحدات

| الوحدة | Backend | DB | Frontend | Tests | الحالة | ملاحظات |
|--------|---------|-----|----------|-------|--------|---------|
| Auth | DONE | DONE | DONE | — | **DONE** | — |
| اتصال VPS | DONE | DONE | PARTIAL (إعداد URL) | — | **PARTIAL** | يعتمد على النشر |
| الموردون | DONE | DONE | DONE | — | **DONE** | — |
| العملاء | DONE | DONE | DONE | — | **DONE** | — |
| المستودعات | DONE | DONE | DONE | — | **DONE** | — |
| التصنيفات | DONE | DONE | DONE | — | **DONE** | — |
| الخامات | DONE | DONE | PARTIAL | — | **PARTIAL** | CreateItem مختلط |
| الألوان | DONE | DONE | DONE | — | **DONE** | — |
| المتغيرات | DONE | DONE | DONE | — | **DONE** | — |
| الأتواب | DONE | DONE | DONE | — | **DONE** | — |
| الحركات | DONE | DONE | عبر RollDetails | — | **DONE** | — |
| استيراد Excel | DONE | DONE | DONE | — | **DONE** | — |
| اللصاقات | DONE | DONE | DONE | — | **DONE** | — |
| Print Jobs | DONE | DONE | DONE | — | **DONE** | — |
| Electron | N/A | N/A | DONE | — | **PARTIAL** | صمت الطباعة حسب الجهاز |
| Telegram | DONE | DONE | PARTIAL | — | **PARTIAL** | إرسال PDF كامل قد يكون ناقصاً |
| التفعيل | DONE | DONE | DONE | — | **DONE** | يتطلب pepper في الإنتاج |
| لوحة التحكم | N/A | N/A | MOCK | — | **MOCK** | — |
| التقارير | N/A | N/A | MOCK | — | **MOCK** | — |
| التصنيع | — | — | DEMO | — | **EXCLUDED** | — |
| الشركاء | — | — | DEMO | — | **EXCLUDED** | — |

---

## 15) المخاطر والقضايا

| الخطورة | الوحدة | الخطر | توصية |
|---------|--------|-------|--------|
| عالية | لوحة التحكم / التقارير | أرقام مضللة من Zustand | ربط بـ API أو إخفاء/تسمية «تجريبي» |
| عالية | الفواتير المحلية | لا تزامن مع PostgreSQL | خطة تكامل محاسبي لاحقة |
| متوسطة | أزرار البيانات الوهمية | التباس للمستخدم | إخفاء أو صلاحيات |
| متوسطة | `VITE_API_BASE_URL` | رسالة تقنية للمستخدم | رسالة موحّدة بالعربية |
| متوسطة | نشر الإنتاج | غير مكتمل | Nginx + SSL + خدمة API |
| منخفضة | تنقل صفحات كثيرة | ازدواجية مع مسارات API الحقيقية | توثيق للمستخدم أي مسار «حقيقي» |

---

## 16) المراحل المقترحة التالية (بدون تصنيع/شركاء)

1. تنظيف تجربة المستخدم: إخفاء أو تسمية البيانات الوهمية في الواجهات الحرجة.
2. نشر الإنتاج على VPS: خدمة systemd للـ API، Nginx، SSL، نطاقات فرعية.
3. استكمال الطباعة الصامتة في Electron حسب أجهزة العملاء الفعلية.
4. إكمال مسار Telegram لإرسال PDF بعد اعتماد القوالب.
5. محاسبة فواتير الشراء الحقيقية إذا طلبها العميل.
6. تقارير من PostgreSQL بدلاً من Zustand.
7. تشديد الصلاحيات والمراجعة الدورية للـ JWT/CORS.
8. استراتيجية نسخ احتياطي لقاعدة البيانات على VPS.

---

## 17) نتائج البناء والتحقق

تم تنفيذ الأوامر التالية بنجاح (خروج 0):

- `npm run server:check` — تحقق TypeScript للخادم بدون أخطاء.
- `npm run build` — بناء Vite ناجح؛ تحذير حجم الحزمة و dynamic import لـ xlsx (غير مانع).
- `npm run electron:compile` — تجميع Electron ناجح.

---

## 18) خلاصة صريحة للمالك

المشروع **ليس** تطبيق واجهة فقط: يوجد **طبقة API كاملة** و**قاعدة بيانات مرنة** للمستودع النسيجي، وجزء كبير من شاشات المخزون والاستيراد والطباعة **يعكس PostgreSQL فعلياً**. بالمقابل، ما يزال هيكل ERP أوسع (محاسبة، خزينة، فواتير عامة، تقارير، طلبيات) يعتمد على **Zustand وبيانات تجريبية أو ثابتة** ويجب ألا يُعرَض ك«بيانات شركة حقيقية» دون تكامل لاحق.

**اعتماد السحابة والإنترنت:** أي استخدام إنتاجي للبيانات الحقيقية يتطلب بقاء الـ API والاتصال بـ PostgreSQL متاحين؛ لا يوجد وضع عمل دون اتصال في هذه المرحلة.

---

*نهاية التقرير.*
