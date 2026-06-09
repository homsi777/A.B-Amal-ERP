# تقرير تنفيذ TASK V3 — مرتجعات Return Invoices

## 1. الملفات المعدّلة أو المضافة

| الملف | الغرض |
|--------|--------|
| `server/src/db/migrations/029_return_invoices_source_linking.sql` | (موجود مسبقاً) أعمدة الربط، `settlement_type`، `return_fulfillment_status` على فواتير البيع/الشراء |
| `server/src/services/returnInvoiceDraftValidation.ts` | التحقق من المسودة، الكميات، التوب، `NO_FINANCIAL_EFFECT`، تحميل المسودة للتحقق عند التأكيد |
| `server/src/services/returnInvoiceEligibilityService.ts` | (موجود) قوائم الفواتير المؤهلة وتفاصيل المصدر |
| `server/src/services/returnInvoiceLifecycleService.ts` | (موجود) تحديث `return_fulfillment_status` |
| `server/src/services/returnInvoiceQtyHelpers.ts` | (موجود) تحويلات الأمتار والمتاح |
| `server/src/services/glPostingService.ts` | تخطي قيود GL عند `settlement_type = NO_FINANCIAL_EFFECT` |
| `server/src/routes/returnInvoiceRoutes.ts` | APIs جديدة، POST/PUT/PATCH معاملات وتدقيق، تفاصيل مع مرجع GL |
| `server/src/services/returnInvoiceQtyHelpers.test.ts` | اختبار وحدة بسيط للكميات |
| `src/lib/api/returnsApi.ts` | أنواع TypeScript وكل دوال الـ API |
| `src/pages/ReturnInvoices.tsx` | واجهة قوائم، فلاتر، إنشاء/تعديل مرتبط، تفاصيل، إلغاء مؤكد |

## 2. الهجرة (Migration)

- **الملف:** `server/src/db/migrations/029_return_invoices_source_linking.sql`
- **تشغيل الهجرات:** من جذر المشروع:
  - `npm run server:migrate`
- يجب تنفيذها على بيئة التشغيل قبل استخدام الحقول الجديدة.

## 3. APIs الجديدة أو المعدّلة

**جديدة (قبل مسار `/:id` لتجنب التعارض):**

- `GET /api/returns/eligible-sales-invoices` — بحث، `customerId`، تواريخ، ترقيم
- `GET /api/returns/eligible-purchase-invoices` — بحث، `supplierId`، تواريخ، ترقيم
- `GET /api/returns/source-invoice/:invType/:invId` — `invType` = `sales` | `purchase`، اختياري `?excludeReturnId=` للتعديل

**معدّلة:**

- `GET /api/returns` — أعمدة إضافية (ربط فاتورة، تسوية، تواريخ، أرقام فواتير أصلية عبر JOIN)
- `GET /api/returns/:id` — بنود مع حقول الربط + `gl_journal` إن وُجد قيد `RETURN_INVOICE`
- `POST /api/returns` — حقول الربط والتسوية والسبب، تحقق داخل معاملة
- `PUT /api/returns/:id` — مسودة فقط، نفس التحقق مع استثناء المرتجع الحالي من «المرتجع السابق»
- `PATCH /api/returns/:id/confirm` — قفل صف، إعادة تحقق من DB، مخزون، GL (حسب التسوية)، `posted_at`، تحديث `return_fulfillment_status`
- `PATCH /api/returns/:id/cancel` — **للمؤكد فقط** (`CONFIRMED`)، عكس مخزون + `RETURN_INVOICE_REVERSAL`، `cancelled_at`، `cancellation_reason`، JSON: `{ "cancellationReason": "..." }`

## 4. ربط المرتجع بالفاتورة الأصلية

- رأس المرتجع: `original_sales_invoice_id` أو `original_purchase_invoice_id` (لا معاً — CHECK في DB).
- البنود: `original_sales_invoice_line_id` أو `original_purchase_invoice_line_id` مع `returned_from_quantity` و`return_reason`.
- `original_invoice_no` يُملأ تلقائياً من رقم الفاتورة الأصلية عند الربط.

## 5. منع تجاوز الكمية

- على الخادم: `validateAndBuildReturnDraft` يقارن كمية المرتجع بالأمتار مع `available_meters` من `getSource*InvoiceForReturn` (مجموع مرتجعات **CONFIRMED** فقط من `return_invoice_lines` مرتبطة بنفس سطر الفاتورة).
- عند التعديل: `excludeReturnId` يستثني المسودة الحالية من الحساب.
- عند التأكيد: إعادة التحقق من البيانات المحفوظة عبر `loadReturnInvoiceAsDraftBody` ثم نفس الدالة.

## 6. المخزون

- دون تغيير جوهر `returnInvoiceStockService`: التأكيد يستدعي `applyReturnInvoiceInventory`؛ الإلغاء `reverseReturnInvoiceInventory`.
- مرتبط بفاتورة: إن وُجد `fabric_roll_id` على سطر المصدر يُفرض التطابق أو الاستنتاج؛ عند وجود توب على بنود بكمية يُطبّق `validateReturnStockLineCoverage`.

## 7. الذمم وكشف الطرف

- لم يُضف منطق جديد لتعديل أرصدة ذمم منفصلة؛ التأثير يمر عبر القيود المحاسبية الحالية (AR/AP) عند التأكيد كما كان، مع احترام `NO_FINANCIAL_EFFECT` (بدون قيد ذمم/مرتجع مبيعات في GL).

## 8. GL

- `postReturnInvoiceToGl`: يتخطى كلياً عند `NO_FINANCIAL_EFFECT` (لا قيد مرتجع ولا COGS عبر هذه الدالة).
- منع التكرار: فحص `journal_entries` بـ `source_type='RETURN_INVOICE'` (موجود مسبقاً).
- الإلغاء: `reverseReturnInvoiceGl` مع منع تكرار عكس القيد (موجود في `reverseJournalBySource`).

## 9. ما لم يُنفَّذ أو أُجِّل

- **CASH_REFUND / MIXED:** مرفوضان في التحقق من المسودة؛ لا إنشاء سند قبض/دفع تلقائي حتى تتضح بنية السندات والصندوق وربطها بالمرتجع بدون تكرار.
- **الطباعة:** زر placeholder في الواجهة فقط.
- **إلغاء مسودة:** مسار `PATCH .../cancel` يقبل **CONFIRMED فقط**؛ إلغاء مسودة عبر واجهة منفصلة لم يُضف (يمكن لاحقاً إضافة `DELETE` أو `PATCH` لحالة مسودة).

## 10. جاهزية الاستخدام

- **مناسب للاستخدام الداخلي التجريبي** بعد تطبيق الهجرة `029` والتحقق يدوياً من سيناريوهات شركتكم (عملات، توب، تأكيد/إلغاء).
- يُنصح بمراجعة محاسبية لمردود المشتريات وسياسة COGS عند `NO_FINANCIAL_EFFECT` مع حركة مخزون فعلية (فجوة محتملة بين المخزون وGL).

## 11. تشغيل الهجرات

```bash
npm run server:migrate
```

## 12. مخاطر متبقية

- مرتجع **غير مرتبط** يسمح به النظام مع تحقق مخزون أشد؛ خطأ إدخال التوب قد يؤثر على المخزون دون ربط فاتورة.
- `NO_FINANCIAL_EFFECT` + إرجاع فعلي بتكلفة على التوب: لا قيد GL من `postReturnInvoiceToGl` — قد تحتاجون قيداً يدوياً أو توسيعاً لاحقاً.
- الإلغاء للمؤكد فقط: المسودات «العالقة» تحتاج سياسة تشغيل (تأكيد أو حذف لاحق).

## الاختبارات

```bash
npx tsx server/src/services/returnInvoiceQtyHelpers.test.ts
```

اختبارات تكامل DB كاملة (سيناريوهات 1–10) لم تُضف آلياً لغياب إطار اختبار DB في `npm test` الحالي.
