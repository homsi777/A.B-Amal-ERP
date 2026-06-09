# تقرير تدقيق عميق لمسار استيراد Excel للمشتريات والمخزون

التاريخ: 2026-05-11  
النطاق: قراءة وتحليل فقط. لم يتم تعديل كود التطبيق أو الهجرات أو قاعدة البيانات.  
الهدف: توثيق كيف يعمل استيراد Excel الحالي، أين يبدأ، ماذا يكتب في قاعدة البيانات، وما الفجوات التي قد تسبب عدم ظهور مواد أو عدم اكتمال ربطها بالفاتورة/المورد/المستودع.

## 1. الملخص التنفيذي

يوجد في المشروع مساران مختلفان للاستيراد، وهذا هو أهم استنتاج:

| المسار | الشاشة | API | الغرض الحقيقي | ينشئ فاتورة شراء؟ | ينشئ دفعة استيراد؟ |
|---|---|---|---|---|---|
| استيراد فاتورة شراء Excel | `src/pages/purchases/ImportExcel.tsx` | `/api/purchases/import/*` | استيراد ملف شراء عبر Preview ثم Confirm | نعم، عند التأكيد | نعم: `purchase_import_batches` و `purchase_import_rows` |
| استيراد مخزون Excel مباشر | `src/pages/inventory/StockExcelImportModal.tsx` | `/api/inventory/stock-import` | إنشاء خامات/ألوان/رولات بسرعة من ملف مخزون | لا حاليًا؛ الكود موجود لكنه معطل بالتعليق | لا |

النتيجة العملية: إذا كان المستخدم يستورد من شاشة `المخزون > استيراد من ملف Excel`، فالمسار لا يستخدم نظام دفعات الشراء ولا رأس فاتورة الشراء، ولا ينشئ `purchase_invoices` حاليًا. لذلك من الطبيعي أن تظهر مواد في المخزون بدون ربط فاتورة شراء حقيقي، أو بدون رقم فاتورة/تاريخ/عملة/سعر صرف كامل.

مسار `purchases/import-excel` أقرب لتوقعات العمل المحاسبي: يطلب المورد والمستودع وتاريخ الفاتورة ورقمها والعملة وسعر الصرف، يحفظ دفعة وصفوف، ثم عند التأكيد ينشئ رولات وحركات مخزون وفاتورة شراء مؤكدة ويربط الصفوف بالرولات وخطوط الفاتورة.

لكن هذا المسار أيضًا يحتوي مخاطر مهمة:

- قراءة Excel في `purchaseImportApi.ts` تعتبر أول صف في الشيت هو صف الأعمدة دائمًا، ولا تبحث عن صف الأعمدة داخل أول 8 أسطر. لذلك لا يناسب ملفات Packing List التي تحتوي عنوانًا ونصوصًا قبل الجدول.
- لا يوجد استخراج ذكي لرأس Packing List مثل `THE DETAIL PACKING LIST OF Amelia-19 66/67` أو `TOTAL SHIPPED SITUATION: 37940 M 475 ROLLS`.
- التحقق في Preview يجري استعلامات قاعدة بيانات لكل صف تقريبًا، ثم يحفظ الصفوف واحدًا واحدًا. لذلك ملف كبير 500+ صف قد يكون بطيئًا، بعكس مسار المخزون المباشر الذي يستخدم Bulk Insert.
- رقم الفاتورة الذي يدخله المستخدم في مسار الاستيراد يحفظ في `purchase_import_batches.invoice_no` ويستعمل في `fabric_rolls.purchase_invoice_no`، لكن خدمة `createPurchaseInvoice` تولد رقم فاتورة شراء تسلسليًا ولا تستخدم رقم المستخدم كرقم فعلي للفاتورة. هذا قد يسبب اختلافًا بين رقم الفاتورة النصي على الرول ورقم `purchase_invoices.invoice_no`.

## 2. ملفات تم فحصها

### Frontend

- `src/App.tsx`
- `src/pages/purchases/ImportExcel.tsx`
- `src/pages/purchases/ImportBatches.tsx`
- `src/pages/Purchases.tsx`
- `src/pages/Inventory.tsx`
- `src/pages/inventory/StockExcelImportModal.tsx`
- `src/lib/api/purchaseImportApi.ts`
- `src/lib/api/stockImportApi.ts`
- `src/lib/stockExcelImport.ts`
- `src/lib/purchaseInvoiceExcelImport.ts`
- `src/lib/excelInventoryImport.ts`
- `src/lib/api/fabricRollsApi.ts`

### Backend

- `server/src/app.ts`
- `server/src/routes/purchaseImportRoutes.ts`
- `server/src/routes/stockImportRoutes.ts`
- `server/src/routes/purchaseInvoiceRoutes.ts`
- `server/src/services/purchaseInvoiceService.ts`
- `server/src/routes/fabricRollRoutes.ts`
- `server/src/utils/importColumnDetector.ts`
- `server/src/services/exchangeRateService.ts`

### Migrations

- `server/src/db/migrations/004_fabric_rolls_inventory_engine.sql`
- `server/src/db/migrations/005_purchase_excel_import_batches.sql`
- `server/src/db/migrations/016_sales_purchase_invoices.sql`
- `server/src/db/migrations/018_exchange_rates_multi_currency_usd_base.sql`
- `server/src/db/migrations/019_smart_purchase_import_invoice_header.sql`
- `server/src/db/migrations/020_purchase_import_row_verification.sql`

### Docs

- `docs/SMART_PURCHASE_EXCEL_IMPORT_JOURNEY_REPORT.md`
- `docs/FABRIC_PHASE_4_EXCEL_IMPORT_TO_FABRIC_ROLLS_REPORT.md`

## 3. نقاط دخول الاستيراد الحالية

### 3.1 شاشة استيراد فاتورة شراء Excel

المسار:

- Route: `/purchases/import-excel`
- Component: `src/pages/purchases/ImportExcel.tsx`
- API client: `src/lib/api/purchaseImportApi.ts`
- Backend route: `server/src/routes/purchaseImportRoutes.ts`
- Prefix registered in `server/src/app.ts`: `/api/purchases/import`

هذا هو المسار المحاسبي الصحيح نسبيًا لاستيراد فاتورة شراء.

### 3.2 سجل دفعات الاستيراد

المسار:

- Route: `/purchases/import-batches`
- Component: `src/pages/purchases/ImportBatches.tsx`
- API: `listImportBatches`, `cancelImportBatch`

يعرض الدفعات، روابط الفاتورة المولدة إن وجدت، وروابط المخزون واللصاقات. لا يبدو أنه يستعيد Batch موجودة إلى شاشة المراجعة بنفس الحالة؛ زر المتابعة يعود إلى صفحة الاستيراد فقط.

### 3.3 شاشة المشتريات القديمة/العامة

الملف:

- `src/pages/Purchases.tsx`
- يحتوي نص: `تأكيد استلام فاتورة الشراء من Excel`
- يستخدم `src/lib/purchaseInvoiceExcelImport.ts`

هذا يبدو مسارًا أو مكونًا قديمًا/موازيًا لتأكيد فاتورة شراء من Excel داخل صفحة المشتريات. يجب اعتباره نقطة دخول محتملة حتى لو لم تكن المسار المستخدم حاليًا في عملية الاستيراد الذكي.

### 3.4 استيراد مخزون مباشر من شاشة المخزون

المسار:

- Component: `src/pages/inventory/StockExcelImportModal.tsx`
- Parser: `src/lib/stockExcelImport.ts`
- API client: `src/lib/api/stockImportApi.ts`
- Backend: `server/src/routes/stockImportRoutes.ts`
- Prefix: `/api/inventory/stock-import`

هذا المسار سريع ومصمم لملف مخزون/حلب، لكنه ليس مسار فاتورة شراء محاسبية كاملة. هو يطلب مستودعًا وموردًا فقط، ولا يطلب رقم فاتورة/تاريخ/عملة/سعر صرف. كما أن إنشاء فاتورة الشراء داخله موجود ككود معلق وغير فعال.

## 4. تدفق Frontend لمسار Purchase Excel Import

### A) فتح صفحة الاستيراد

الصفحة:

- `src/pages/purchases/ImportExcel.tsx`

عند التحميل:

- يجلب الموردين عبر `listSuppliers({ pageSize: 500 })`.
- يجلب المستودعات عبر `listWarehouses()`.
- يختار مستودعًا افتراضيًا إن وجد.
- يضبط تاريخ الفاتورة افتراضيًا على تاريخ اليوم.

حالات مهمة:

| State | الدور |
|---|---|
| `supplierId` | المورد المطلوب |
| `warehouseId` | المستودع المطلوب |
| `locationId` | الموقع الافتراضي داخل المستودع |
| `currencyCode` | العملة |
| `invoiceDate` | تاريخ فاتورة الشراء |
| `purchaseInvoiceNo` | رقم فاتورة الشراء الاختياري |
| `notes` | ملاحظات |
| `exchangeRateToUsd` | سعر الصرف مقابل الدولار |
| `importMode` | مطابقة فقط أو إنشاء تعريفات ناقصة |
| `selectedFile` | ملف Excel |
| `preview` | نتيجة المعاينة |
| `rows` | صفوف الاستيراد المحفوظة من backend |
| `allowWarnings` | قبول الصفوف ذات التحذيرات |
| `verificationMode` | لا يوجد/مسح باركود |

### B) اختيار المورد/المستودع/تفاصيل الفاتورة

الشاشة تطلب:

| الحقل | مطلوب؟ | يرسل في Preview؟ | يرسل في Confirm؟ |
|---|---:|---:|---:|
| المورد | نعم | نعم، `supplierId` | لا من الواجهة؛ backend يقرأه من batch |
| المستودع | نعم | نعم، `warehouseId` | لا من الواجهة؛ backend يقرأه من batch |
| الموقع | اختياري | نعم، `defaultLocationId` | لا من الواجهة؛ backend يقرأه من batch |
| تاريخ الفاتورة | نعم | نعم، `invoiceDate` | لا من الواجهة؛ backend يقرأه من batch |
| رقم الفاتورة | اختياري | نعم، `purchaseInvoiceNo` | لا من الواجهة؛ backend يقرأه من batch |
| العملة | اختياري/افتراضي USD | نعم، `currencyCode` | لا من الواجهة؛ backend يقرأها من batch |
| سعر الصرف | اختياري حسب العملة | نعم، `exchangeRateToUsd` | لا من الواجهة؛ backend يقرأه من batch |
| ملاحظات | اختياري | نعم، `notes` | لا من الواجهة؛ backend يقرأها من batch |

الخلاصة: حقول الرأس ترسل في Preview، ثم تحفظ في `purchase_import_batches`، ثم Confirm يعتمد على batch لا على Payload جديد.

### C) اختيار ملف Excel

الدالة:

- `handleFileChange`

تحفظ الملف في `selectedFile`.

### D) طلب Preview

الدالة:

- `handleUpload`
- API client: `previewPurchaseExcelImport(selectedFile, options)`
- Parser: `parseExcelFile(file)`

الـ payload إلى backend:

```json
{
  "fileName": "...xlsx",
  "fileSizeBytes": 12345,
  "sheetName": "وارد",
  "headers": ["..."],
  "rows": [["..."]],
  "supplierId": "...",
  "warehouseId": "...",
  "defaultLocationId": null,
  "currencyCode": "USD",
  "invoiceDate": "2026-05-11",
  "purchaseInvoiceNo": "optional",
  "notes": "optional",
  "exchangeRateToUsd": 1,
  "importMode": "MATCH_ONLY"
}
```

مشكلة مهمة في parser:

- `parseExcelFile` يقرأ أول صف في الشيت كـ headers دائمًا.
- لا يبحث عن صف الأعمدة الحقيقي إذا كان الملف يحتوي عنوانًا أو نصوصًا قبل الجدول.
- لذلك مسار Purchase Excel Import أقل ذكاء من مسار `stockExcelImport.ts` الذي لديه `findHeaderRow`.

### E) عرض نتيجة Preview

بعد نجاح Preview:

- `setPreview(result)`
- `loadRows(result.batchId, 1, '')`
- الانتقال إلى `step = 2`

يعرض:

- إجمالي الصفوف.
- الصالح.
- التحذيرات.
- الأخطاء.
- إجمالي الأمتار.
- إجمالي اليارد إن وجد.
- عدد الخامات والألوان.
- إجمالي القيمة.
- الأعمدة المكتشفة.
- جدول صفوف مع `errors` و `warnings`.

### F) Barcode confirmation / scan verification

يوجد داخل نفس صفحة `ImportExcel.tsx` وليس Modal مستقل واضح.

API:

- `POST /api/purchases/import/:id/scan-verify`

الغرض:

- توثيق أن باركود موجود في صف صالح أو صف تحذير ضمن الدفعة.
- يحدّث `purchase_import_rows.verified_at` و `verified_by_user_id`.

هل يتجاوز خطوة الرأس؟

- لا. لا يمكن الوصول لهذا التوثيق إلا بعد إنشاء Preview/Batch، وPreview أساسًا يحفظ حقول الرأس.

ملاحظة:

- يمكن للمستخدم اختيار "تأكيد على أي حال" بدل إلزام المسح، حسب منطق الواجهة.

### G) Confirm import

الدالة:

- `handleConfirm`
- API: `confirmImportBatch(preview.batchId, { allowWarnings })`
- Route: `POST /api/purchases/import/:id/confirm`

Payload:

```json
{
  "allowWarnings": true
}
```

لا ترسل الواجهة المورد/المستودع/الفاتورة عند Confirm؛ backend يقرأها من `purchase_import_batches`.

### H) Import success

يعرض Confirm Result:

- `createdRolls`
- `createdItems`
- `createdColors`
- `createdVariants`
- `createdPurchaseInvoiceId`
- `purchaseInvoiceNo`

### I) Navigation after import

بعد النجاح توجد روابط إلى:

- `/inventory`
- `/invoices/statement/${createdPurchaseInvoiceId}` إذا وجدت فاتورة.
- `/purchases/import-batches`
- `/inventory/labels?batchId=${preview.batchId}`

ملاحظة: الرابط `/invoices/statement/:id` يحتاج تحقق Runtime؛ الاسم يوحي بكشف/عرض، وليس مؤكدًا أنه صفحة فاتورة شراء مباشرة.

## 5. تدفق Frontend لمسار Inventory Stock Excel Import

### A) فتح الاستيراد

الصفحة:

- `src/pages/Inventory.tsx`
- زر: `استيراد من ملف Excel`
- Modal: `StockExcelImportModal`

### B) اختيار مستودع ومورد

الـ modal يجلب:

- `listWarehouses({ status: 'active' })`
- `listSuppliers({ status: 'active', pageSize: 500 })`

الحقول:

- مستودع.
- مورد.
- خيار `استيراد بدون تسعير` عبر `ignorePrices`.

لا توجد حقول:

- رقم فاتورة.
- تاريخ فاتورة.
- عملة.
- سعر صرف.
- ملاحظات رأس فاتورة.

### C) Parsing

المكتبة:

- `src/lib/stockExcelImport.ts`

هي أكثر ذكاء في اكتشاف صف الأعمدة:

- `findHeaderRow` يفحص أول 8 صفوف.
- `detectSheetKind` يميز بين `balance`, `incoming`, `outgoing`.
- `pickDefaultSheet` يفضل شيت الوارد، ثم الرصيد، ثم أول شيت فيه صفوف.

### D) Import

الدالة:

- `handleConfirmImport`

تقسم الاستيراد إلى chunks بحجم:

- `IMPORT_CHUNK_SIZE = 100`

ثم ترسل كل دفعة إلى:

- `POST /api/inventory/stock-import`

Payload:

```json
{
  "warehouseId": "...",
  "supplierId": "...",
  "sourceLabel": "file.xlsx · sheet",
  "rows": [
    {
      "itemName": "...",
      "itemCode": "...",
      "colorName": "...",
      "colorCode": "...",
      "unit": "...",
      "quantity": 10,
      "price": 0,
      "costPrice": 0,
      "widthCm": 0,
      "gsm": 0,
      "actualWeightKg": 0,
      "date": "",
      "purchaseInvoiceNo": ""
    }
  ]
}
```

ملاحظة خطيرة:

- عند التقسيم إلى chunks، `sourceLabel` يعاد تعيينه إلى `baseSourceLabel` فقط بعد أن كان يحتوي رقم الدفعة. لذلك batch tag قد لا يميز الدفعات كما كان متوقعًا.

### E) النتيجة

Backend يرجع:

- `createdRolls`
- `createdItems`
- `createdColors`
- `createdCategories`
- `warehouseId`
- `supplierId`
- `purchaseInvoiceNo: null`

بعد نجاح الاستيراد، `Inventory.tsx` ينقل المستخدم غالبًا إلى:

- `/inventory/bulk-pricing?imported=...&supplierId=...&batchTag=...`

## 6. Backend Flow لمسار Purchase Excel Import

### 6.1 Preview endpoint

| البند | القيمة |
|---|---|
| Method | `POST` |
| Route | `/api/purchases/import/preview` |
| File | `server/src/routes/purchaseImportRoutes.ts` |
| Auth | `authenticateRequest` |
| Transaction | نعم عند إدراج batch/rows |

Payload validation:

- `fileName`: مطلوب.
- `supplierId`: UUID مطلوب.
- `warehouseId`: UUID مطلوب.
- `invoiceDate`: مطلوب.
- `headers`: array.
- `rows`: array max 5000.
- `currencyCode`: اختياري.
- `exchangeRateToUsd`: اختياري.
- `importMode`: `MATCH_ONLY` أو `CREATE_MISSING_MASTER_DATA`.

ما يفعله:

1. يتحقق من المستودع.
2. يتحقق من المورد.
3. يتحقق من عدم تكرار رقم الفاتورة في `purchase_invoices` إذا تم إدخاله.
4. يطبّع تاريخ الفاتورة.
5. يتحقق من الموقع إن وجد.
6. يحسم العملة وسعر الصرف.
7. يكتشف الأعمدة عبر:
   - `detectColumnMap(headers)`
   - `inferColumnMapFromData(headers, rows, detected)`
8. يحدد وحدة الطول من رأس العمود: meter أو yard.
9. يمر على كل صف:
   - `normalizeRow`
   - fallback للباركود من أول خلية إذا كانت رقمًا من 6 إلى 20 خانة.
   - تحويل yard إلى meter إذا كان العمود Yard.
   - `validateAndMatchRow`
10. يحسب الإحصائيات.
11. يدرج `purchase_import_batches`.
12. يدرج كل صف في `purchase_import_rows`.

هل ينشئ batch؟

- نعم.

هل يخزن rows؟

- نعم.

هل ينشئ rolls؟

- لا، Preview لا ينشئ رولات.

هل ينشئ invoice؟

- لا، Preview لا ينشئ فاتورة.

هل يفحص duplicate barcode؟

- نعم داخل الملف وعبر `fabric_rolls` في DB.

مشكلة أداء:

- `validateAndMatchRow` يستدعي DB لكل صف، وقد يجري عدة queries للخام/اللون/المتغير/الباركود.
- إدراج `purchase_import_rows` يتم في loop صفًا صفًا.
- لذلك ملف 500+ صف قد يكون بطيئًا.

### 6.2 Confirm endpoint

| البند | القيمة |
|---|---|
| Method | `POST` |
| Route | `/api/purchases/import/:id/confirm` |
| File | `server/src/routes/purchaseImportRoutes.ts` |
| Auth | `authenticateRequest` |
| Transaction | نعم |

Payload:

```json
{
  "allowWarnings": false
}
```

ما يفعله:

1. يجلب batch.
2. يرفض إذا batch مؤكد أو ملغى.
3. يرفض إذا توجد أخطاء.
4. يرفض التحذيرات إلا إذا `allowWarnings=true`.
5. يجلب صفوف `VALID` و `WARNING`.
6. يتحقق من وجود المورد.
7. يقرأ رقم الفاتورة من batch أو يولد رقمًا داخليًا مؤقتًا.
8. يقرأ التاريخ والعملة وسعر الصرف.
9. يبدأ transaction.
10. لكل صف:
    - يطابق أو ينشئ `fabric_items`.
    - يطابق أو ينشئ `fabric_colors`.
    - يطابق أو ينشئ `fabric_item_variants`.
    - يولد barcode إذا مفقود.
    - ينشئ `fabric_rolls`.
    - ينشئ `inventory_movements` بنوع `OPENING`.
    - يحدث `purchase_import_rows.created_roll_id`.
    - يجهز `purchase_invoice_lines`.
11. بعد الصفوف:
    - ينشئ فاتورة شراء عبر `createPurchaseInvoice`.
    - يؤكدها عبر `confirmPurchaseInvoice(..., { skipStockMovement: true })`.
    - يربط `purchase_import_rows.created_purchase_invoice_line_id`.
12. يحدث batch إلى `CONFIRMED`.

هل ينشئ purchase invoice؟

- نعم عند وجود lines.

هل ينشئ purchase invoice lines؟

- نعم.

هل يتجنب ازدواج حركة المخزون؟

- نعم، لأنه ينشئ حركة `OPENING` أثناء الاستيراد، ثم يؤكد فاتورة الشراء مع `skipStockMovement: true`.

ملاحظة محاسبية:

- `confirmPurchaseInvoice` ينفذ GL posting إذا `total_amount > 0`.
- إذا كانت التكاليف صفرًا بسبب عدم وجود سعر، فإن `totalAmount` قد يكون صفرًا، وبالتالي لا يوجد أثر GL فعلي.

### 6.3 Scan Verify endpoint

| البند | القيمة |
|---|---|
| Method | `POST` |
| Route | `/api/purchases/import/:id/scan-verify` |
| Writes | `purchase_import_rows.verified_at`, `verified_by_user_id` |

لا ينشئ رولات أو فاتورة. هو توثيق استلام اختياري.

### 6.4 Cancel endpoint

المسار موجود في API client وواجهة `ImportExcel` و `ImportBatches`.

وظيفته المتوقعة من المسار:

- إلغاء batch قبل التأكيد.
- لا توجد دلالة على أنه يعكس رولات بعد التأكيد، وغالبًا لا يسمح بإلغاء Batch مؤكدة.

يحتاج اختبار Runtime للتأكد من تفاصيل الإلغاء في كل حالة.

## 7. Backend Flow لمسار Stock Import

### Endpoint

| البند | القيمة |
|---|---|
| Method | `POST` |
| Route | `/api/inventory/stock-import` |
| File | `server/src/routes/stockImportRoutes.ts` |
| Auth | `authenticateRequest` |
| Max rows | 20,000 |
| Transaction | نعم |

Payload:

- `warehouseId`: اختياري.
- `supplierId`: اختياري.
- `sourceLabel`: اختياري.
- `rows`: مطلوب.

ما يفعله:

1. يحسم المستودع أو ينشئ/يستخدم MAIN.
2. يتحقق من المورد إن تم إرساله.
3. يجلب كل الخامات والألوان والتصنيفات مرة واحدة.
4. يخطط الصفوف في الذاكرة.
5. ينشئ تصنيفات وخامات وألوان جديدة عند الحاجة.
6. يدرج `fabric_rolls` عبر Bulk Insert chunks.
7. يدرج `inventory_movements` عبر Bulk Insert chunks.
8. لا ينشئ `purchase_import_batches`.
9. لا ينشئ `purchase_import_rows`.
10. لا ينشئ `purchase_invoices` حاليًا.

دليل مهم:

- داخل `stockImportRoutes.ts` توجد كتلة إنشاء فاتورة شراء لكنها معلقة بالكامل داخل comment.
- `purchaseInvoiceNo` يرجع دائمًا `null`.
- `unitCost` يتم ضبطه صفرًا عمدًا لأن أسعار Excel تعتبر غير موثوقة كسعر شراء، حسب التعليق في الكود.

الخلاصة: هذا المسار سريع ومفيد لإدخال مخزون خام، لكنه غير مكتمل محاسبيًا.

## 8. خريطة الكتابة في قاعدة البيانات

| Table | متى تكتب | endpoint | أهم الحقول | الربط بالمورد | الربط بالمستودع | الربط بالفاتورة | الربط بالدفعة | خطر/ملاحظة |
|---|---|---|---|---|---|---|---|---|
| `purchase_import_batches` | Preview شراء | `/api/purchases/import/preview` | supplier_id, warehouse_id, invoice_no, invoice_date, currency_code, exchange_rate_to_usd, counts | نعم | نعم | `created_purchase_invoice_id` لاحقًا | هي الدفعة | لا يستخدمها Stock Import |
| `purchase_import_rows` | Preview شراء | `/api/purchases/import/preview` | raw_data, normalized_data, status, errors, warnings, matched ids | عبر batch | عبر batch | `created_purchase_invoice_line_id` لاحقًا | نعم | إدراج صف-صف بطيء للملفات الكبيرة |
| `purchase_import_rows` | Scan verify | `/api/purchases/import/:id/scan-verify` | verified_at, verified_by_user_id | عبر batch | عبر batch | لا | نعم | توثيق فقط |
| `fabric_items` | Confirm شراء أو Stock Import | confirm / stock-import | internal_code, supplier_code, name, category_id | أحيانًا | لا | لا | لا | في Purchase Import الإنشاء حسب importMode؛ في Stock Import ينشأ تلقائيًا |
| `fabric_colors` | Confirm شراء أو Stock Import | confirm / stock-import | name_ar/name_tr/color_code | لا | لا | لا | لا | اللون اختياري غالبًا |
| `fabric_item_variants` | Confirm شراء | `/confirm` | item_id, color_id, width_cm, gsm | لا | لا | لا | لا | في Stock Import لا يظهر إدراج variant واضح في المسار الحالي |
| `fabric_rolls` | Confirm شراء | `/api/purchases/import/:id/confirm` | barcode, item_id, color_id, supplier_id, warehouse_id, length_m, unit_cost, purchase_invoice_no | نعم | نعم | نصيًا عبر `purchase_invoice_no` | ليس هناك `import_batch_id` عمود مباشر | الربط الحقيقي بالدفعة فقط عبر `purchase_import_rows.created_roll_id` |
| `fabric_rolls` | Stock Import | `/api/inventory/stock-import` | barcode IMP-..., item_id, color_id, supplier_id, warehouse_id, length_m, batch_no | نعم إن اختير | نعم | غالبًا null | لا | لا ينشئ فاتورة ولا batch رسمي |
| `inventory_movements` | Confirm شراء | `/confirm` | movement_type OPENING, reference_type PURCHASE_IMPORT, reference_id batch id | غير مباشر | نعم | لا، المرجع batch | نعم | يستخدم OPENING وليس PURCHASE_RECEIPT |
| `inventory_movements` | Stock Import | `/stock-import` | movement_type OPENING, reference_type STOCK_IMPORT, reference_no batchTag | غير مباشر | نعم | لا | لا | سريع لكنه غير محاسبي |
| `purchase_invoices` | Confirm شراء | `/confirm` عبر service | invoice_no, invoice_date, supplier_id, warehouse_id, currency, totals | نعم | نعم | نفسها | batch.created_purchase_invoice_id | رقم الفاتورة يولد من الخدمة ولا يحترم رقم المستخدم غالبًا |
| `purchase_invoice_lines` | Confirm شراء | `/confirm` عبر service | fabric_roll_id, item_id, warehouse_id, quantity, unit_cost, line_total, metadata | عبر invoice | نعم | نعم | عبر metadata/import row id | يتم ربط row بالline لاحقًا |
| `journal_entries` / `journal_lines` | Confirm purchase invoice | `confirmPurchaseInvoice` | source_type PURCHASE_INVOICE | نعم | لا | نعم | لا | فقط إذا total_amount > 0 |
| `exchange_rates` | قراءة فقط | preview/confirm/services | exchange_rate_to_usd | لا | لا | لا | لا | مطلوب للعملات غير USD إذا لم يرسل السعر |

## 9. Excel Column Mapping الحالي

المصدر الأساسي:

- `server/src/utils/importColumnDetector.ts`

### حقول Purchase Import

| Logical field | Supported English/Turkish names | Arabic names | مطلوب؟ | السلوك عند الفقد | مكان التحليل |
|---|---|---|---|---|---|
| material name | `material`, `fabric`, `materialName`, `itemName`, `fabricName`, `productName`, `description`, `stokadi`, `urun` | موجودة لكن ظهرت Mojibake في shell؛ يجب مراجعتها بترميز صحيح قبل تعديلها | نعم إذا لا يوجد كود | Error إذا لا اسم ولا كود | `detectColumnMap`, `validateAndMatchRow` |
| supplier material code | `stokkodu`, `design`, `designCode`, `fabricCode`, `code`, `materialCode`, `itemCode`, `supplierCode` | موجود | بديل للاسم | يستخدم للمطابقة | `validateAndMatchRow` |
| internal material code | `internalCode`, `internalMaterialCode`, `erpCode`, `ref` | موجود | اختياري | يستخدم للمطابقة | `validateAndMatchRow` |
| color name | `colorName`, `color`, `colour`, `renk`, `zeminrenk` | موجود | اختياري | Warning واستيراد بدون لون إذا مفقود | `validateAndMatchRow` |
| color code | `colorCode`, `colourCode`, `renkKodu` | موجود | اختياري | يستخدم للمطابقة | `validateAndMatchRow` |
| supplier color code | `supplierColorCode`, `tedarikciRenkKodu` | موجود | اختياري | يستخدم للمطابقة | `validateAndMatchRow` |
| roll number | `topNo`, `partiNo`, `rollNo`, `rollNumber`, `lot`, `lotNumber` | موجود | اختياري | Warning فقط | `validateAndMatchRow` |
| barcode | `barkod`, `barcode`, `ean`, `ean13`, `qr` | موجود | اختياري | يولد تلقائيًا عند confirm | `validateAndMatchRow`, confirm |
| length/meters | `metre`, `metraj`, `length`, `lengthM`, `meters`, `qty`, `miktar` | موجود | اختياري | Warning ويسجل صفرًا | `validateAndMatchRow` |
| yards | يكتشف من اسم header إذا يحتوي `yard/yd` | موجود جزئيًا | اختياري | يحول إلى متر إذا header يدل على yard | `detectLengthUnit` |
| unit | غير بارز في `purchase_import` كحقل مستقل أساسي | غير مؤكد | اختياري | خطوط الفاتورة تعتمد meter غالبًا | confirm |
| weight KG | `kg`, `kilogram`, `netKg`, `actualWeight`, `actualWeightKg` | موجود | اختياري | Warning/حساب وزن إذا width+gsm+length | `validateAndMatchRow` |
| width | `width`, `widthCm`, `en` | موجود | اختياري | إذا موجود وغير صالح Error | `validateAndMatchRow` |
| GSM | `gsm`, `gramaj`, `grammage` | موجود | اختياري | إذا موجود وغير صالح Error | `validateAndMatchRow` |
| cost/unit cost | `price`, `unitCost`, `unitPrice`, `fiyat`, `birimFiyat` | موجود | اختياري | غالبًا صفر إذا مفقود | preview/confirm |
| sale price | غير واضح كحقل مستقل في Purchase Import | غير مؤكد | غير مستخدم | لا يعتمد عليه | غير مكتمل |
| notes | `notes`, `note`, `notlar`, `aciklama` | موجود | اختياري | null | normalize |
| invoice number row-level | `invoiceNo`, `purchaseInvoiceNo`, `faturaNo` | موجود | اختياري | batch invoice له أولوية | confirm |
| batch/container | `batchNo`, `containerNo` | موجود | اختياري | null/Warning | confirm |

### دعم Header Parsing للـ Packing List

| السؤال | الحالة الحالية |
|---|---|
| هل يقرأ parser نصوص الرأس فوق الجدول؟ | لا في `purchaseImportApi.ts`. نعم جزئيًا في `stockExcelImport.ts` فقط لاكتشاف صف الأعمدة وليس لاستخراج Metadata |
| هل يستخرج `THE DETAIL PACKING LIST OF Amelia-19 66/67`؟ | لا |
| هل يستخرج اسم الخام من هذا السطر؟ | لا |
| هل يستخرج عرض 66/67 inch؟ | لا |
| هل يحول inch إلى cm؟ | لا في هذا السياق |
| هل يقرأ `TOTAL SHIPPED SITUATION: 37940 M 475 ROLLS`؟ | لا |
| هل يقارن declared total مع مجموع الصفوف؟ | لا |
| هل يقارن declared roll count مع عدد الصفوف؟ | لا |

## 10. ربط فاتورة الشراء

### هل import ينشئ `purchase_invoices`؟

- مسار `/api/purchases/import/:id/confirm`: نعم.
- مسار `/api/inventory/stock-import`: لا حاليًا.

### هل ينشئ `purchase_invoice_lines`؟

- مسار شراء Excel: نعم.
- مسار مخزون Excel: لا.

### حالة الفاتورة

- تنشأ أولًا DRAFT عبر `createPurchaseInvoice`.
- تؤكد مباشرة عبر `confirmPurchaseInvoice`.
- تصبح `CONFIRMED`.

### المورد

- يضبط من `batch.supplier_id`.

### رقم الفاتورة

مشكلة مهمة:

- `purchaseImportRoutes.ts` يقرأ `invoiceNoFinal = batch.invoice_no || generateDocumentNo('PI')`.
- لكن عند استدعاء `createPurchaseInvoice`، خدمة `purchaseInvoiceService.ts` تنفذ:
  - `const invoiceNo = await generateSequentialDocumentNo(client, companyId, 'PURCHASE_INVOICE')`
- أي أن رقم الفاتورة الفعلي في `purchase_invoices.invoice_no` يتم توليده داخل الخدمة، ولا يظهر أن `raw.invoiceNo` من import يُستخدم.

الأثر:

- `purchase_import_batches.invoice_no` قد يحمل رقم المستخدم.
- `fabric_rolls.purchase_invoice_no` قد يحمل رقم batch.
- `purchase_invoices.invoice_no` قد يحمل رقمًا تسلسليًا مختلفًا.

هذه فجوة Traceability خطيرة يجب إصلاحها لاحقًا إما بجعل الخدمة تحترم الرقم المرسل أو بتوحيد سياسة الترقيم.

### تاريخ الفاتورة

- محفوظ في batch.
- يمر إلى `createPurchaseInvoice`.

### المستودع

- محفوظ في batch.
- يمر إلى invoice header و invoice lines.

### العملة وسعر الصرف

- Preview يحسم العملة والسعر ويحفظهما.
- Confirm يعيد التحقق.
- `createPurchaseInvoice` يحسب حقول USD.

### GL Posting

- `confirmPurchaseInvoice` ينادي `postPurchaseInvoiceToGl` إذا `total_amount > 0`.
- إذا لم يوجد `unitCost` أو كان صفرًا، فاتورة الشراء قد تكون صفرية ولا ينتج عنها قيد مالي فعلي.

## 11. نتيجة المخزون بعد الاستيراد

### أي جدول يخزن الرولات؟

- `fabric_rolls`.

### هل كل صف Excel = توب/رول؟

- في Purchase Import: نعم، كل row صالح يتحول إلى `fabric_rolls` واحد.
- في Stock Import: نعم، كل row له `itemName` يتحول إلى roll واحد، حتى لو الطول/السعر/اللون ناقص.

### هل يولد barcode إذا مفقود؟

- Purchase Import: نعم عبر `generateBarcode`.
- Stock Import: نعم، لكن بصيغة `IMP-YYYYMMDD-...` حاليًا وليس 7 أرقام فقط.

### هل الرولات متاحة للبيع؟

- يتم إنشاء `fabric_rolls.status = 'AVAILABLE'`.
- ظهورها واختيارها من فاتورة البيع يحتاج اختبار Runtime، لكن المصدر يدل أنها قابلة للاستخدام كرصيد.

### هل ترتبط بالمورد؟

- Purchase Import: نعم `supplier_id`.
- Stock Import: نعم إذا اختير المورد في modal.

### هل ترتبط بالمستودع؟

- نعم في المسارين.

### هل ترتبط بالدفعة؟

- Purchase Import: لا يوجد `fabric_rolls.import_batch_id` مباشر. الربط يتم عبر `purchase_import_rows.created_roll_id` و `inventory_movements.reference_id`.
- Stock Import: لا يوجد batch رسمي؛ يوجد `batch_no = sourceLabel/batchTag`.

### هل تحفظ الأطوال؟

- Purchase Import: `length_m`.
- إذا header يدل Yard يحول إلى meter.
- Stock Import: `quantity` تتحول إلى `length_m`.

### إذا الطول مفقود؟

- Purchase Import: Warning ويسجل صفرًا عند confirm.
- Stock Import: يسمح ويضع صفرًا.

### هل البيع يحذف التاريخ؟

- لا يوجد دليل أنه يحذف السجل التاريخي؛ `inventory_movements` مصمم كسجل immutable. لكن سلوك البيع الفعلي يحتاج اختبار.

## 12. مقارنة مع رحلة العمل المطلوبة

| المطلوب | الحالة | الدليل/الملاحظة |
|---|---|---|
| اختيار المورد | مكتمل في Purchase Import، جزئي في Stock Import | Purchase مطلوب؛ Stock اختياري |
| اختيار المستودع | مكتمل | كلا المسارين |
| إدخال تاريخ الفاتورة | مكتمل فقط في Purchase Import | Stock Import لا يحتويه |
| إدخال/توليد رقم فاتورة | جزئي | يحفظ في batch لكن service قد تولد رقمًا آخر |
| العملة وسعر الصرف | مكتمل في Purchase Import | لا يوجد في Stock Import |
| رفع Excel | مكتمل | كلا المسارين |
| Preview rows | مكتمل | كلا المسارين |
| تحذيرات/أخطاء | مكتمل في Purchase Import، جزئي في Stock Import | Purchase يخزن rows/errors؛ Stock يرجع errors فقط |
| تأكيد import | مكتمل | كلا المسارين |
| إنشاء purchase invoice | مكتمل في Purchase Import، مفقود في Stock Import | كود Stock invoice معلق |
| إنشاء rolls/tops | مكتمل | كلا المسارين |
| إنشاء inventory movements | مكتمل | كلا المسارين |
| ربط batch/invoice/supplier/warehouse | جزئي | Purchase جيد لكن رقم الفاتورة غير موحد؛ Stock ناقص batch/invoice |
| ظهور المخزون | غالبًا مكتمل ويحتاج اختبار | `fabric_rolls AVAILABLE` |
| قابل للبيع | غالبًا مكتمل ويحتاج اختبار | يعتمد على شاشات الفواتير |
| Traceability | جزئي | Purchase أفضل؛ Stock ضعيف |
| دعم Chinese packing-list header | مفقود | لا استخراج Metadata |

## 13. ما يعمل حاليًا

- مسار Purchase Excel Import لديه workflow صحيح من حيث Preview ثم Confirm.
- يحفظ `purchase_import_batches` و `purchase_import_rows`.
- يخزن الأخطاء والتحذيرات لكل صف.
- يدعم قبول التحذيرات اختياريًا.
- يدعم توثيق scan للباركود قبل التأكيد.
- ينشئ رولات في `fabric_rolls`.
- ينشئ حركات مخزون في `inventory_movements`.
- ينشئ فاتورة شراء وخطوطها عند التأكيد.
- يربط `purchase_import_rows` بالرولات وبخطوط الفاتورة.
- يدعم currency/exchange_rate في Purchase Import.
- يفحص duplicate barcode داخل الملف وضد قاعدة البيانات.
- مسار Stock Import سريع ومناسب للملفات الكبيرة بسبب bulk inserts.

## 14. ما هو جزئي أو غير مكتمل

- مسار Stock Import لا ينشئ دفعة purchase import ولا فاتورة شراء.
- مسار Stock Import لا يطلب رأس فاتورة.
- مسار Stock Import يضع `unitCost = 0` عمدًا.
- مسار Purchase Import لا يبحث عن صف الأعمدة الحقيقي إذا لم يكن أول صف.
- مسار Purchase Import بطيء نسبيًا بسبب row-by-row validation و insert.
- رقم فاتورة الشراء المدخل من المستخدم لا يبدو أنه يصبح رقم `purchase_invoices.invoice_no` الحقيقي.
- لا يوجد عمود مباشر في `fabric_rolls` لـ `import_batch_id` أو `purchase_invoice_id`.
- لا يوجد parsing لرأس Packing List أو مقارنة totals.
- Cancel يحتاج اختبار أمان كامل.
- روابط UI بعد التأكيد تحتاج اختبار للتأكد أنها تفتح الفاتورة الصحيحة.

## 15. ما هو مفقود

- Unified import journey واحد يجمع:
  - مورد.
  - مستودع.
  - رقم فاتورة.
  - تاريخ.
  - عملة.
  - سعر صرف.
  - Preview.
  - Pricing.
  - Confirm purchase invoice.
  - Rolls.
  - Inventory movements.
  - Traceability.
- Parsing ذكي لملفات Packing List ذات رؤوس نصية.
- استخراج عرض inch وتحويله إلى cm.
- استخراج declared totals/roll counts والمقارنة.
- ربط مباشر بين roll و purchase_invoice_id/import_batch_id في schema.
- استيراد سريع bulk لمسار Purchase Import.
- سياسة واضحة للأرقام بين invoice_no المستخدم والتسلسل الداخلي.

## 16. السبب المرجح للمشكلة الحالية

المشكلة التي تظهر عند استيراد `مستودعات حلب-15.xlsx` غالبًا ليست في مسار `purchases/import-excel` فقط، بل في استخدام مسار `inventory/stock-import`.

هذا المسار:

- يستورد المواد بسرعة إلى `fabric_rolls`.
- يسمح بنقص البيانات.
- يربط المورد والمستودع فقط.
- لا يملك حقول رقم/تاريخ/عملة فاتورة.
- لا ينشئ `purchase_import_batches`.
- لا ينشئ `purchase_import_rows`.
- لا ينشئ `purchase_invoices` لأن الكود الخاص بذلك معلق.
- يوجه لاحقًا إلى التسعير الجماعي، لكن إنشاء فاتورة شراء بعد التسعير يعتمد على مسار آخر في `fabricRollRoutes.ts` وليس جزءًا من import نفسه.

لذلك إذا كان المطلوب "استيراد ذكي جدًا" ينتج فاتورة شراء نظامية ومخزونًا قابلًا للبيع وموردًا مدينًا/دائنًا، فلا يكفي مسار Stock Import الحالي وحده.

## 17. مخاطر محاسبية وتشغيلية

- خطر اختلاف رقم الفاتورة بين batch/roll/purchase invoice.
- خطر وجود مخزون بدون فاتورة شراء عند استخدام Stock Import.
- خطر تكلفة صفرية للرولات إذا تم استيراد مخزون بدون تسعير ثم لم يكتمل التسعير الجماعي.
- خطر بطء شديد أو timeout في Purchase Import مع ملفات كبيرة.
- خطر عدم استيراد ملفات Packing List التي تبدأ بعناوين ونصوص لأن parser يعتمد أول صف كـ header.
- خطر قبول طول صفر يجعل المخزون يظهر لكنه غير مفيد للبيع.
- خطر عدم وجود traceability مباشر من الرول إلى batch/invoice بدون join عبر import rows.

## 18. توصيات تنفيذ لاحقة

هذه توصيات فقط، ولم يتم تنفيذها في هذا التقرير.

1. توحيد المسارات أو توضيحها:
   - `Purchase Excel Import` للشراء المحاسبي.
   - `Stock Excel Import` لإدخال أولي سريع بدون فاتورة، أو تحويله إلى رحلة شراء كاملة.

2. تطوير Stock Import ليحفظ `import batch` رسمي أو يستخدم نفس `purchase_import_batches`.

3. إضافة خطوة Header قبل Stock Import:
   - المورد.
   - المستودع.
   - رقم الفاتورة.
   - التاريخ.
   - العملة.
   - سعر الصرف.

4. جعل التسعير الجماعي خطوة إلزامية قبل إنشاء فاتورة شراء إذا الأسعار غير موجودة.

5. بعد التسعير:
   - إنشاء `purchase_invoices`.
   - إنشاء `purchase_invoice_lines`.
   - تأكيد الفاتورة مع `skipStockMovement=true`.
   - تحديث الرولات برقم الفاتورة الحقيقي.

6. إصلاح سياسة رقم الفاتورة:
   - إما الخدمة تحترم `invoiceNo` المرسل.
   - أو UI يمنع إدخال رقم خارجي ويعرض أن الرقم سيولد آليًا.
   - لا يجوز وجود رقمين مختلفين لنفس العملية.

7. تحسين Purchase Import performance:
   - prefetch master data بدل queries لكل صف.
   - bulk insert لـ `purchase_import_rows`.
   - bulk create للرولات والحركات.

8. إضافة parser ذكي لرؤوس Packing List:
   - البحث عن صف الأعمدة الحقيقي.
   - استخراج اسم الخام/العرض/invoice/header metadata.
   - قراءة declared totals.
   - مقارنة declared roll count و meter total.

9. إضافة أعمدة ربط صريحة مستقبلًا، بعد قرار معماري:
   - `fabric_rolls.purchase_invoice_id`
   - `fabric_rolls.purchase_invoice_line_id`
   - `fabric_rolls.import_batch_id`

## 19. Checklist اختبارات Runtime مطلوبة

### Test 1: ملف صغير نظيف 3 صفوف

- افتح `/purchases/import-excel`.
- اختر مورد ومستودع وتاريخ ورقم فاتورة.
- ارفع ملفًا بثلاثة صفوف كاملة.
- تحقق:
  - batch PREVIEW.
  - rows VALID.
  - confirm ينجح.
  - rolls created.
  - invoice created.
  - invoice lines created.
  - inventory movements created.

### Test 2: ملف بدون cost

- ارفع صفوف بدون سعر.
- تحقق:
  - هل تتحول إلى warnings فقط؟
  - هل تنشأ فاتورة بقيمة صفر؟
  - هل GL لا يرحل؟

### Test 3: ملف بدون barcode

- تحقق أن Preview يعطي warning.
- بعد Confirm تحقق أن barcode ولد في `fabric_rolls`.

### Test 4: duplicate barcode

- ضع باركود مكرر داخل الملف.
- يجب أن يعطي ERROR ويمنع Confirm.
- جرّب باركود موجود في DB ويجب أن يعطي ERROR.

### Test 5: ملف كبير 500+ صف

- اختبر Purchase Import.
- قس زمن Preview.
- قس زمن Confirm.
- راقب أي timeout.
- قارن مع Stock Import.

### Test 6: Chinese Packing List Header

ملف يحتوي:

```text
DETAILED PACKING LIST
ABOUT: THE DETAIL PACKING LIST OF Amelia-19 66/67
TOTAL SHIPPED SITUATION: 37940 M 475 ROLLS
```

توقع حالي:

- Purchase Import غالبًا يفشل أو يخطئ اكتشاف الأعمدة إذا لم تكن أول row.
- لا استخراج metadata.

### Test 7: تحقق ما بعد Confirm

افحص SQL أو UI:

- `purchase_invoices`
- `purchase_invoice_lines`
- `fabric_rolls`
- `inventory_movements`
- `purchase_import_batches.created_purchase_invoice_id`
- `purchase_import_rows.created_roll_id`
- `purchase_import_rows.created_purchase_invoice_line_id`
- ظهور الرولات في شاشة المخزون.
- اختيار الرولات من فاتورة بيع.

### Test 8: Cancel batch

- أنشئ Preview.
- ألغ الدفعة قبل Confirm.
- تحقق من status.
- تأكد أنه لا توجد رولات.
- جرّب إلغاء Batch مؤكدة وتأكد أنه يمنع أو لا يكسر البيانات.

## 20. إجابات مختصرة على الأسئلة الأساسية

| السؤال | الجواب |
|---|---|
| أين يبدأ Purchase Excel Import في الواجهة؟ | `/purchases/import-excel` عبر `ImportExcel.tsx` |
| أي زر/صفحة يفتح التدفق؟ | زر استيراد من صفحة المشتريات ورابط سجل الاستيرادات، route مباشر |
| هل يطلب supplier/warehouse/date/no/notes/currency/rate؟ | نعم في Purchase Import؛ لا في Stock Import |
| هل ترسل حقول الرأس في Preview؟ | نعم في Purchase Import |
| هل ترسل حقول الرأس في Confirm؟ | لا؛ Confirm يستخدم batch المحفوظ |
| هل barcode confirmation bypasses header؟ | لا |
| هل ينشئ import batch؟ | نعم في Purchase Import؛ لا في Stock Import |
| هل ينشئ import rows؟ | نعم في Purchase Import؛ لا في Stock Import |
| هل ينشئ fabric rolls؟ | نعم عند Confirm أو Stock Import |
| هل ينشئ inventory movements؟ | نعم |
| هل ينشئ purchase invoice header؟ | نعم في Purchase Import Confirm؛ لا في Stock Import |
| هل ينشئ purchase invoice lines؟ | نعم في Purchase Import Confirm؛ لا في Stock Import |
| هل rolls مرتبطة بالفاتورة؟ | جزئيًا عبر invoice lines وpurchase_invoice_no النصي، لكن رقم الفاتورة قد يختلف |
| هل rolls مرتبطة بالمورد؟ | نعم إذا المسار يملك supplier |
| هل rolls مرتبطة بالمستودع؟ | نعم |
| هل rolls مرتبطة بالدفعة؟ | غير مباشر في Purchase Import؛ لا في Stock Import |
| هل تظهر بالمخزون؟ | متوقع نعم لأنها AVAILABLE؛ يحتاج Runtime |
| هل قابلة للبيع؟ | متوقع نعم؛ يحتاج Runtime |
| هل الأطوال تحفظ؟ | نعم كـ length_m |
| هل الأسعار تحفظ؟ | Purchase Import يحفظ unitCost إذا موجود؛ Stock Import يجعله صفرًا |
| هل القيم الناقصة مسموحة؟ | نعم لبعض الحقول؛ material مطلوب |
| هل duplicate barcode مكتشف؟ | نعم في Purchase Import |
| هل failed/warning rows محفوظة؟ | نعم في Purchase Import |
| هل يدعم 500+ صف؟ | schema يسمح حتى 5000 في Purchase و20000 في Stock، لكن أداء Purchase يحتاج اختبار |
| ما المكسور/الناقص؟ | فرق المسارات، عدم إنشاء فاتورة في Stock Import، بطء Purchase Import، عدم parsing للرؤوس، اختلاف رقم الفاتورة |

## 21. قرار هندسي مقترح للخطوة التالية

إذا الهدف هو إدخال `مستودعات حلب-15.xlsx` بسرعة ثم تسعيره ثم إنشاء فاتورة شراء نظامية، فالقرار الأفضل ليس تعديلًا صغيرًا في parser فقط. المطلوب Workflow واضح:

1. استيراد مخزون ذكي سريع إلى staging/batch رسمي.
2. اختيار المورد والمستودع قبل الاستيراد.
3. السماح بنقص اللون/الكود/السعر.
4. بعد الاستيراد فتح التسعير الجماعي حسب الخامة.
5. عند حفظ التسعير إنشاء فاتورة شراء مؤكدة.
6. ربط كل roll بالـ batch والفاتورة والخط والمورد والمستودع.
7. تحديث شاشة السجل لإظهار traceability كاملة.

هذا يمنع الكارثة المحاسبية: "مخزون موجود لكن لا توجد فاتورة شراء أو تكلفة".
