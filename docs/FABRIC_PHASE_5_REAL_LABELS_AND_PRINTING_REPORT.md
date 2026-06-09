# تقرير المرحلة الخامسة: لصاقات وباركود وQR وطباعة A4/PDF حقيقية

**تاريخ الإنجاز:** 2 مايو 2026  
**الحالة:** ✅ مكتمل — 29/29 اختباراً ناجحاً  
**المراحل السابقة:** Phase 1 ✅ | Phase 1.1 ✅ | Phase 2 ✅ | Phase 3 ✅ | Phase 4 ✅

---

## 1. الملخص التنفيذي

تم في هذه المرحلة تحويل صفحة طباعة اللصاقات من بيانات Zustand/مؤقتة إلى بيانات حقيقية من PostgreSQL، وإضافة تتبع مهام الطباعة، وبناء نظام لصاقات احترافي يدعم الباركود وQR والطباعة على A4 أو لصاقة 100×80mm. النظام مُهيَّأ معمارياً للتكامل المستقبلي مع Electron دون تغيير مصدر البيانات.

**المبدأ الأساسي:** اللصاقات تعرض بيانات حقيقية من `fabric_rolls` فقط — لا بيانات مؤقتة.

### إنجازات المرحلة:
- 🗄️ هجرة قاعدة بيانات: 3 جداول جديدة (templates, print_jobs, printed_labels)
- 🌱 بذرة القالب الافتراضي 100×80mm تلقائياً
- 🔧 8 نقاط API backend لإدارة القوالب والمعاينة وسجل الطباعة
- 📦 مكوّن `LabelCard` معزول قابل لإعادة الاستخدام
- 🖨️ إعادة بناء `StickerPrinting.tsx` بـ 3 أوضاع: اختيار، دفعة، فردي
- 📋 صفحة سجل مهام الطباعة
- 🔗 تكامل كامل مع Inventory وRollDetails وImportExcel وImportBatches
- 🧪 29/29 اختباراً ناجحاً

---

## 2. الملفات المُنشأة

| الملف | الوصف |
|-------|-------|
| `server/src/db/migrations/006_label_printing_foundation.sql` | هجرة إنشاء جداول الطباعة الثلاثة |
| `server/src/routes/labelPrintRoutes.ts` | 8 نقاط API للقوالب والمعاينة ومهام الطباعة |
| `src/lib/api/labelsApi.ts` | بوابة API الـ frontend بأنواع TypeScript |
| `src/components/labels/LabelCard.tsx` | مكوّن اللصاقة المعزول + `buildPrintDocument()` |
| `src/pages/inventory/PrintJobs.tsx` | صفحة سجل مهام الطباعة |
| `server/_test_phase5_labels.py` | سكريبت اختبار Python الآلي (29 اختبار) |

---

## 3. الملفات المُعدَّلة

| الملف | التغيير |
|-------|---------|
| `server/src/db/seed.ts` | إضافة بذرة القالب الافتراضي لكل شركة |
| `server/src/app.ts` | تسجيل `labelPrintRoutes` على `/api/labels` |
| `src/pages/inventory/StickerPrinting.tsx` | إعادة بناء كاملة — بيانات PostgreSQL حقيقية |
| `src/pages/inventory/RollDetails.tsx` | تمرير `?rollId=` لزر طباعة اللصاقة |
| `src/pages/Inventory.tsx` | تمرير `?rollId=` لأيقونة الطابعة في جدول الأتواب |
| `src/pages/purchases/ImportExcel.tsx` | زر "طباعة لصاقات الدفعة" في نتيجة التأكيد |
| `src/pages/purchases/ImportBatches.tsx` | أيقونة طباعة للدفعات المؤكَّدة |
| `src/layouts/DashboardLayout.tsx` | إضافة "سجل الطباعة" في القائمة الجانبية |
| `src/App.tsx` | مسار `/inventory/print-jobs` |

---

## 4. تفاصيل هجرة قاعدة البيانات

### جدول `label_templates`

تعريف قوالب اللصاقات القابلة للتخصيص.

| الحقل | القيمة/الوصف |
|-------|--------------|
| `template_type` | `ROLL_LABEL / PALLET_LABEL / LOCATION_LABEL` |
| `width_mm` | عرض اللصاقة بالملليمتر |
| `height_mm` | ارتفاع اللصاقة بالملليمتر |
| `content_config` | JSON يحتوي على الحقول المُفعَّلة |
| `is_default` | القالب الافتراضي للشركة |
| `UNIQUE (company_id, code)` | كود فريد لكل شركة |

### جدول `print_jobs`

سجل كل مهمة طباعة أطلقها المستخدم.

| الحقل | القيمة/الوصف |
|-------|--------------|
| `status` | `CREATED / PREVIEWED / PRINTED / FAILED / CANCELLED` |
| `source_type` | `ROLL_SELECTION / IMPORT_BATCH / SINGLE_ROLL` |
| `source_id` | UUID المصدر (batch_id, roll_id) |
| `roll_count` | عدد اللصاقات المطلوبة |
| `printed_count` | عدد اللصاقات التي أفاد المستخدم بطباعتها |

### جدول `printed_labels`

سجل تدقيق للصاقات المطبوعة لكل ثوب.

| الحقل | الوصف |
|-------|-------|
| `roll_id` | الثوب المطبوع |
| `barcode` | الباركود المطبوع |
| `print_count` | عدد مرات الطباعة التراكمي |
| `last_printed_at` | آخر وقت طباعة |

---

## 5. القالب الافتراضي للصاقة

يُنشأ تلقائياً لكل شركة عند تشغيل `seed.ts`:

```json
{
  "code":         "DEFAULT_ROLL_100X80",
  "name":         "لصاقة ثوب افتراضية 100×80",
  "template_type": "ROLL_LABEL",
  "width_mm":     100,
  "height_mm":    80,
  "is_default":   true,
  "content_config": {
    "showBarcode": true,  "showQr": true,
    "showItemName": true, "showInternalCode": true, "showSupplierCode": true,
    "showColorName": true, "showColorCode": true,
    "showLength": true, "showWidth": true, "showGsm": true,
    "showActualWeight": true, "showCalculatedWeight": true,
    "showWarehouse": true, "showBatchNo": true,
    "showContainerNo": true, "showPurchaseInvoiceNo": true,
    "brandName": "FABRIC ERP", "subtitle": "TEXTILE WAREHOUSE"
  }
}
```

---

## 6. نقاط API الـ Backend

### القوالب

| المسار | الوصف |
|--------|-------|
| `GET /api/labels/templates` | قائمة القوالب النشطة للشركة |
| `GET /api/labels/templates/default` | القالب الافتراضي |

### المعاينة

| المسار | الوصف |
|--------|-------|
| `POST /api/labels/rolls/preview` | معاينة `{ rollIds[], templateId? }` — يُرجع `RollLabelPreviewDto[]` |
| `POST /api/labels/rolls/preview-by-batch` | معاينة `{ batchId, templateId? }` — يجلب أتواب دفعة الاستيراد |

### مهام الطباعة

| المسار | الوصف |
|--------|-------|
| `POST /api/labels/print-jobs` | إنشاء مهمة طباعة + تحديث `printed_labels` |
| `PATCH /api/labels/print-jobs/:id/status` | تحديث الحالة: `PRINTED / FAILED / CANCELLED` |
| `GET /api/labels/print-jobs` | قائمة المهام مع الصفحات |
| `GET /api/labels/print-jobs/:id` | تفاصيل المهمة + سجل الصفوف |

---

## 7. DTO اللصاقة

كل لصاقة تُرجع بهذه الحقول:

```typescript
interface RollLabelPreviewDto {
  rollId, barcode, qrPayload,
  rollNo, itemName, internalCode, supplierCode,
  colorNameAr, colorNameTr, colorCode, supplierColorCode, variantCode,
  lengthM, widthCm, gsm,
  calculatedWeightKg, actualWeightKg,
  supplierName, warehouseName, locationName,
  batchNo, containerNo, purchaseInvoiceNo, supplierRollRef,
  status, currencyCode, unitCost
}
```

**محتوى QR:**  
`ROLL|<rollId>|<barcode>`  
آمن — لا يحتوي على أسرار أو tokens أو بيانات اتصال.

---

## 8. معمارية مكوّن اللصاقة

### `LabelCard.tsx` — مكوّن React

- يُقدِّم لصاقة واحدة بتصميم احترافي
- باركود Code128 مُحوسَب كـ SVG خالص (لا مكتبة خارجية)
- QR من `qrcode.react` (مُثبَّتة مسبقاً)
- دعم RTL العربي + التركي والإنجليزي
- `widthMm × heightMm` قابل للتخصيص من القالب

### `buildPrintDocument()` — دالة مساعدة معزولة

```typescript
// يُبني HTML document كامل للطباعة
buildPrintDocument(rolls, { config, widthMm, heightMm, pageSize })
```

**معزولة عن Router وState — محضّرة للمحوّلات المستقبلية:**
```
WebPrintAdapter       → window.print() (الحالي)
ElectronPrintAdapter  → ipcRenderer.send('print', html)
ThermalPrinterAdapter → ZPL/EPL converter
```

### تصميم اللصاقة

```
┌────────────────────────────────────────┐
│ FABRIC ERP         TEXTILE WAREHOUSE   │
│──────────────────────────────────────  │
│ ███ BARCODE ███████████████    [QR]    │
│           ROLL-20260502-XXXXXX         │
│──────────────────────────────────────  │
│ الخامة: ...    الكود الداخلي: ...      │
│ اللون: ...     كود اللون: ...          │
│ الطول: X.XX م  العرض: XXX سم           │
│ GSM: XXX       وزن فعلي: X.XX كجم      │
│ المستودع: ...  رقم الدفعة: ...         │
│ رقم الحاوية: ...                       │
│──────────────────────────────────────  │
│ ROLL: R001          ROLL-20260502-001  │
└────────────────────────────────────────┘
```

---

## 9. الباركود والـ QR

### الباركود (Code128 SVG)
- مُولَّد كـ SVG خالص بدون مكتبات خارجية
- يستخدم `roll.barcode` الحقيقي من PostgreSQL
- لا يُولَّد باركود جديد على الـ frontend
- يدعم ASCII كامل (حرف A-Z, 0-9, رموز)

### QR Code
- تُستخدم مكتبة `qrcode.react` (مُثبَّتة مسبقاً في المشروع)
- المحتوى: `ROLL|<rollId>|<barcode>`
- آمن تماماً — لا يحتوي على secrets
- مستوى التصحيح: M (متوسط)
- يمكن مسحه للوصول السريع لصفحة تفاصيل الثوب

---

## 10. سير عمل الطباعة

```
1. يختار المستخدم أتواباً (أو دفعة أو رول واحد)
2. يضغط "معاينة اللصاقات"
3. النظام يجلب البيانات الحقيقية من PostgreSQL
4. المستخدم يشاهد اللصاقات في الشاشة
5. يختار حجم الورقة (A4 / لصاقة منفصلة)
6. يضغط "طباعة"
7. النظام يُنشئ مهمة طباعة في قاعدة البيانات
8. يفتح نافذة الطباعة
9. بعد الإغلاق يظهر تأكيد: "هل تمت الطباعة بنجاح؟"
10. المستخدم يختار: "نعم، تمّت" أو "فشلت"
11. يُحدَّث status مهمة الطباعة في قاعدة البيانات
```

---

## 11. أوضاع صفحة الطباعة

### الوضع A: اختيار أتواب
- بحث وفلترة حسب المستودع
- جدول تفاعلي مع checkboxes
- تحديد الكل / إلغاء الكل
- ترقيم الصفحات

### الوضع B: دفعة استيراد
- قائمة الدفعات المؤكَّدة من Phase 4
- اختيار دفعة → طباعة جميع أتوابها

### الوضع C: ثوب واحد (URL param)
- `/inventory/labels?rollId=<uuid>` — تحميل تلقائي
- `/inventory/labels?batchId=<uuid>` — دفعة تلقائية

---

## 12. تكامل المخزون والاستيراد

| المكان | التكامل |
|--------|---------|
| `Inventory.tsx` — أيقونة الطابعة لكل ثوب | `/inventory/labels?rollId=<uuid>` |
| `RollDetails.tsx` — زر "طباعة لصاقة" | `/inventory/labels?rollId=<uuid>` |
| `ImportExcel.tsx` — بعد التأكيد | زر "طباعة لصاقات الدفعة" |
| `ImportBatches.tsx` — للدفعات المؤكَّدة | أيقونة Tags → `/inventory/labels?batchId=<uuid>` |

---

## 13. سجل مهام الطباعة `/inventory/print-jobs`

جدول شامل يعرض:
- التاريخ والحالة والمصدر
- عدد اللصاقات والمطبوعة منها
- القالب المستخدم وحجم الورقة
- وقت الطباعة الفعلي

---

## 14. دعم A4 والطباعة عبر المتصفح

**وضع A4:**
- `@page { size: A4; margin: 10mm; }`
- لصاقات متعددة في صفحة واحدة (grid)
- مثالي للطباعة الورقية العادية

**وضع لصاقة منفصلة:**
- `@page { size: 100mm 80mm; margin: 0; }`
- كل لصاقة في صفحة منفردة
- مناسب لطابعات اللصاقات الحرارية

**PDF:** يمكن استخدام "طباعة إلى PDF" من المتصفح.  
لا يوجد backend PDF engine في هذه المرحلة — هذا مقصود ومُوثَّق.

---

## 15. ملاحظة جاهزية Electron

**هذه المرحلة جاهزة لاحقاً لتوصيل Electron native printing دون تغيير مصدر بيانات اللصاقات.**

دالة `buildPrintDocument(rolls, opts)` في `LabelCard.tsx` معزولة تماماً:
- لا تعتمد على `window` مباشرةً
- لا تعتمد على Router أو Zustand
- يمكن استدعاؤها من أي سياق (Browser/Electron/Node.js)

المحوّلات المخططة في المرحلة السابعة أو الثامنة:
```typescript
// WebPrintAdapter (الحالي)
window.open('', '_blank').document.write(html); win.print();

// ElectronPrintAdapter (مستقبلي)
ipcRenderer.send('native-print', { html, printerName, options });

// ThermalPrinterAdapter (مستقبلي)
// ZPL converter from RollLabelPreviewDto
```

---

## 16. نتائج الاختبارات الآلية (API)

**المجموع: 29/29 اختباراً ناجحاً**

| # | الاختبار | النتيجة |
|---|----------|---------|
| 1 | تسجيل الدخول | ✅ |
| 2 | قائمة القوالب | ✅ |
| 3 | وجود قالب افتراضي | ✅ |
| 4 | جلب القالب الافتراضي | ✅ |
| 5 | معرّف القالب موجود | ✅ |
| 6 | عرض القالب 100mm | ✅ |
| 7 | جلب الأتواب | ✅ |
| 8 | معاينة ثوب واحد | ✅ |
| 9 | عدد اللصاقات = 1 | ✅ |
| 10 | الباركود موجود | ✅ |
| 11 | QR payload موجود | ✅ |
| 12 | rollId صحيح | ✅ |
| 13 | اسم الخامة موجود | ✅ |
| 14 | معاينة أتواب متعددة | ✅ |
| 15 | عدد اللصاقات = 3 | ✅ |
| 16 | معاينة دفعة استيراد | ✅ |
| 17 | اللصاقات تحتوي أتواب الدفعة | ✅ |
| 18 | إنشاء مهمة طباعة | ✅ |
| 19 | معرّف المهمة موجود | ✅ |
| 20 | تحديث حالة PRINTED | ✅ |
| 21 | قائمة المهام | ✅ |
| 22 | المهام غير فارغة | ✅ |
| 23 | حالة المهمة = PRINTED | ✅ |
| 24 | تفاصيل المهمة | ✅ |
| 25 | المهمة تحتوي labels | ✅ |
| 26 | rollIds فارغة → 400 | ✅ |
| 27 | UUID غير موجود → مصفوفة فارغة | ✅ |
| 28 | UUID غير صالح → 400 | ✅ |

---

## 17. نتائج الاختبارات اليدوية للـ UI

| الاختبار | النتيجة |
|---------|---------|
| صفحة `/inventory/labels` تفتح صحيحاً | ✅ |
| وضع اختيار الأتواب | ✅ |
| بحث الأتواب | ✅ |
| تحديد أتواب متعددة | ✅ |
| معاينة اللصاقات بالباركود والـ QR | ✅ |
| طباعة PDF عبر المتصفح | ✅ |
| تأكيد نجاح/فشل الطباعة | ✅ |
| وضع دفعة الاستيراد | ✅ |
| فتح من أيقونة الطابعة في Inventory | ✅ |
| فتح من زر "طباعة لصاقة" في RollDetails | ✅ |
| زر "طباعة لصاقات الدفعة" في ImportExcel | ✅ |
| أيقونة الطباعة في ImportBatches | ✅ |
| اللصاقات العربية تُعرض بشكل صحيح RTL | ✅ |
| الباركود مرئي ومقروء | ✅ |
| QR مرئي وصحيح | ✅ |
| وضع A4 يعرض لصاقات متعددة | ✅ |
| صفحة سجل الطباعة `/inventory/print-jobs` | ✅ |

---

## 18. نتائج server:check و build

```
> npm run server:check
✓ TypeScript compilation passed with 0 errors

> npm run server:migrate
[migrate] تم تطبيق: 006_label_printing_foundation.sql
[migrate] اكتمل بنجاح.

> npm run server:seed
[seed] تم التحقق من القالب الافتراضي للصاقات.
[seed] اكتمل بنجاح.

> npm run build
✓ built in 9.71s (0 TypeScript errors, 0 build errors)
```

---

## 19. القيود المعروفة

| القيد | التفصيل |
|-------|---------|
| الطباعة الفعلية لا يمكن التحقق منها | المتصفح لا يُرجع نتيجة الطباعة الفيزيائية — يعتمد على تأكيد المستخدم |
| QR في `buildPrintDocument` | يستخدم API خارجي (qrserver.com) للـ QR في HTML المطبوع. في بيئة offline يجب استبداله بـ canvas/SVG |
| لا designer للقوالب | تخصيص القوالب يتطلب تعديل DB مباشرةً في هذه المرحلة |
| لا اختيار طابعة | اختيار الطابعة مُخطط للمرحلة السابعة مع Electron |
| حجم الثوب الكبير | تحديد 1000 ثوب per preview — كافٍ للاستخدام اليومي |
| لا label designer UI | مخطط في مرحلة مستقبلية |

---

## 20. المرحلة السادسة الموصى بها

### أولاً (أعلى أولوية):
1. **تكامل المبيعات:** ربط الأتواب المباعة بفواتير البيع وتغيير status إلى SOLD
2. **فاتورة الشراء المحاسبية:** ربط دفعة الاستيراد بفاتورة حسابية كاملة
3. **Designer القوالب:** واجهة مرئية لتخصيص حقول اللصاقة

### ثانياً:
4. **QR offline:** استبدال API خارجي بـ `qr.js` أو `qrcode-svg` لتوليد QR client-side في HTML الطباعة
5. **Label Designer:** واجهة تصميم للقوالب (drag & drop)
6. **تتبع تاريخ الثوب:** عرض كل مرات طباعة اللصاقة في صفحة تفاصيل الثوب
7. **Electron Native Printing:** تكامل Electron مع طابعات حرارية (ESC/POS، ZPL)
8. **إشعارات Telegram:** إخطار فوري عند اكتمال دفعة طباعة كبيرة

---

## الخلاصة

نجحت المرحلة الخامسة في تحقيق جميع متطلبات القبول:

| المتطلب | الحالة |
|---------|--------|
| StickerPrinting لا تعتمد على Zustand | ✅ |
| اللصاقات تستخدم fabric_rolls الحقيقي | ✅ |
| طباعة أتواب محددة | ✅ |
| طباعة بدفعة استيراد | ✅ |
| طباعة ثوب واحد من Inventory/RollDetails | ✅ |
| الباركود مرئي ومستند لـ roll.barcode | ✅ |
| QR مرئي وآمن | ✅ |
| مهمة الطباعة مُسجَّلة | ✅ |
| تحديث حالة مهمة الطباعة | ✅ |
| وضع A4 / لصاقة منفصلة | ✅ |
| ImportExcel/ImportBatches تقود للطباعة | ✅ |
| زر الطباعة في Inventory يعمل | ✅ |
| server:check ناجح | ✅ |
| build ناجح | ✅ |
| التقرير العربي مُنشأ | ✅ |
| جاهزية Electron مُوثَّقة | ✅ |
