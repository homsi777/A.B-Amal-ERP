# تقرير الاكتشاف المعمّق والبنية السحابية — نظام مستودعات الأقمشة (ERP)

**المشروع:** نظام إدارة مستودعات الأقمشة — واجهة «تيكس ماتريكس ERP»  
**تاريخ التقرير:** 2026-05-02  
**نطاق المهمة:** تحليل فقط — لا تعديل على سلوك التطبيق، ولا اتصال بقاعدة بيانات، ولا حذف للبيانات الوهمية في هذا الإصدار.

---

## ملخص تنفيذي

المشروع حالياً **واجهة أمامية فقط (SPA)** مبنية بـ **React 19 + Vite 6 + TypeScript + Tailwind CSS 4 + Zustand**. جميع البيانات التشغيلية (**المخزون، العملاء، الموردون، الفواتير، الحركات المحاسبية، المستودعات، شجرة التصنيفات**) مخزّنة في الذاكرة عبر **`src/store/useStore.ts`** مع كتلة **`mockInitialData`** ثابتة، وتُحدَّث الجلسة محلياً فقط (لا مزامنة سحابية).

استيراد Excel يعمل **في المتصفح** (`xlsx`) مع مسارين: استيراد مخزون عام (`src/lib/excelInventoryImport.ts`) واستيراد فواتير شراء تركية/بيانية (`src/lib/purchaseInvoiceExcelImport.ts`). الطباعة تعتمد **`window.print()`** وتوليد HTML/PDF محلي (`jspdf` + `html2canvas` في `src/lib/pdfExport.ts`).

يوجد **جسر تيليغرام جزئي فقط في بيئة التطوير:** ملف `vite.config.ts` يضيف middleware لمساري **`/api/telegram/invoice`** و **`/api/telegram/statement`** ويقرأ **`TELEGRAM_BOT_TOKEN`** و **`TELEGRAM_CHAT_ID`** من البيئة، ويولّد PDF عبر **Puppeteer + Chrome/Edge محلي**. هذا **لا يُبنى تلقائياً في إنتاج الـ frontend وحده** — يحتاج خادم API حقيقي لاحقاً.

**تنبيه أمني:** في جذر المشروع يوجد ملف **`VPS.md`** يحتوي بيانات اتصال حساسة (مضيف، منفذ SSH، كلمة مرور). **لا يجب الاحتفاظ بأي أسرار في المستودع.** يُفترض نقل الاعتمادات إلى `.env` على الخادم فقط، تدوير كلمات المرور إذا تعرّض الملف للنسخ، وعدم تضمين هذا التقرير لأي سر فعلي.

---

## 1. هيكل المشروع والتدقيق التقني

### 1.1 الإطار والأدوات

| العنصر | القيمة |
|--------|--------|
| الإطار | React 19 |
| البناء | Vite 6 (`vite.config.ts`) |
| اللغة | TypeScript (~5.8) |
| التوجيه | `react-router-dom` 7 |
| إدارة الحالة | Zustand (`src/store/useStore.ts`) |
| التنسيق | Tailwind CSS 4 (`@tailwindcss/vite`) |
| الجداول/Excel | `xlsx` |
| PDF/طباعة شاشة | `jspdf`, `html2canvas` |
| باركود/QR في الواجهة | `qrcode.react`، ورسم Code128 يدوي SVG في `StickerPrinting.tsx` |
| أيقونات | `lucide-react` |

**مدير الحزم:** npm (`package.json`, `package-lock.json`).

**نقطة الدخول:** `index.html` → `src/main.tsx` → `src/App.tsx`.

### 1.2 التوجيه (المسارات الرئيسية)

المسارات معرّفة في `src/App.tsx` داخل `DashboardLayout`:

| المسار | المكوّن | ملاحظة |
|--------|---------|--------|
| `/` | `Dashboard` | لوحة رئيسية |
| `/inventory` | `Inventory` | مخزون + استيراد Excel مخزون |
| `/inventory/create`, `/inventory/edit/:id` | `CreateItem` | إنشاء/تعديل مادة (لفة) |
| `/inventory/settings` | `InventorySettings` | إعدادات مخزون |
| `/inventory/labels` | `StickerPrinting` | طباعة استيكرات/لصاقات |
| `/inventory/bulk-pricing` | `BulkPricing` | تسعير جماعي |
| `/inventory/warehouses` | `Warehouses` | مستودعات |
| `/inventory/transfers` | `Transfers` | مناقلات — **بيانات ثابتة في المكوّن** |
| `/inventory/depreciation` | `Depreciation` | إهلاك |
| `/inventory/categories` | `Categories` | تصنيفات شجرية (مرتبطة بـ store) |
| `/invoices/sales`, `/new` | `Sales`, `InvoiceForm` | مبيعات |
| `/invoices/purchases`, `/new` | `Purchases`, `InvoiceForm` | مشتريات + استيراد Excel شراء |
| `/invoices/exchange`, `/returns` | `ExchangeInvoices`, `ReturnInvoices` | صرف/مرتجعات |
| `/invoices/statement`, `/:id` | `InvoiceStatement` | كشف فاتورة + طباعة |
| `/orders` | `CustomerOrdersPage` | طلبيات العملاء |
| `/treasury/*` | `Safes`, `TreasuryLog`, إلخ | خزينة |
| `/bonds/*` | سندات | |
| `/reports` | `ReportsCenter` | مركز تقارير |
| `/customers`, `/suppliers` + logs + statements | صفحات الأطراف | |
| `/expenses` | `Expenses` | مصاريف |
| `/chart-of-accounts`, `/journal` | محاسبة | |
| `/manufacturing` | `Manufacturing` | **واجهة عرض — أرقام وهمية محلية** |
| `/partners` | `Partners` | شركاء |
| `/settings` | `SystemSettings` | إعدادات — أغلب الأقسام **stub** ما عدا الثيمات |

**ملف غير مستخدم في التوجيه الحالي:** `src/pages/Reports.tsx` (يوجد `ReportsCenter` كصفحة التقارير الفعلية).

### 1.3 المجلدات والملفات المهمة

| المسار | الدور |
|--------|--------|
| `src/store/useStore.ts` | **مصدر الحقيقة الوهمي** — مخزون، فواتير، عملاء، موردون، معاملات، مستودعات، طلبيات، قوالب |
| `src/types/index.ts` | أنواع TypeScript (`FabricItem`, `Invoice`, …) — قريبة من نموذج «لفة/فاتورة» لكنها **لا تفصل كيان «حاوية» أو «استيراد دفعة»** |
| `src/layouts/DashboardLayout.tsx` | هيكل RTL، تنقل، تنبيهات طلبيات (جرس) من `customerOrders` |
| `src/theme/*` | ثيمات، `ThemeApplier.tsx`، تفضيلات UI في `localStorage` |
| `src/lib/purchaseInvoiceExcelImport.ts` | تحليل Excel فاتورة شراء (أعمدة تركية/إنجليزية) |
| `src/lib/excelInventoryImport.ts` | تحليل Excel مخزون (عربي — «اسم الصنف»، «المخزون»، …) |
| `src/lib/supplierLabelParser.ts` | تحليل باركود/QR مورد |
| `src/lib/fabricInvoiceSummary.ts` | تلخيص فواتير الأقمشة (مجموعات، أمتار، أوزان) |
| `src/lib/pdfExport.ts` | تصدير PDF من DOM |
| `src/lib/telegramInvoice.ts` / `telegramStatement.ts` | تنسيق رسائل + `fetch` إلى `/api/telegram/*` |
| `vite.config.ts` | **middleware تيليغرام + Puppeteer PDF** في التطوير فقط |
| `docs/textile-labeling-phase-1-discovery.md` وملفات مشابهة | وثائق سابقة عن اللصاقات/طابعات — **مرجع عمل وليست سلوك التطبيق** |

### 1.4 RTL والعربية

- `index.html`: `lang="ar"`, `dir="rtl"`.
- تواريخ: `date-fns` مع `locale: ar` في عدة صفحات.
- لصاقات `StickerPrinting`: نص إنجليزي غالباً على التصميم (علامة TEXTORIA) — **العربية/التركية في الإنتاج تحتاج قوالب قابلة للضبط**.

### 1.5 تصنيف الملفات

- **واجهة فقط:** كل `src/pages/**`, `src/components/**` باستثناء ما يستدعي API.
- **يعتمد على وهمي بالكامل:** `useStore` + أي صفحة تستخدمه بدون `fetch`.
- **جاهز لاحقاً لاستبدال بـ API:** الصفحات التي تفصل منطق العرض عن المصدر؛ أنواع `types/index.ts`؛ دوال الاستيراد التي يمكن نقلها للخادم كـ «معاينة/تحقق».

---

## 2. اكتشاف الوحدات (الأقسام الظاهرة)

لكل وحدة: المسار، الملف، الغرض، مصدر البيانات، الإجراءات، نواقص الخلفية، جداول مقترحة، واجهات API مقترحة، طباعة، جودة الواجهة، مستوى المخاطر.

### 2.1 لوحة الرئيسية `/`

- **المكوّن:** `src/pages/Dashboard.tsx`
- **الغرض:** KPIs سريعة، وصول سريع قابل للتخصيص (`localStorage` مفتاح `erp_quick_links`)، منتجات حديثة، مخزون منخفض، طلبيات حديثة.
- **البيانات:** `inventory`, `customers`, `customerOrders` من Zustand — **كلها وهمية/جلسة**.
- **الإجراءات:** روابط سريعة، تخصيص الاختصارات.
- **الخلفية:** لا تجميع سحابي؛ لا فترات زمنية حقيقية من خادم.
- **جداول:** `dashboard_cache` (اختياري لاحقاً)، أو استعلامات مباشرة.
- **API:** `GET /api/dashboard/summary`
- **طباعة:** لا.
- **الجودة:** جيدة بصرياً؛ الأرقام مرتبطة ببيانات زائفة.
- **المخاطر:** متوسط — قراءة KPI خاطئة إذا بقي المنطق «ياردة فقط» بينما البيانات أمتار.

### 2.2 المخزون `/inventory`

- **المكوّن:** `src/pages/Inventory.tsx`
- **الغرض:** عرض لفات/مواد، بحث، تصفية حالة، تجميع حسب اسم الخامة، استيراد Excel مخزون، QR لكل سطر.
- **البيانات:** `inventory`, `warehouses` من المتجر؛ الاستيراد يضيف عبر `importFabrics`.
- **ملاحظة نموذجية:** `FabricItem` يخلط **مفهوم صنف عام** و**لفة واحدة** (طول، باركود، رقم رول) في نفس السجل — يلائم العرض الحالي لكنه يحتاج إعادة نمذجة للإنتاج (انظر القسم 3).
- **API:** `GET/POST/PUT /api/inventory/rolls`، حركات، إلخ.
- **المخاطر:** عالٍ — без فصل roll صريح تتكرر أخطاء التجميع والفوترة.

### 2.3 إنشاء مادة `/inventory/create` و `/inventory/edit/:id`

- **المكوّن:** `src/pages/inventory/CreateItem.tsx` (لم يُعرض بالكامل في التدقيق — مرتبط بالمتجر)
- **الغرض:** إدخال لفة/مادة يدوياً.
- **البيانات:** إضافة/تحديث `FabricItem` في Zustand.

### 2.4 طباعة الاستيكرات `/inventory/labels`

- **المكوّن:** `src/pages/inventory/StickerPrinting.tsx`
- **الغرض:** اختيار لفات، ضبط مقاس اللصاقة (سم)، معاينة، طباعة متصفح، Code128 + QR payload نصي (`TXLABEL|...`).
- **البيانات:** من `inventory`.
- **طباعة:** نافذة جديدة + `window.print()`؛ تحميل QR من CDN في مستند الطباعة.
- **المخاطر:** متوسط — لا سجل `print_jobs`؛ لا دعم ESC/POS مباشر في الكود.

### 2.5 المشتريات `/invoices/purchases` + استيراد

- **المكوّن:** `src/pages/Purchases.tsx`
- **التدفق:** رفع Excel → `parsePurchaseInvoiceExcelFile` → قائمة لفات → **تأكيد كل باركود بالمسح اليدوي** → `importConfirmedPurchaseInvoice` ينشئ فاتورة شراء ومخزون.
- **قيود حالية:** المورد الافتراضي `suppliers[0]`؛ `warehouseId: 'main'` لكن المستودعات في الوهمي تستخدم معرفات `WH-01` — **عدم اتساق محتمل**؛ الإجمالي 0؛ لا حقل سعر/عملة من Excel في هذا المسار.
- **المخاطر:** عالٍ للإنتاج بدون مصفوفة أعمدة كاملة وتحقق خادم.

### 2.6 فواتير البيع `/invoices/sales` ونموذج `/invoices/*/new`

- **المكوّن:** `src/pages/invoices/InvoiceForm.tsx`
- **ميزات:** صفوف تفصيلية (خامة، dsam، رول، لون، أبعاد، GSM، وزن محسوب)، مسح ملصق مورد (`supplierLabelParser`)، إرسال تيليغرام عند الحفظ عبر `sendTelegramInvoiceNotification`.
- **البيانات:** تخزين محلي + محاسبة مبسطة في `createSaleInvoice` / `createPurchaseInvoice`.

### 2.7 مركز التقارير `/reports`

- **المكوّن:** `src/pages/reports/ReportsCenter.tsx`
- **الواقع:** معظم التقارير عند النقر تعرض **«البيانات قيد المعالجة»** (وهم). استثناء فعلي: **`كشف جرد مخزون الخامات`** (`FabricStockListReport`) يقرأ `inventory` ويطبع عبر `window.print()`.
- **لوحة تنفيذية:** KPIs محسوبة من `invoices` + `transactions` + `inventory` لكن **قائمة الأصناف الأكثر مبيعاً** تستخدم مصفوفة نصوص ثابتة `topSellingItemNames` — **وهم صريح**.

### 2.8 الطلبيات `/orders`

- **المكوّن:** `src/pages/orders/CustomerOrdersPage.tsx` + نوافذ
- **البيانات:** `customerOrders`؛ زر تعبئة تجريبية `seedDummyCustomerOrders` في المتجر يولّد طلبيات وهمية وصوراً من `picsum.photos`.

### 2.9 العملاء والموردون والكشوف

- **الصفحات:** `Customers.tsx`, `Suppliers.tsx`, `CustomersLog.tsx`, `SuppliersLog.tsx`, `CustomerStatement.tsx`, `SupplierStatement.tsx`
- **البيانات:** من المتجر؛ الكشوف تعتمد فواتير وحركات وهمية.
- **تيليغرام:** `BatchStatementExportModal` يستدعي `sendTelegramStatementPdf` → يحتاج خادم يخدم `/api/telegram/statement`.

### 2.10 الخزينة والسندات والمصاريف والرواتب

- صفحات موجودة وتربط بـ `transactions`/`expenses` الوهمية — **عمق محاسبي مبسّط جداً** (مثلاً مشتريات تخصم من حساب 51 بدلاً من أصل مخزون).

### 2.11 التصنيع `/manufacturing`

- **واجهة أرقام ثابتة في `useState`** — لا ربط بالمتجر.
- **المخاطر:** منخفض للنسيج الأساسي؛ يمكن تأجيله أو استبداله بنموذج حقيقي لاحقاً.

### 2.12 الإعدادات `/settings`

- **المكوّن:** `src/pages/SystemSettings.tsx`
- **يعمل:** `ThemeDisplaySettings` (ثيمات).
- **Placeholder:** مستخدمون، قاعدة بيانات، فوترة — «قيد الإعداد».

---

## 3. تحليل نموذج أعمال مستودع الأقمشة

### 3.1 الفصل المفترض بين الكيانات

| الكيان | المعنى التشغيلي | في الكود الحالي |
|--------|------------------|-----------------|
| **A. خامة / صنف قماش** | تعريف ثابت: نوع، كود مورد، كود داخلي، تصنيف، وحدة | ممزوج داخل `FabricItem.name` / `fabricCode` |
| **B. لون** | اسم عربي/تركي، أكواد مورد/داخلي | `colorName`, `colorCode` على مستوى اللفة فقط |
| **C. لفة (ثوب/رول)** | باركود، طول، عرض، GSM، وزن، دفعة، موقع، حالة | يُمثَّل كصف `FabricItem` واحد — قريب من اللفة لكن بدون جدول منفصل للـ SKU |
| **D. سطر فاتورة شراء** | تجميع لفات، أسعار، عملة، إجمالي وزن/طول | `InvoiceItem` مع `rollsCount` أحياناً؛ استيراد الشراء يضع سعر 0 |
| **E. حاوية** | رقم، مورد، تاريخ، إرفاق ملف، عدد لفات | **غير موجود ككيان** |
| **F. لصاقة** | حقول مطبوعة + قالب | منطق في `StickerPrinting` فقط — لا جدول قوالب |

### 3.2 رئيسي مقابل معاملاتي

- **رئيسي (Master):** شركات، مستخدمون، صلاحيات، موردون، عملاء، فئات أقمشة، تعريف خامة (`fabric_items`)، ألوان (`fabric_colors`)، متغيرات SKU (`fabric_item_variants`)، مستودعات، مواقع تخزين، عملات، إعدادات قوالب لصاقات.
- **معاملاتي:** فواتير شراء/بيع، أسطرها، **لفات المخزون** (`fabric_rolls`)، حركات المخزون، دفعات استيراد Excel، حاويات، طباعة، إشعارات، سجلات تدقيق.

---

## 4. تدقيق البيانات الوهمية (Mock)

### 4.1 المصدر المركزي

**الملف:** `src/store/useStore.ts` — كائن `mockInitialData`:

- **مستودعات:** `WH-01` … — أسماء وهمية.
- **شجرة تصنيفات:** `categoryTree` — هيكل تجريبي.
- **مخزون:** عناصر منها `F-1001`, `F-1002`, `F-30367550` (يشبه بيانات تركية/باركود).
- **عملاء/موردون:** `C-001`, `S-001`, أرصدة وهمية.
- **فواتير:** مبيعات `INV-4401`, مشتريات `PUR-882`, سلسلة `INV-AHM-*` لكشوف العميل.
- **معاملات دفتر أستاذ:** مصفوفة `transactions` مربوطة بالفواتير الوهمية.
- **مصاريف:** سطر واحد وهمي.

### 4.2 وهمي في واجهات محددة

- **`ReportsCenter` — ExecutiveDashboard:** `topSellingItemNames` ثابتة؛ تحذير ائتمان «2» ثابت؛ شيكات «0».
- **`Transfers`:** مصفوفة `useState` داخل الملف — لا علاقة بالمتجر.
- **`Manufacturing`:** أرقام وهمية محلية.
- **`CustomerOrdersPage`:** بعد `seedDummyCustomerOrders` — طلبيات وصور عشوائية.

### 4.3 أسماء/أرقام ثابتة في الإعدادات

- **`SystemSettings`:** قيم افتراضية لشركة «Golden Tailor»، ضريبة، سجل — **واجهة فقط بدون حفظ لمتجر**.

### 4.4 ماذا يُحذف لاحقاً وماذا يُحفظ كبذور

- **يُزال من الإنتاج:** أي تعبئة تلقائية لطلبيات (`seedDummyCustomerOrders`)؛ القوائم الثابتة في التقارير التنفيذية؛ سجلات المناقلة الوهمية في `Transfers`.
- **يُمكن الإبقاء عليه كـ seed اختياري:** جزء من `mockInitialData` لبيئة تجريبية بعد ترحيل DB.

---

## 5. خطة بنية سحابية (PostgreSQL على VPS) — Cloud-first

### 5.1 المبدأ

- **لا اتصال مباشر** من المتصفح إلى PostgreSQL.
- **خادم API** (مُفضَّل: **Node.js + TypeScript**، Fastify أو Express أو Nest) يعرض REST، يمسك JWT/جلسة، ويتصل بـ Postgres عبر **مجمع اتصالات** (مثل `pg` + connection pool).
- **المتغيرات:** `DATABASE_URL` أو `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NODE_ENV`, `CORS_ORIGIN`.

### 5.2 الترميز

- PostgreSQL: **UTF8** (`client_encoding=UTF8`)؛ جميع الجداول النصية `TEXT`/`VARCHAR` مع **ترحيلات تدعم العربية**.
- API: `Content-Type: application/json; charset=utf-8`.

### 5.3 الهجرات والنسخ الاحتياطي

- **أدوات:** Drizzle ORM / Prisma / Knex — ملفات ترحيل إصدارية.
- **النسخ:** `pg_dump` يومي + احتفاظ بزمني؛ اختبار استعادة دوري.
- **الأخطاء:** طبقة موحدة للاستجابات؛ تسجيل structured logging؛ لا إرجاع تفاصيل DB للعميل.

### 5.4 النشر

- Frontend ثابت على CDN/nginx أو نفس VPS؛ Backend خلف reverse proxy (nginx/caddy) مع **HTTPS**.
- قاعدة البيانات تستمع على localhost أو شبكة خاصة فقط؛ جدار ناري يحدّ من `/22` أو المنفذ المخصص.

---

## 6. الجداول المقترحة (PostgreSQL)

命名: **`snake_case` جمع**؛ مفاتيح أساسية **UUID** (`gen_random_uuid()`).

| الجدول | الغرض | حقول رئيسية | علاقات | الآن/لاحقاً |
|--------|--------|-------------|--------|-------------|
| `companies` | شركات | اسم، عملة أساسية | — | الآن |
| `users` | مستخدمون | بريد،hash كلمة سر، شركة | `companies` | الآن |
| `roles`, `permissions`, `role_permissions`, `user_roles` | صلاحيات | — | — | المرحلة 1–2 |
| `warehouses` | مستودعات | كود، اسم، نوع | `companies` | الآن |
| `warehouse_locations` | مواقع داخل المستودع | رمز الرف | `warehouses` | قريباً |
| `currencies`, `exchange_rates` | عملات وأسعار صرف | — | — | حسب الحاجة |
| `system_settings` | إعدادات عامة | مفتاح/قيمة JSON | `companies` | الآن |
| `suppliers`, `customers` | أطراف | أسماء، أرصدة مفتوحة لاحقاً | `companies` | الآن |
| `fabric_categories` | تصنيف أقمشة | شجرة اختياري | — | الآن |
| `fabric_items` | تعريف خامة | كود مورد، كود داخلي | فئة | الآن |
| `fabric_colors` | ألوان مرتبطة بخامة أو عامة | أكواد | `fabric_items` اختياري | الآن |
| `fabric_item_variants` | SKU (خامة + لون + عرض…) | — | items, colors | قريباً |
| `fabric_units` | وحدات | متر/ياردة | — | لاحقاً |
| `purchase_invoices`, `purchase_invoice_lines` | شراء | حالة، عملة، إجمالي | مورد، فاتورة | الآن |
| `purchase_import_batches`, `purchase_import_errors` | دفعات Excel | ملف، حالة، أخطاء JSON | — | المرحلة 4 |
| `containers`, `container_lines` | حاويات شحن | رقم، مورد، تاريخ | فاتورة/دفعة | حسب العمل |
| `fabric_rolls` | **لفة مخزون** | باركود فريد، طول، عرض، gsm، وزن، حالة، موقع | variant، مستودع، فاتورة شراء، حاوية | **أساسي** |
| `inventory_movements` | حركات | نوع، كمية، مرجع | لفة، مستخدم | الآن |
| `stock_adjustments` | تسويات | سبب، موافقة | — | لاحقاً |
| `label_templates`, `print_jobs`, `printed_labels` | طباعة | قالب، حالة Job، 롤 | — | المرحلة 5 |
| `sales_invoices`, `sales_invoice_lines`, `roll_reservations` | مبيعات | — | — | إن وُجدت |
| `report_exports`, `saved_report_filters` | تصدير | مسار ملف، مرشحات | مستخدم | لاحقاً |
| `telegram_settings`, `telegram_notification_logs` | تيليغرام | توكن **خادم فقط**، أحداث مفعّلة | — | المرحلة 7 |
| `audit_logs` | تدقيق | كيان، قبل/بعد | مستخدم | المرحلة 8 |

**فهارس:** فريد على `fabric_rolls.barcode`؛ مركب على `(warehouse_id, status)`؛ `GIN` لـ JSONB إن وُجد؛ تواريخ للتقارير.

---

## 7. خطة نقاط API (REST)

مجموعات مع صلاحيات (`inventory:read`, `purchase:import`, …):

| المجموعة | أمثلة | جداول |
|----------|-------|--------|
| Auth | `POST /api/auth/login`, `logout`, `GET /api/auth/me` | users, sessions |
| Dashboard | `GET /api/dashboard/summary` | تجميعات |
| لفات | `GET/POST/PUT /api/inventory/rolls`, `GET .../movements` | fabric_rolls, movements |
| أصناف/ألوان | `GET/POST /api/items`, `/api/colors` | fabric_* |
| مشتريات | `GET/POST /api/purchases`, `POST .../import-excel`, دفعات المعاينة | invoices, batches |
| حاويات | `GET/POST /api/containers` | containers |
| لصاقات | `GET /api/labels/templates`, `POST .../print`, `GET preview/:rollId` | templates, print_jobs |
| تقارير | `GET /api/reports/*`, `POST .../export` | استعلامات + report_exports |
| تيليغرام | `GET/PUT settings`, `POST test`, `POST send-event` | settings, logs |

**أشكال الطلب/الرد:** JSON موحّد `{ data, error, meta }`؛ للاستيراد: `{ batchId, rows[], warnings[], errors[], summary }`.

---

## 8. محرك استيراد Excel — التصميم المهني

### 8.1 الوضع الحالي في المشروع

- **شراء:** `parsePurchaseInvoiceExcelFile` — يقرأ أول شيت، يطابق أعمدة (`barkod`, `stokadi`, `metre`, …)، يُنذر بالمكرر، لا يوجد **تعيين أعمدة يدوي** في الواجهة.
- **مخزون:** `parseInventoryExcelFile` — يبحث صف رؤوس عربي (`اسم الصنف`)، أوراق باسم `وارد`/`المخزون`.

### 8.2 المطلوب للإنتاج (Workflow المطلوب بالمهمة)

1. رفع الملف → تخزين مؤقت آمن على الخادم (فيروسات/حجم).
2. **كشف القالب/المورد** (أو اختيار يدوي لقالب محفوظ في `import_templates`).
3. **تعيين الأعمدة** (واجهة سحب/قائمة): كود مادة، لون، طول، عرض، GSM، وزن، سعر، عملة، رقم رول، ملاحظات.
4. **تحقق:** قواعد إلزامية، نطاقات رقمية، تكرار باركود، وزن مستحيل، تطابق المورد، مجموعات متسقة مع إجمالي الفاتورة.
5. **معاينة:** صفوف OK / تحذير / خطأ؛ مواد/ألوان جديدة مقترحة؛ إجماليات أمتار/وزن/قيمة.
6. **تأكيد:**_transactionally_ إنشاء فاتورة، الأسطر، اللفات، حركات «أولية»، ربط حاوية إن وُجدت؛ طابور طباعة اختياري.
7. **تقرير نهائي:** ملخص قابل للطباعة + سجل في `purchase_import_batches`.

**لا استيراد أعمى:** المعاينة والتأكيد شرطا قبول.

---

## 9. الطباعة واللصاقات — تدقيق

### 9.1 أزرار طباعة موجودة

- `StickerPrinting`: طباعة لصاقات لفات — معاينة على الشاشة، Code128 مرسوم SVG، QR في نافذة الطباعة عبر مكتبة CDN.
- `ReportsCenter` / `FabricStockListReport`: `window.print()`.
- `InvoiceStatement`, `CustomerStatement`, `SupplierStatement`: طباعة كشوف.
- `OrderDetailModal`: `window.print()`.
- `CollectionBonds` / `PaymentBonds`: أيقونة طباعة — يغلب أنها شكلية (لم يُتحقق من التنفيذ الكامل لكل سند).

### 9.2 الإجابات على أسئلة التدقيق

| السؤال | الجواب في المشروع الحالي |
|--------|---------------------------|
| أزرار الطباعة | موجودة في الأماكن أعلاه |
| ما الذي يُطبع؟ | لصاقة لفة؛ كشف مخزون؛ كشوف حسابات وفواتير (عرض HTML) |
| معاينة | نعم للصاقات والكشف النسيجي |
| طباعة المتصفح | نعم أساساً |
| طابعة حرارية | **لا** في الكود — وثائق `docs/xprinter-xp480b-label-print-test.md` تشير لتجارب منفصلة |
| مقاسات | إعدادات سم في `StickerPrinting` (افتراضي 10×8 سم) |
| باركود/QR | Code128 + QR نصي |
| عربي/تركي | الواجهة عربية؛ محتوى اللصاقة إنجليزي غالباً |
| سجل طباعة | **لا** |
| عند إنشاء لفة | لا طباعة تلقائية — يدوي من صفحة اللصاقات |
| إعادة طباعة / تتبع | غير مطبّق كبيانات |

### 9.3 مقترح لاحق

- جداول `label_templates` (HTML/ZPL escpos اختياري)، `print_jobs` (حالة، جهاز، مستخدم)، `printed_labels` (roll_id، مرات الطباعة).
- استراتيجية باركود: **قيمة فريدة عالمياً** لكل لفة؛ QR يحمل URL عام أو `roll:<uuid>` للمسح داخلياً.

---

## 10. التقارير والكشوف

### 10.1 ما هو «حقيقي» نسبياً

- **كشف جرد مخزون الخامات** داخل `ReportsCenter`: يبني الجدول من `inventory` الفعلي في Zustand — لكن البيانات نفسها وهمية الأصل.

### 10.2 ما هو وهمي

- باقي بطاقات التقارير في المركز: رسالة «قيد المعالجة».
- **لوحة KPI التنفيذية:** خليط حسابات من بيانات وهمية + عناصر ثابتة.

### 10.3 جدول تقارير مقترح للنسيج (مصدرها الجداول بعد الترحيل)

| التقرير | الفلاتر | أعمدة رئيسية | الجداول |
|---------|---------|--------------|---------|
| مخزون حسب خامة | خامة، مستودع | أوزان، أمتار | rolls مجمّعة |
| مخزون حسب لون | لون، كود | — | fabric_colors, rolls |
| مخزون Roll | باركود، حالة | تفاصيل لفة | fabric_rolls |
| حركة لفة | تاريخ، نوع | من/إلى | inventory_movements |
| فواتير شراء | مورد، فترة | إجماليات | purchase_* |
| كشف مورد | فترة | مدين/دائن | transactions نظيفة لاحقاً |
| تسوية حاوية | رقم حاوية | متوقع vs فعلي | containers, rolls |
| تصدير | PDF/Excel | — | report_exports |

---

## 11. تيليغرام — تحليل وتصميم

### 11.1 الموجود

- **`telegramInvoice.ts` / `telegramStatement.ts`:** تنسيق رسائل + `fetch('/api/telegram/invoice|statement')`.
- **`vite.config.ts`:** يحقن middleware في **خادم التطوير فقط** لإرسال `sendMessage` + `sendDocument` إذا وُجد HTML للـ PDF، مع Puppeteer.

### 11.2 النواقص للإنتاج

- لا وجود للمسارات في `vite preview`/الاستضافة الثابتة بدون backend.
- التوكن في `.env` محلي لـ Vite — يجب أن يبقى **سيرفر سايد** فقط في الإنتاج.
- لا `telegram_notification_logs` في الواجهة.
- لا أحداث مفعّلة/معطّلة لكل نوع حدث من الواجهة.

### 11.3 أحداث مطلوبة (كما في المهمة)

- فاتورة شراء جديدة؛ انتهاء استيراد Excel؛ استيراد بأخطاء؛ ترحيل حاوية للمخزون؛ طباعة لصاقات دفعة؛ تسوية مخزون؛ تنبيه مخزون منخفض؛ حركة كبيرة؛ أخطاء خادم/نسخ احتياطي.

كل حدث: سجل في `telegram_notification_logs` (النوع، الحالة، الخطأ، `sent_at`).

---

## 12. خريطة المهام — جدول مركزي

| الوحدة | مهام | جداول | API | صفحات UI | طباعة | تيليغرام |
|--------|------|-------|-----|----------|-------|----------|
| لوحة رئيسية | تلخيص KPI حقيقي | تجميعات | `GET /dashboard/summary` | `Dashboard` | — | اختياري لاحقاً |
| مخزون لفات | CRUD، بحث، حالة | fabric_rolls, warehouses | rolls API | `Inventory`, `CreateItem` | لصاقة | — |
| مشتريات | فاتورة، استيراد، تأكيد | purchase_*, import_batches | purchases, import | `Purchases`, `InvoiceForm` | كشف | فاتورة جديدة، استيراد |
| حاويات | تسجيل، مطابقة | containers | containers | **غير موجود — للبناء** | تقرير | ترحيل |
| عملاء/موردون | أطراف، كشوف | customers, suppliers | parties | `Customers`, `Suppliers`, statements | كشف | كشف PDF |
| طلبيات | حالات، قوالب | orders لاحقاً | orders API | `CustomerOrdersPage` | طلب | — |
| تقارير | تقارير نسيج، تصدير | views | reports | `ReportsCenter` | كشف مخزون | — |
| لصاقات | قوالب، طباعة دفعات | print_* | labels | `StickerPrinting` | لصاقة | بعد الطباعة |
| إعدادات | شركة، تيليغرام، مستخدمون | system_settings, telegram_* | settings | `SystemSettings` | — | اختبار |

---

## 13. تحليل الفجوات (Gap)

| الفجوة | التصنيف | الأثر | ملفات/مناطق | الإصلاح المقترح | المرحلة |
|--------|---------|-------|-------------|-----------------|---------|
| لا backend CRUD | حرج | لا إنتاج | المشروع كله | خادم Node + Postgres | 1 |
| بيانات ذاكرة فقط | حرج | فقدان عند التحديث | `useStore.ts` | API + استبدال تدريجي للمتجر | 1–3 |
| لا مصادقة | حرج | تسريب بيانات | — | JWT + جلسات | 1 |
| نموذج لفة/SKU مختلط | عالٍ | أخطاء جرد وفوترة | `FabricItem`, صفحات المخزون | جداول منفصلة | 3 |
| استيراد شراء بدون تعيين أعمدة كامل ولا أسعار | عالٍ | بيانات ناقصة | `purchaseInvoiceExcelImport.ts`, `Purchases.tsx` | محرك خادم + UI | 4 |
| حاويات غير موجودة | عالٍ لتجارة الحاويات | — | — | جداول + UI | 4–5 |
| تيليغرام عبر Vite dev فقط | عالٍ للإشعارات | لا إرسال في prod | `vite.config.ts`, `telegram*.ts` | API موحّد | 7 |
| تقارير وهمية | متوسط | قرارات خاطئة | `ReportsCenter` | استعلامات حقيقية | 6 |
| سجل طباعة معدوم | متوسط | لا تدقيق | `StickerPrinting` | print_jobs | 5 |
| ملف VPS بأسرار | حرج أمني | تسريب | `VPS.md` | إزالة/تدوير/`.env` | فوري |

---

## 14. خطة تنفيذ بالمراحل

| المرحلة | الهدف | مخرجات | ملفات مرجحة | مخاطر | معيار نجاح |
|---------|--------|--------|-------------|--------|------------|
| **0** | اكتشاف وتقرير | هذا المستند | docs/* | — | موافقة صاحب المشروع |
| **1** | خادم + Postgres + هجرات + auth | API يعمل، مستخدم إداري | جديد `server/**`, migrations | إعداد Firewall/VPN | تسجيل دخول + اتصال DB |
| **2** | بيانات رئيسية | عملاء، موردون، مستودعات، تصنيفات | صفحات الأطراف | — | CRUD كامل |
| **3** | لفات + حركات | مخزون بالرول | `Inventory`, أنواع | نمذجة صحيحة | لفة فريدة باركود |
| **4** | شراء + استيراد Excel | دفعات، معاينة، تأكيد | `Purchases`, خادم استيراد | أداء ملفات ضخمة | 560 صف بلا أخطاء حرجة |
| **5** | لصاقات وطباعة | قوالب، سجل | `StickerPrinting` | طابعات | إعادة طباعة مسجلة |
| **6** | تقارير وتصدير | PDF/Excel | `ReportsCenter` | استعلامات ثقيلة | تقارير على بيانات حقيقية |
| **7** | تيليغرام | إعدادات، سجلات | استبدال middleware Vite | أسرار | أحداث من الخادم |
| **8** | تصليب | صلاحيات، نسخ، مراقبة | — | — | جاهزية إنتاج |

---

## 15. التوصية الفورية وما يلي التقرير

### 15.1 ماذا يُبنى أولاً؟

1. **خادم API + PostgreSQL + مصادقة + هجرات** — بدون هذا لا يوجد أساس صحيح.
2. نموذج **لفة (`fabric_rolls`)** منفصل عن تعريف الخامة — قبل تعقيد المبيعات والتصنيع.

### 15.2 ما لا يُبنى قبل الأساس؟

- تعميق المحاسبة المزدوجة، التصنيع Odoo-like، أو تقارير تنفيذية معتمدة على «أكثر الأصناف مبيعاً» الوهمية.

### 15.3 البيانات الوهمية مؤقتاً

- الإبقاء على `mockInitialData` **كمصدر بديل للتطوير المحلي** حتى تكتمل واجهات API؛ ثم جعلها **seed** اختياري فقط (`SEED_DEMO=true`).

### 15.4 الاتصال الآمن بـ PostgreSQL على VPS

- PostgreSQL يستمع داخلياً؛ التطبيق على نفس الشبكة أو عبر VPN؛ **SSL لـ Postgres** إن لزم؛ الاعتمادات في `.env` على الخادم فقط؛ لا تضمين في الواجهة أو Git.

### 15.5 ما يحتاجه المالك من اعتمادات (قائمة — بدون قيم)

- `DATABASE_URL` أو معاملات PG كاملة.
- نطاق/HTTPS للإنتاج.
- مستخدمي الإدارة الأوليين.
- **توكن بوت تيليغرام + معرف محادثة** للإشعارات (للخادم فقط).
- سياسة النسخ الاحتياطي المطلوبة.

### 15.6 ماذا يفعل Cursor/Codex بعد هذا التقرير؟

1. تهيئة مشروع backend (مجلد مستقل أو monorepo) مع ترحيل أولي للجداول الأساسية.
2. استبدال تدريجي لـ `useStore` بـ hooks تستدعي API (طبقة `apiClient`).
3. نقل منطق استيراد Excel إلى الخادم مع نفس قواعد التحقق + جلسات معاينة.
4. استبدال middleware تيليغرام في Vite بمسارات API حقيقية على الخادم مع تسجيل الأحداث.

---

**نهاية التقرير.**  
هذا الملف جاهز لتمريره إلى ChatGPT أو أي مخطط مهام لاحق لبناء خطة سبرنت تفصيلية دون تعديل سلوك الواجهة الحالية.
