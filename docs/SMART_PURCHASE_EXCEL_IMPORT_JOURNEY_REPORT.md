# SMART PURCHASE EXCEL IMPORT JOURNEY — REPORT

## 1) Summary of enhancement
- تم ترقية استيراد مشتريات Excel ليعمل كـ “رحلة استلام فاتورة شراء” مناسبة لفواتير كبيرة (500+ سطر) بدون إعادة تصميم للواجهة.
- المستخدم يدخل **رأس الفاتورة مرة واحدة** (المورد/المستودع/تاريخ/رقم/ملاحظات/عملة/سعر صرف)، ثم يتم رفع الملف وعرض معاينة ونتائج تحقق، ثم “تأكيد الاستيراد”.
- عند التأكيد: يتم إنشاء الأتواب (rolls) + حركة مخزون (PURCHASE_RECEIPT) + **إنشاء فاتورة مشتريات (header + lines)** وربطها بالدفعة وبصفوف الاستيراد، مع تجنّب تكرار حركة المخزون.
- تم تحسين قابلية التتبع: في سجل الدُفعات يظهر رقم/تاريخ الفاتورة ورابط فاتورة الشراء الناتجة.

## 2) Existing import behavior discovered
- الواجهة كانت تدعم 3 خطوات: رفع → مراجعة → تأكيد.
- الـ backend كان يقوم بـ:
  - Preview: إنشاء Batch + Rows مع statuses و errors/warnings و detectedColumns.
  - Confirm: إنشاء fabric_rolls + inventory_movements مرجعها IMPORT_BATCH + تحديث الصفوف والدفعة إلى CONFIRMED.
- لم يكن يتم إنشاء purchase_invoices / purchase_invoice_lines ولا يوجد ربط بين الاستيراد ووثيقة فاتورة مشتريات.
- كان يوجد استخدام `confirm()` في صفحة ImportBatches لإلغاء الدفعة (مخالِف لمبدأ non-blocking toasts).

## 3) Files created
- [019_smart_purchase_import_invoice_header.sql](file:///c:/Users/Homsi/Desktop/%D9%86%D8%B8%D8%A7%D9%85-%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9-%D9%85%D8%B3%D8%AA%D9%88%D8%AF%D8%B9%D8%A7%D8%AA-%D8%A7%D9%84%D8%A3%D9%82%D9%85%D8%B4%D8%A9-(erp)/server/src/db/migrations/019_smart_purchase_import_invoice_header.sql)
- [SMART_PURCHASE_EXCEL_IMPORT_JOURNEY_REPORT.md](file:///c:/Users/Homsi/Desktop/%D9%86%D8%B8%D8%A7%D9%85-%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9-%D9%85%D8%B3%D8%AA%D9%88%D8%AF%D8%B9%D8%A7%D8%AA-%D8%A7%D9%84%D8%A3%D9%82%D9%85%D8%B4%D8%A9-(erp)/docs/SMART_PURCHASE_EXCEL_IMPORT_JOURNEY_REPORT.md)

## 4) Files modified
- Frontend:
  - [ImportExcel.tsx](file:///c:/Users/Homsi/Desktop/%D9%86%D8%B8%D8%A7%D9%85-%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9-%D9%85%D8%B3%D8%AA%D9%88%D8%AF%D8%B9%D8%A7%D8%AA-%D8%A7%D9%84%D8%A3%D9%82%D9%85%D8%B4%D8%A9-(erp)/src/pages/purchases/ImportExcel.tsx)
  - [ImportBatches.tsx](file:///c:/Users/Homsi/Desktop/%D9%86%D8%B8%D8%A7%D9%85-%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9-%D9%85%D8%B3%D8%AA%D9%88%D8%AF%D8%B9%D8%A7%D8%AA-%D8%A7%D9%84%D8%A3%D9%82%D9%85%D8%B4%D8%A9-(erp)/src/pages/purchases/ImportBatches.tsx)
  - [purchaseImportApi.ts](file:///c:/Users/Homsi/Desktop/%D9%86%D8%B8%D8%A7%D9%85-%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9-%D9%85%D8%B3%D8%AA%D9%88%D8%AF%D8%B9%D8%A7%D8%AA-%D8%A7%D9%84%D8%A3%D9%82%D9%85%D8%B4%D8%A9-(erp)/src/lib/api/purchaseImportApi.ts)
- Backend:
  - [purchaseImportRoutes.ts](file:///c:/Users/Homsi/Desktop/%D9%86%D8%B8%D8%A7%D9%85-%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9-%D9%85%D8%B3%D8%AA%D9%88%D8%AF%D8%B9%D8%A7%D8%AA-%D8%A7%D9%84%D8%A3%D9%82%D9%85%D8%B4%D8%A9-(erp)/server/src/routes/purchaseImportRoutes.ts)
- (موجود مسبقاً وتم الاعتماد عليه لتجنّب تكرار الحركات):
  - [purchaseInvoiceService.ts](file:///c:/Users/Homsi/Desktop/%D9%86%D8%B8%D8%A7%D9%85-%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9-%D9%85%D8%B3%D8%AA%D9%88%D8%AF%D8%B9%D8%A7%D8%AA-%D8%A7%D9%84%D8%A3%D9%82%D9%85%D8%B4%D8%A9-(erp)/server/src/services/purchaseInvoiceService.ts)

## 5) Migrations added if any
- إضافة مهاجرة: `019_smart_purchase_import_invoice_header.sql`
  - `purchase_import_batches`:
    - `invoice_no text`
    - `invoice_date date`
    - `exchange_rate_to_usd numeric(18,6)`
    - `created_purchase_invoice_id uuid REFERENCES purchase_invoices(id)`
  - `purchase_import_rows`:
    - `created_purchase_invoice_line_id uuid REFERENCES purchase_invoice_lines(id)`

## 6) Header fields added (Import UI)
تمت إضافة حقول رأس الفاتورة في صفحة الاستيراد:
- المورد (إلزامي)
- المستودع (إلزامي)
- تاريخ الفاتورة (إلزامي، افتراضي اليوم)
- رقم فاتورة الشراء (اختياري)
- ملاحظات (اختياري)
- العملة (اختياري، افتراضي USD)
- سعر الصرف مقابل الدولار (اختياري — يُستخدم عند العملة غير USD)

## 7) Column mapping / aliases supported
- الاستيراد يعتمد كاشف الأعمدة الموجود مسبقاً في السيرفر (detectColumnMap/normalizeRow).
- يدعم حقولاً معيارية مثل: materialName, internalMaterialCode, supplierMaterialCode, colorName, rollNo, barcode, lengthM, unitCost, notes… إلخ.
- لا يتم فرض أعمدة “رأس الفاتورة” من Excel (المورد/المستودع/التاريخ/الرقم تأتي من النموذج).

## 8) Validation / preview behavior
- Preview يتحقق من:
  - صحة المورد/المستودع (ينتمون للشركة)
  - صحة الموقع الافتراضي إن تم اختياره
  - العملة وسعر الصرف (USD=1 أو من جدول أسعار الصرف أو من إدخال المستخدم)
  - **منع رقم فاتورة مشتريات مكرر** (إذا أُدخل رقم فاتورة)
  - التحقق على مستوى الصفوف: صف فارغ/عدم وجود خامة/قيم رقمية غير صالحة/باركود مكرر داخل الملف/باركود موجود مسبقاً في DB
- الواجهة تعرض ملخص (عدد الصفوف/التحذيرات/الأخطاء) + جدول صفوف مع إمكانية فلترة حسب الحالة.
- التعامل مع الرسائل عبر toasts غير حاجبة.

## 9) Import transaction behavior
- Confirm يعمل ضمن Transaction واحدة:
  - إنشاء master data الناقص (حسب importMode)
  - إنشاء fabric_rolls
  - إنشاء inventory_movements مرجعها IMPORT_BATCH
  - إنشاء purchase_invoice + purchase_invoice_lines وربطها
  - تحديث حالات الصفوف والدفعة
- أي خطأ يسبب rollback كامل لتأمين الاتساق.

## 10) Purchase invoice linking behavior
- عند Confirm:
  - يتم إنشاء Purchase Invoice (Header) برقم الفاتورة (المدخل أو المولّد).
  - يتم إنشاء سطور الفاتورة (Lines) بمقدار quantity = lengthM و unitCost من Excel عند توفرها (وإلا 0).
  - يتم تأكيد فاتورة الشراء مباشرة مع `skipStockMovement=true` لتجنّب تكرار حركة المخزون (لأن حركة الاستلام تمت بالفعل عبر IMPORT_BATCH).
  - يتم حفظ الربط:
    - `purchase_import_batches.created_purchase_invoice_id`
    - `purchase_import_rows.created_purchase_invoice_line_id`

## 11) Inventory roll creation behavior
- يتم إنشاء رول لكل صف صالح/تحذير:
  - barcode: يُستخدم من Excel إن توفر، وإلا يتم توليد barcode آمن.
  - item/color/variant: تُربط إن وُجدت، أو تُنشأ تلقائياً عند وضع CREATE_MISSING_MASTER_DATA.
  - يتم حفظ supplier_id/warehouse_id/location_id من رأس الفاتورة.
  - purchase_invoice_no يتم تعبئتها من رقم الفاتورة النهائي (Batch header).

## 12) Inventory movement behavior
- يتم إنشاء حركة مخزون لكل رول:
  - movement_type = PURCHASE_RECEIPT
  - reference_type = IMPORT_BATCH
  - reference_id = batchId
  - reference_no يحتوي warehouseId ورقم الفاتورة النهائي
- عند تأكيد Purchase Invoice الناتجة عن الاستيراد: يتم تجنب إدراج حركة ثانية (`skipStockMovement=true`).

## 13) Import batch traceability
- صفحة ImportBatches تعرض الآن:
  - رقم الفاتورة + تاريخ الفاتورة
  - رابط “عرض فاتورة الشراء” عند توفر created_purchase_invoice_id
- تم إزالة `confirm()` واستبداله بتأكيد غير حاجب عبر “اضغط مرة ثانية لإلغاء الدفعة”.

## 14) Test commands run
- `npm run lint`
- `npm run server:check`
- `npm run test`
- `npm run server:build`

## 15) Test results
- جميع الأوامر أعلاه نجحت بدون أخطاء.

## 16) Manual test checklist
- استيراد ملف Excel كبير (500+ صف) مع:
  - اختيار المورد + المستودع + تاريخ الفاتورة
  - إدخال رقم فاتورة (اختياري) + تجربة تركه فارغاً
  - تجربة عملة غير USD مع سعر صرف (أو بدون سعر صرف إذا كان موجود بجدول الأسعار)
- التحقق من:
  - المعاينة تعرض عدد الصفوف والنتائج
  - منع باركود مكرر داخل الملف / في DB
  - تأكيد الاستيراد ينشئ rolls ويُظهرها بالمخزون
  - صفحة ImportBatches تُظهر رقم/تاريخ الفاتورة
  - رابط فاتورة الشراء يفتح كشف الفاتورة
  - إمكانية اختيار رول مستورد داخل فاتورة البيع

## 17) What is fully completed
- نموذج رأس الفاتورة قبل الاستيراد + إرسالها للـ preview.
- Preview مرن مع تلخيص + جدول صفوف.
- Confirm transactional: rolls + movements + invoice + lines + روابط تتبع.
- تحديث سجل الدُفعات لعرض بيانات الفاتورة ورابطها + إزالة confirm().

## 18) What remains partial
- “Mapping متسامح جداً” (توسيع مرادفات الأعمدة أكثر) يمكن تعزيزه حسب ملفات الموردين الواقعية (لكن الأساس موجود).
- تقارير تفصيلية للأسطر الفاشلة/المحذّرة داخل صفحة تفاصيل للدفعة (يمكن إضافتها لاحقاً إن رغبت).

## 19) Remaining risks
- إذا أدخل المستخدم رقم فاتورة مكرر سيتم رفض العملية في preview (سلوك مقصود لتجنّب تضارب الوثائق).
- إذا كانت تكاليف الاستيراد كبيرة (unitCost موجود) سيتم عمل GL posting عند تأكيد فاتورة الشراء (مناسب غالباً، لكنه تغيير سلوكي يجب الانتباه له).

## 20) Recommended next steps
- إضافة “عرض تفاصيل الدفعة” (صفوف ناجحة/فاشلة/أسباب) داخل ImportBatches بدون تغيير التصميم.
- تحسين فلترة المخزون لتضمين البحث بـ invoice_no أو batchId إن كانت شاشة المخزون لا تدعم ذلك بشكل كاف.
- إضافة اختبار تكاملي server-side للـ confirm يضمن إنشاء invoice والربط مع rows.

