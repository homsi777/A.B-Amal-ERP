# Excel Import Root-Cause Fix Report

Date: 2026-05-11  
Scope: purchase Excel import and inventory stock Excel import flow.

## 1. Executive Summary

تم تنفيذ إصلاح جذري لمسارات استيراد Excel الأكثر خطورة:

- أضيفت مهلة واضحة لطلبات API حتى لا يبقى المستخدم ينتظر ساعات بدون نتيجة.
- تم تحسين مسار استيراد فاتورة الشراء لقراءة صف العناوين الحقيقي بدل افتراض أن أول صف هو العنوان.
- تم استخراج بيانات أولية من رؤوس Packing List مثل اسم الخامة، العرض، إجمالي الطول المصرح، وعدد الأتواب المصرح.
- تم توسيع نموذج التتبع الحالي `purchase_import_batches` و`purchase_import_rows` ليخدم أيضاً استيراد المخزون السريع.
- أصبح استيراد المخزون السريع ينشئ batch وrows ويربط الرولات والحركات بها، بدل إنشاء مخزون بلا أثر محاسبي واضح.
- تم ربط رولات استيراد الشراء بالفاتورة وخط الفاتورة عند التأكيد.
- تم إضافة حقل `supplier_invoice_no` لتمييز رقم فاتورة المورد عن رقم فاتورة النظام الداخلي.

لم يتم تشغيل الهجرة على قاعدة بيانات الإنتاج/التجربة، ولم يتم تنفيذ استيراد حقيقي على ملف المستخدم، لتجنب تغيير بيانات فعلية بدون إشراف المستخدم.

## 2. Root Cause Analysis

المشكلة الأصلية كانت بسبب وجود مسارين منفصلين:

- مسار شراء: `/purchases/import-excel` و`/api/purchases/import/*`، يملك دفعة وصفوف وفاتورة لكنه أبطأ ويفترض أحياناً أن أول صف هو header.
- مسار مخزون سريع: `StockExcelImportModal` و`/api/inventory/stock-import`، سريع لكنه كان ينشئ الرولات وحركات المخزون مباشرة بدون `purchase_import_batches` أو `purchase_import_rows` أو رابط فاتورة.

هذا خلق مشكلتين عمليتين:

- انتظار طويل أو صامت عند الملفات الكبيرة أو عند فشل الشبكة.
- مخزون مستورد غير قابل للتدقيق محاسبياً بنفس مستوى مسار فاتورة الشراء.

## 3. What Was Changed

### Frontend

- `src/lib/api/client.ts`
  - أضيف `timeoutMs` إلى `apiFetch`.
  - أضيف دعم structured errors: `error`, `details`.
  - عند انتهاء المهلة يظهر خطأ واضح بدلاً من انتظار صامت.

- `src/lib/api/purchaseImportApi.ts`
  - أضيف كشف صف العنوان الحقيقي من أول 20 صف.
  - أضيف استخراج metadata من النص قبل الجدول.
  - أضيف إرسال `headerRowIndex`, `preTableRows`, `extractedMetadata`.
  - أضيفت مهلات أطول للمعاينة والتأكيد.

- `src/lib/api/stockImportApi.ts`
  - أضيف `sourceType`, `fileName`, `sheetName`, `detectedColumns`, `extractedMetadata`.
  - أضيف `batchId` في النتيجة.

- `src/pages/inventory/StockExcelImportModal.tsx`
  - أضيف اختيار نوع الاستيراد بدون تغيير التصميم العام:
    `مواد أول مدة`, `فاتورة شراء`, `مخزون مباشر`.
  - زاد حجم الدفعة من 100 إلى 1000 صف لتقليل عدد الطلبات.
  - أصبحت بيانات الملف والورقة والأعمدة المكتشفة تصل للباكند.

- `src/pages/purchases/ImportExcel.tsx`
  - أضيفت رسائل تقدم غير حاجبة أثناء قراءة وتحليل وتأكيد الاستيراد.

- `src/pages/purchases/ImportBatches.tsx`
  - أصبح يدعم الحالات الجديدة بشكل آمن.

### Backend

- `server/src/db/migrations/024_excel_import_traceability_and_metadata.sql`
  - توسيع `purchase_import_batches`.
  - إضافة `source_type`, `supplier_invoice_no`, `extracted_metadata`, `detected_columns`.
  - إضافة `imported_count`, `failed_count`, `started_at`, `failed_at`, `error_message`.
  - إضافة روابط على `purchase_import_rows` و`fabric_rolls`.
  - إضافة `purchase_invoices.supplier_invoice_no`.

- `server/src/routes/purchaseImportRoutes.ts`
  - حفظ metadata والأعمدة المكتشفة في batch.
  - حفظ التحذيرات عند اختلاف العدد/الطول المصرح مع الصفوف المقروءة.
  - ضبط حالة batch إلى `CONFIRMING` عند التأكيد.
  - ربط الرولات بـ `import_batch_id`.
  - حفظ `created_inventory_movement_id` على صف الاستيراد.
  - ربط الرول بـ `purchase_invoice_id` و`purchase_invoice_line_id`.
  - تحديث batch إلى `FAILED` مع رسالة خطأ عند فشل التأكيد.

- `server/src/routes/stockImportRoutes.ts`
  - أصبح ينشئ `purchase_import_batches` لمسار المخزون السريع.
  - أصبح ينشئ `purchase_import_rows`.
  - أصبح يربط الرولات بـ batch.
  - أصبح يربط rows بالرولات وحركات المخزون عند نجاح الإدراج.
  - يحافظ على السرعة عبر bulk insert.

- `server/src/services/purchaseInvoiceService.ts`
  - أضيف `supplierInvoiceNo`.
  - يتم حفظ رقم فاتورة المورد منفصلاً عن رقم فاتورة النظام الداخلي.

## 4. Database Migration

تمت إضافة migration جديدة:

`server/src/db/migrations/024_excel_import_traceability_and_metadata.sql`

يجب تشغيل الهجرة قبل تجربة الاستيراد الجديد:

```bash
npm run server:migrate
```

لم يتم تشغيلها من طرف Codex حتى لا أغيّر قاعدة البيانات الفعلية بدون قرار منك.

## 5. Import Flow Before vs After

Before:

- استيراد المخزون السريع ينشئ رولات وحركات فقط.
- لا يوجد batch/rows traceability لهذا المسار.
- لا توجد مهلة واضحة عند التعليق.
- ملفات Packing List التي تحتوي عنواناً قبل الجدول قد تفشل أو تُقرأ خطأ.

After:

- كل استيراد مخزون يملك batch تتبع.
- كل صف مستورد يملك row staging.
- الرول مربوط بالدفعة.
- الحركة مربوطة بصف الاستيراد عند الإمكان.
- شراء Excel يحفظ metadata ويستخرج رؤوس Packing List.
- الطلبات الطويلة تنتهي برسالة timeout واضحة.

## 6. Parser/Header Detection

تمت إضافة helper في `purchaseImportApi.ts`:

- `findHeaderRow()`: يبحث في أول 20 صفاً عن صف العناوين الحقيقي.
- `extractPreTableMetadata()`: يحلل النصوص قبل الجدول.

يدعم أمثلة مثل:

```text
THE DETAIL PACKING LIST OF Amelia-19 66/67
TOTAL SHIPPED SITUATION: 37940 M 475 ROLLS
DATE: 16/Oct/25
```

ويستخرج:

- اسم الخامة.
- العرض الخام.
- العرض بالسنتيمتر min/max/avg.
- إجمالي الطول المصرح.
- عدد الأتواب المصرح.
- تاريخ الملف النصي.

## 7. Performance Changes

- مسار المخزون السريع كان أصلاً bulk insert، وتم الحفاظ عليه.
- تم رفع حجم chunk في الواجهة من 100 إلى 1000 لتقليل عدد الطلبات.
- مسار الشراء ما زال يحتوي منطق row-by-row في بعض مراحل المطابقة والإنشاء. تم تحسين التتبع والمهلة، لكن لم يتم تحويله بالكامل إلى bulk بسبب حساسية إنشاء الأصناف/الألوان/الفاتورة داخل transaction.

## 8. Accounting Traceability

Purchase import:

- ينشئ purchase invoice.
- ينشئ purchase invoice lines.
- ينشئ rolls.
- ينشئ inventory movements.
- يربط rows بالرولات وخطوط الفاتورة.
- يربط rolls بالفاتورة وخط الفاتورة.
- يحفظ رقم فاتورة المورد في `supplier_invoice_no`.

Opening stock / direct stock import:

- ينشئ rolls.
- ينشئ inventory movements.
- ينشئ batch وrows للتتبع.
- لا ينشئ ديناً على المورد تلقائياً.

## 9. Test Results

تم تشغيل:

```bash
npm run lint
npm run server:check
npm run test
npm run server:build
```

النتيجة:

- `npm run lint`: نجح.
- `npm run server:check`: نجح.
- `npm run test`: نجح، `fabricInvoiceSummary tests passed`.
- `npm run server:build`: نجح، وتم نسخ migrations إلى `server-dist/db/migrations`.

تمت محاولة:

```bash
npm run electron:dev:stack
```

النتيجة:

- فشل بسبب نفق SSH/VPS، وهذا متوقع حسب توضيحك لأن VPN يعمل.

تمت محاولة:

```bash
npm run electron:dev
```

النتيجة:

- وصل السيرفر وVite إلى التشغيل.
- توقف Electron عند خطأ موجود في مسار التشغيل المحلي:
  `TypeError: Cannot read properties of undefined (reading 'requestSingleInstanceLock')`
- لا يوجد دليل من هذا الخطأ أنه ناتج عن تعديلات الاستيراد، لكنه يمنع اعتبار Electron dev verified من طرفي.

## 10. Manual Test Checklist

بعد تشغيل migration:

1. استيراد ملف صغير 3 صفوف من مسار شراء.
2. التأكد من إنشاء batch وrows وrolls وmovements وpurchase invoice وpurchase invoice lines.
3. استيراد ملف كبير 500+ صف من شاشة المخزون.
4. التأكد أن الاستيراد لا يعلق وأن batch يظهر في سجل الدفعات.
5. تجربة ملف فيه header قبل الجدول.
6. مقارنة عدد الأتواب المصرح ومجموع الطول مع المعاينة.
7. فتح المخزون والتأكد أن الرولات المستوردة ظاهرة وقابلة للبيع.
8. فتح سجل دفعات الاستيراد والتأكد من ظهور الحالة والرابط/البيانات.

## 11. Remaining Risks

- لم يتم تنفيذ استيراد فعلي على ملف `مستودعات حلب-15.xlsx` داخل قاعدة بياناتك.
- مسار Purchase Import ما زال أبطأ من Stock Import لأنه يحتوي منطق مطابقة وإنشاء تفصيلي لكل صف.
- حالات عرض metadata في UI ما زالت أولية؛ البيانات محفوظة في batch لكن يمكن تحسين عرضها في شاشة الدفعات لاحقاً.
- يجب اختبار migration على نسخة قاعدة بيانات قبل الإنتاج.
- يجب معالجة خطأ Electron المحلي إذا ظهر عندك أيضاً بدون VPN.

## 12. Recommended Next Steps

1. شغّل `npm run server:migrate`.
2. جرّب ملف Excel الحقيقي من شاشة المخزون مع نوع `مواد أول مدة`.
3. افتح سجل دفعات الاستيراد وتأكد أن batch ظهر.
4. ادخل إلى المخزون وتأكد من الرولات.
5. بعد نجاح الاستيراد، ادخل إلى التسعير الجماعي حسب الخامة.
6. إذا كان الهدف فاتورة شراء محاسبية كاملة، استخدم مسار `استيراد فاتورة شراء` وليس `مواد أول مدة`.
