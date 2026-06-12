# خطة الترجمة التركية الشاملة — CLOTEX ERP

> **الغرض:** وثيقة تنفيذ جاهزة لترجمة واجهة النظام من العربية إلى التركية، قسمًا بقسم، دون المساس بالتصميم.  
> **الجمهور:** فريق التطوير / التنفيذ عند الطلب.  
> **آخر تحديث:** 2026-06-12  
> **الحالة:** المراحل 1–3 منجزة — باقي الأقسام في انتظار الموافقة والتنفيذ.

---

## 1. ملخص تنفيذي

| البند | التفاصيل |
|-------|----------|
| **اللغات** | العربية (افتراضي، RTL) · التركية (اختياري، LTR) |
| **المكتبة** | `react-i18next` + `i18next` |
| **تخزين الاختيار** | `localStorage` → مفتاح `fabric-erp-language` |
| **زر اللغة** | أعلى الصفحة بجانب الإشعارات + صفحة الدخول |
| **مبدأ التصميم** | لا تغيير CSS/layout إلا ما يتطلبه `dir` و`start/end` |
| **التراجع** | Git revert لأي مرحلة — لا migrations في الترجمة |

---

## 2. ما تم إنجازه (لا تُعاد ترجمته إلا للتصحيح)

| المرحلة | الملفات | namespace |
|---------|---------|-----------|
| **1 — البنية** | `src/i18n/*`, `LanguageSwitcher.tsx`, `DashboardLayout.tsx` | `common`, `nav` |
| **2 — الدخول** | `src/pages/Login.tsx` | `login` |
| **3 — الرئيسية** | `src/pages/Dashboard.tsx` | `dashboard` |

**ملفات الترجمة الحالية:**

```
src/locales/ar/common.json
src/locales/ar/login.json
src/locales/ar/nav.json
src/locales/ar/dashboard.json
src/locales/tr/common.json
src/locales/tr/login.json
src/locales/tr/nav.json
src/locales/tr/dashboard.json
```

---

## 3. البنية التقنية المعتمدة

### 3.1 إضافة namespace جديد لكل قسم

1. إنشاء `src/locales/ar/{section}.json`
2. إنشاء `src/locales/tr/{section}.json`
3. تسجيلهما في `src/i18n/config.ts` ضمن `resources` و`ns`
4. في الصفحة: `const { t, i18n } = useTranslation('{section}');`
5. استبدال النصوص الثابتة بـ `t('key')` أو `t('key', { ns: 'common' })`

### 3.2 مفاتيح التسمية (Naming)

```
{section}.title
{section}.subtitle
{section}.actions.save
{section}.table.columns.fabricName
{section}.filters.status
{section}.errors.loadFailed
{section}.empty.noData
```

**أمثلة:** `inventory.rolls.title`, `invoices.sales.paymentStatus`

### 3.3 النصوص المشتركة → `common.json`

تُوضَع مرة واحدة وتُعاد استخدامها:

- `cancel`, `save`, `delete`, `edit`, `add`, `search`, `refresh`, `close`
- `loading`, `noData`, `confirm`, `yes`, `no`
- `fromDate`, `toDate`, `currency`, `total`, `notes`
- رسائل toast العامة

### 3.4 تنسيق الأرقام والتواريخ

```typescript
const numberLocale = i18n.language === 'tr' ? 'tr-TR' : 'ar-SY';
value.toLocaleString(numberLocale, { ... });
```

- التواريخ: `date-fns` مع `ar` أو `tr` locale حسب اللغة
- العملات: رمز العملة يبقى كما هو (USD, TRY...) — يُترجم الوصف فقط

### 3.5 RTL / LTR

| العنصر | العربية | التركية |
|--------|---------|---------|
| `document.documentElement.dir` | `rtl` | `ltr` |
| محاذاة الجداول | `text-start` / `text-end` بدل `text-right`/`text-left` حيث أمكن | نفس الشيء |
| القوائم المنسدلة | `end-0` بدل `right-0` | تلقائي |
| أيقونات الاتجاه | لا تُعكس إلا إن لزم | — |

**ممنوع في كل مرحلة:** إعادة تصميم البطاقات، الألوان، الخطوط، أو PDF بدون موافقة صريحة.

### 3.6 بيانات المستخدم (لا تُترجم)

- أسماء العملاء، الموردين، الخامات، الألوان
- أرقام الفواتير، الباركود، أكواد التصميم
- بيانات قاعدة البيانات القادمة من API

---

## 4. خريطة المسارات (Routes)

| المسار | الصفحة | المرحلة |
|--------|--------|---------|
| `/login` | Login | ✅ 2 |
| `/` | Dashboard | ✅ 3 |
| `/inventory` | Inventory | 4 |
| `/inventory/create`, `/inventory/edit/:id` | CreateItem | 4 |
| `/inventory/rolls/:id`, `.../edit`, `.../move` | RollDetails | 4 |
| `/inventory/rolls/new` | CreateRoll | 4 |
| `/inventory/categories` | Categories | 5 |
| `/inventory/fabric-master-data` | FabricMasterData | 5 |
| `/inventory/warehouses` | Warehouses | 6 |
| `/inventory/transfers` | Transfers | 6 |
| `/inventory/depreciation` | Depreciation | 6 |
| `/inventory/settings` | InventorySettings | 6 |
| `/inventory/bulk-pricing` | BulkPricing | 6 |
| `/inventory/labels` | StickerPrinting | 7 |
| `/inventory/custom-label` | CustomStickerPrinting | 7 |
| `/inventory/print-jobs` | PrintJobs | 7 |
| `/purchases/import-excel` | ImportExcel | 9 |
| `/purchases/import-batches` | ImportBatches | 9 |
| `/invoices/sales` | Sales | 8 |
| `/invoices/sales/new`, `.../edit` | InvoiceForm (بيع) | 8 |
| `/invoices/purchases` | Purchases | 9 |
| `/invoices/purchases/new`, `.../edit` | InvoiceForm (شراء) | 9 |
| `/invoices/exchange` | ExchangeInvoices | 10 |
| `/invoices/returns` | ReturnInvoices | 10 |
| `/invoices/statement`, `.../:id` | InvoiceStatement | 10 |
| `/customers` | Customers | 11 |
| `/customers/log` | CustomersLog | 11 |
| `/customers/statement` | CustomerStatement | 11 |
| `/suppliers` | Suppliers | 12 |
| `/suppliers/log` | SuppliersLog | 12 |
| `/suppliers/statement` | SupplierStatement | 12 |
| `/treasury/safes` | Safes | 13 |
| `/treasury/log` | TreasuryLog | 13 |
| `/treasury/profit-details` | ProfitDetails | 13 |
| `/treasury/settings` | TreasurySettings | 13 |
| `/bonds/payment` | PaymentBonds | 14 |
| `/bonds/collection` | CollectionBonds | 14 |
| `/bonds/records` | BondRecords | 14 |
| `/bonds/records/:id` | BondDetails | 14 |
| `/orders` | CustomerOrdersPage | 15 |
| `/expenses` | Expenses | 16 |
| `/salaries` | Salaries | 16 |
| `/reports` | ReportsCenter | 17 |
| `/chart-of-accounts` | Accounting | 18 |
| `/journal` | Journal | 18 |
| `/manufacturing` | Manufacturing | 18 |
| `/partners` | Partners | 18 |
| `/settings` | SystemSettings | 19 |
| `/settings/desktop` | DesktopSettings | 19 |

---

## 5. المراحل التنفيذية — تفصيل كامل

> **قاعدة:** لا تنتقل للمرحلة التالية إلا بعد اختبار عربي + تركي وموافقة صاحب المشروع.

---

### المرحلة 4 — المخزون: الأساس (أولوية عالية)

**namespace:** `inventory`

| الملف | ~أسطر | أولوية | محتوى يُترجم |
|-------|-------|--------|--------------|
| `src/pages/Inventory.tsx` | 1455 | عالية | عناوين، فلاتر، `STATUS_LABELS`, `SCOPE_LABELS`, جدول الأعمدة، إحصائيات، أزرار، رسائل فارغة |
| `src/pages/inventory/CreateItem.tsx` | 1152 | عالية | نموذج إنشاء/تعديل مادة، تبويبات، حقول، تحقق |
| `src/pages/inventory/CreateRoll.tsx` | 609 | عالية | إنشاء توب، باركود، مستودع |
| `src/pages/inventory/RollDetails.tsx` | 537 | عالية | تفاصيل التوب، تحرير، نقل |

**ثوابت مدمجة تُستبدل:**

```typescript
// Inventory.tsx
STATUS_LABELS, SCOPE_LABELS

// ملفات مساعدة إن وُجدت في نفس القسم
```

**مكونات مرتبطة:**

- `src/pages/inventory/StockExcelImportModal.tsx` (يمكن دمجها في مرحلة 4 أو 6)

**مفاتيح مقترحة (عينة):**

```json
{
  "rolls.title": "أتواب الأقمشة",
  "rolls.filters.status": "الحالة",
  "rolls.status.available": "متاح",
  "rolls.status.sold": "مباع",
  "rolls.status.reserved": "محجوز",
  "rolls.scope.all": "الكل",
  "rolls.scope.warehouse": "حسب المستودع",
  "createItem.title": "إنشاء مادة جديدة",
  "rollDetails.move": "نقل التوب"
}
```

**اختبار:**

- [ ] فتح `/inventory` عربي + تركي
- [ ] فلاتر الحالة والنطاق
- [ ] إنشاء مادة وتوب — التسميات فقط
- [ ] LTR لا يكسر الجدول

**تقدير الجهد:** متوسط–كبير (4 ملفات كبيرة)

---

### المرحلة 5 — المخزون: التصنيفات وبيانات الخامات

**namespace:** `inventory` (توسيع) أو `categories`

| الملف | ~أسطر | محتوى |
|-------|-------|--------|
| `src/pages/inventory/Categories.tsx` | ~420 | `COLUMN_LABELS`, بحث، مزامنة، نافذة إضافة/تعديل 4 مستويات |
| `src/pages/inventory/FabricMasterData.tsx` | 828 | تعريفات الأقمشة (مسار مخفي) |

**ثوابت:**

```typescript
COLUMN_LABELS = ['اسم خامة', 'كود الخامة', 'اللون', 'كود اللون']
```

**تركية مقترحة للمستويات:**

| عربي | Türkçe |
|------|--------|
| اسم خامة | Malzeme Adı |
| كود الخامة | Malzeme Kodu |
| اللون | Renk |
| كود اللون | Renk Kodu |

**اختبار:** شجرة 4 أعمدة + مزامنة من المواد

---

### المرحلة 6 — المخزون: العمليات

**namespace:** `inventory`

| الملف | محتوى |
|-------|--------|
| `Warehouses.tsx` | المستودعات CRUD |
| `Transfers.tsx` | المناقلة بين المستودعات |
| `Depreciation.tsx` | إهلاك مادي |
| `InventorySettings.tsx` | عتبة المخزون المنخفض، الوحدة الافتراضية |
| `BulkPricing.tsx` | التسعير الجماعي حسب اسم الخامة |
| `StockExcelImportModal.tsx` | استيراد مخزون Excel |

---

### المرحلة 7 — المخزون: الطباعة والاستيكرات

**namespace:** `labels`

| الملف | محتوى |
|-------|--------|
| `StickerPrinting.tsx` | 1239 سطر — طباعة استيكرات، معاينة، طابعة |
| `CustomStickerPrinting.tsx` | ستيكر خاص |
| `PrintJobs.tsx` | سجل الطباعة |
| `src/components/labels/LabelCard.tsx` | قالب الاستيكر |

**ملاحظة:** تخطيط الاستيكر 100×80 قد يبقى بالاتجاه الفيزيائي للطابعة — نُترجم النصوص على الشاشة فقط ما لم يُطلب خلاف ذلك.

---

### المرحلة 8 — فواتير البيع

**namespace:** `invoices` (قسم `sales`)

| الملف | ~أسطر | محتوى |
|-------|-------|--------|
| `Sales.tsx` | 641 | قائمة فواتير البيع، فلاتر، حالات |
| `InvoiceForm.tsx` | 2814 | **الأضخم** — نموذج موحّد للبيع والشراء؛ يُقسّم داخل الملف حسب `invoiceType` |

**أقسام InvoiceForm للترجمة:**

1. رأس الفاتورة (عميل، تاريخ، عملة، مستودع)
2. جدول البنود (خامة، لون، كمية، سعر)
3. الخصم والمجاميع
4. الدفع والصندوق
5. أزرار الحفظ / التأكيد / الطباعة
6. `InvoiceSaveActionsModal.tsx`

**دوال عرض الحالة (تُربط بـ i18n):**

- `src/lib/i18n/arTerminology.ts` → إنشاء `trTerminology.ts` أو توحيد في `locales/*/status.json`

---

### المرحلة 9 — فواتير الشراء + الاستيراد

**namespace:** `invoices` + `purchaseImport`

| الملف | محتوى |
|-------|--------|
| `Purchases.tsx` | قائمة شراء |
| `InvoiceForm.tsx` | فرع الشراء |
| `ImportExcel.tsx` | 912 سطر — استيراد Excel من المصنع |
| `ImportBatches.tsx` | دفعات الاستيراد |

**مصطلحات حرجة للتركية:**

| عربي | Türkçe |
|------|--------|
| فاتورة شراء | Alış Faturası |
| استيراد Excel | Excel İçe Aktarma |
| تأكيد الباركود | Barkod Onayı |
| دفعة استيراد | İçe Aktarma Partisi |

---

### المرحلة 10 — فواتير أخرى + كشف الفاتورة

**namespace:** `invoices`

| الملف | محتوى |
|-------|--------|
| `ExchangeInvoices.tsx` | فواتير الصرف |
| `ReturnInvoices.tsx` | 1158 سطر — مرتجعات |
| `InvoiceStatement.tsx` | 911 سطر — كشف/إشعار تسليم |

**ملفات طباعة مرتبطة (مرحلة 20 أو جزء من 10 بموافقة):**

- `src/lib/printing/renderInvoiceStatementA4.ts`
- `src/lib/i18n/arTerminology.ts` → `AR_INVOICE_STATEMENT` (~40 مفتاح)

---

### المرحلة 11 — العملاء

**namespace:** `customers`

| الملف | محتوى |
|-------|--------|
| `Customers.tsx` | 787 سطر — قائمة، إضافة، تعديل |
| `CustomersLog.tsx` | سجل النشاط |
| `CustomerStatement.tsx` | 1348 سطر — كشف حساب، PDF، طباعة، تيليغرام |
| `CustomerStatementImportModal.tsx` | استيراد كشف Excel |
| `BatchStatementExportModal.tsx` | تصدير دفعة كشوف |
| `StatementPrintActionsModal.tsx` | إجراءات الطباعة |

**ثوابت:**

```typescript
PRESET_LABELS في CustomerStatement.tsx
```

**تحذير:** كشف الحساب PDF — هوية بصرية للشركة؛ الترجمة التركية للكشف تحتاج **موافقة منفصلة** (مرحلة 20).

---

### المرحلة 12 — الموردون

**namespace:** `suppliers`

| الملف | محتوى |
|-------|--------|
| `Suppliers.tsx` | قائمة الموردين |
| `SuppliersLog.tsx` | السجل |
| `SupplierStatement.tsx` | 1073 سطر — كشف حساب مورد |

**إعادة استخدام:** مفاتيح مشتركة مع `customers` للكشوف (`statement.*` في `common` أو `statements` namespace).

---

### المرحلة 13 — الخزينة

**namespace:** `treasury`

| الملف | ~أسطر |
|-------|-------|
| `Safes.tsx` | الصناديق |
| `TreasuryLog.tsx` | سجل الحركة |
| `ProfitDetails.tsx` | 803 — كشف الأرباح التفصيلي |
| `TreasurySettings.tsx` | إعدادات |
| `Treasury.tsx` | تحويل/توجيه |

---

### المرحلة 14 — السندات

**namespace:** `bonds`

| الملف | محتوى |
|-------|--------|
| `PaymentBonds.tsx` | سندات صرف |
| `CollectionBonds.tsx` | سندات قبض |
| `BondRecords.tsx` | السجل |
| `BondDetails.tsx` | التفاصيل |
| `VoucherPrintModal.tsx` | طباعة السند |

---

### المرحلة 15 — الطلبيات

**namespace:** `orders`

| الملف | محتوى |
|-------|--------|
| `CustomerOrdersPage.tsx` | 580 سطر |
| `OrderFormModal.tsx` | نموذج طلب |
| `OrderDetailModal.tsx` | تفاصيل |
| `orderStatusUi.ts` | `ORDER_STATUS_LABELS` |

**حالات الطلب (عينة تركية):**

| عربي | Türkçe |
|------|--------|
| قيد التوريد | Tedarik Bekliyor |
| جاهز للاستلام | Teslime Hazır |
| مُسلّم | Teslim Edildi |

**DashboardLayout:** تنبيهات الاستلام في `common.notifications.*` — توسيع عند الحاجة.

---

### المرحلة 16 — المصاريف والرواتب

**namespace:** `expenses`, `salaries`

| الملف | ~أسطر |
|-------|-------|
| `Expenses.tsx` | المصاريف |
| `Salaries.tsx` | 598 — رواتب، Excel، صناديق موظفين |

---

### المرحلة 17 — التقارير

**namespace:** `reports`

| الملف | محتوى |
|-------|--------|
| `ReportsCenter.tsx` | 819 سطر — مركز التقارير |
| `ReportViewer.tsx` | عارض |
| `ReportToolbar.tsx` | شريط أدوات |
| `ComingSoonReport.tsx` | قريباً |
| `src/lib/reports/printReport.ts` | طباعة تقرير |
| `src/lib/reports/exportReportToExcel.ts` | تصدير |

**تعقيد:** أسماء التقارير كثيرة — ملف `reports.json` كبير متوقع (~150–250 مفتاح).

---

### المرحلة 18 — المحاسبة والتصنيع والشركاء

**namespace:** `accounting`, `manufacturing`, `partners`

| الملف | محتوى |
|-------|--------|
| `Accounting.tsx` | شجرة الحسابات |
| `Journal.tsx` | دفتر اليومية |
| `Manufacturing.tsx` | التصنيع (قد يكون placeholder) |
| `Partners.tsx` | الشركاء |

**مصطلحات محاسبية:**

| عربي | Türkçe |
|------|--------|
| مدين | Borç |
| دائن | Alacak |
| قيد يومية | Yevmiye Kaydı |

→ ربط بـ `arTerminology.ts` الدوال المحاسبية.

---

### المرحلة 19 — الإعدادات والتفعيل

**namespace:** `settings`, `activation`

| الملف | محتوى |
|-------|--------|
| `SystemSettings.tsx` | 931 سطر — إعدادات شاملة |
| `DesktopSettings.tsx` | Electron |
| `ActivationKeyInput.tsx` | مفتاح التفعيل |
| `ActivationSettingsPanel.tsx` | لوحة التفعيل |
| `TelegramBotSettingsPanel.tsx` | تيليغرام |
| `ThemeDisplaySettings.tsx` | مظهر وخط |
| `BackendConnectionBadge.tsx` | حالة الاتصال |
| `StartupConnectionBanner.tsx` | Electron banner |
| `NonBlockingToast.tsx` | رسائل toast عامة → `common` |

---

### المرحلة 20 — PDF والطباعة والخلفية (بموافقة منفصلة)

> **لا تُنفَّذ تلقائياً** — قرار صاحب المشروع: تركي كامل، عربي فقط في المطبوعات، أو حسب نوع المستند.

| الملف | النوع |
|-------|-------|
| `src/lib/pdfExport.ts` | كشوف حساب، PDF عام |
| `src/lib/printing/renderInvoiceStatementA4.ts` | كشف فاتورة A4 |
| `src/lib/i18n/arTerminology.ts` | مصطلحات العرض |
| `src/lib/orderExport.ts` | تصدير طلبيات |
| `src/lib/telegramInvoice.ts` | رسائل تيليغرام |

**خيارات التنفيذ:**

1. **A:** واجهة تركية + مطبوعات عربية (الوضع الحالي الآمن)
2. **B:** مطبوعات تتبع لغة الواجهة
3. **C:** زر اختيار لغة الطباعة منفصل

**Backend (اختياري — مرحلة لاحقة):**

- `server/src/utils/arabicErrors.ts` — رسائل API بالعربية
- يتطلب `Accept-Language` header أو معامل `lang` — **خارج نطاق الواجهة الحالي**

---

## 6. المكونات المشتركة (تُترجم مبكراً أو مع أول قسم يستخدمها)

| المكون | namespace | يُستخدم في |
|--------|-----------|------------|
| `SmartPartySearch.tsx` | `common` | فواتير، سندات، كشوف |
| `A4PreviewModal.tsx` | `common` | طباعة/PDF |
| `InvoiceSaveActionsModal.tsx` | `invoices` | InvoiceForm |
| `RequireAuth` / `RequireActivation` | `common` | حماية المسارات |

---

## 7. معجم المصطلحات الموحّد (Terminology Glossary)

يُحفظ في `docs/CLOTEX_TURKISH_TERMINOLOGY_GLOSSARY.md` (يُنشأ عند بدء المرحلة 4) أو قسم في هذا الملف.

**قواعد المعجم:**

1. مصطلح واحد = ترجمة واحدة في كل النظام
2. لا خلط بين «خامة» و«قماش» في التركية — اختيار: **Kumaş** للأقمشة، **Malzeme** للمادة في المخزون
3. «توب» = **Top** (لفة قماش)
4. «سند قبض» = **Tahsilat Fişi** · «سند صرف» = **Ödeme Fişi**
5. حالات الدفع: Ödendi / Ödenmedi / Kısmi Ödendi

---

## 8. قائمة التحقق لكل مرحلة (Checklist)

```markdown
## مرحلة X — [اسم القسم]

### قبل البدء
- [ ] قراءة الملفات المدرجة
- [ ] إنشاء ar/{ns}.json و tr/{ns}.json
- [ ] تسجيل namespace في config.ts

### أثناء التنفيذ
- [ ] استبدال كل النصوص الظاهرة للمستخدم
- [ ] ثوابت LABELS → مفاتيح t()
- [ ] toLocaleString بالـ locale الصحيح
- [ ] text-start/end بدل left/right حيث لزم

### بعد التنفيذ
- [ ] npm run lint
- [ ] npm run build
- [ ] اختبار عربي: لا تغيير عن السابق
- [ ] اختبار تركي: LTR + نصوص صحيحة
- [ ] موبايل: أزرار قابلة للضغط
- [ ] git commit + push
- [ ] VPS: pull + npm install + build + nginx

### موافقة
- [ ] صاحب المشروع وافق على المرحلة
```

---

## 9. أوامر النشر على VPS (مرجع ثابت)

```bash
cd ~/ab-amal-erp
git pull origin main
npm install
NODE_OPTIONS="--max-old-space-size=1024" npm run build
FRONTEND_ROOT=$(sudo grep -E '^\s*root ' /etc/nginx/sites-available/clotexerp-org | head -1 | awk '{print $2}' | tr -d ';')
sudo rm -rf "${FRONTEND_ROOT}"/*
sudo cp -r dist/* "${FRONTEND_ROOT}"/
pm2 restart clotexerp-server --update-env
sudo nginx -t && sudo systemctl reload nginx
```

> **ملاحظة:** ترجمة الواجهة لا تحتاج `migrate.ts` إلا إذا رُفعت migrations أخرى في نفس الـ pull.

**بعد النشر:** `Ctrl + Shift + R` في المتصفح.

---

## 10. التراجع (Rollback)

| المستوى | الإجراء |
|---------|---------|
| مرحلة واحدة | `git revert <commit-hash>` |
| إيقاف مؤقت | إخفاء زر اللغة + إجبار `ar` في `readStoredLanguage()` |
| كامل | حذف مجلد `src/locales/tr` + إزالة i18n (غير مستحسن بعد المرحلة 3) |

**لا يمس:** قاعدة البيانات، التصميم CSS، منطق الأعمال.

---

## 11. ترتيب الأولوية المقترح (بعد موافقة المدير)

```
✅ 1–3  (منجز)
→ 4     المخزون أساس
→ 8     فواتير البيع
→ 9     فواتير الشراء
→ 11    كشف عملاء
→ 13    خزينة
→ 5–7   باقي المخزون
→ 10–12 فواتير أخرى + موردون
→ 14–19 باقي الأقسام
→ 20    PDF (قرار منفصل)
```

يمكن تعديل الترتيب حسب ملاحظات المدير من تركيا.

---

## 12. تقدير الحجم الإجمالي

| البند | العدد التقريبي |
|-------|----------------|
| صفحات React | ~51 |
| مكونات مشتركة | ~24 |
| ملفات namespace JSON | ~18–22 |
| مفاتيح ترجمة متوقعة | 1,500 – 2,500 |
| مراحل تنفيذ | 20 |
| ملفات PDF/طباعة | 5+ (مرحلة منفصلة) |

---

## 13. كيفية طلب التنفيذ

عند الموافقة، يُقال مثلاً:

> «نفّذي المرحلة 4 — المخزون الأساس»

أو:

> «نفّذي المرحلة 8 — فواتير البيع فقط»

سيتم تنفيذ **القسم المحدد فقط** وفق هذا الملف دون تجاوز النطاق.

---

## 14. سجل التغييرات

| التاريخ | الحدث |
|---------|-------|
| 2026-06-12 | إنشاء الخطة — مراحل 1–3 منجزة |
| — | المرحلة 4+ في انتظار موافقة المدير |

---

*نهاية الوثيقة — CLOTEX Turkish i18n Master Plan*
