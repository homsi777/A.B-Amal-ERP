# تقرير التدقيق النهائي V4 — Return Invoices

**النطاق:** مراجعة بعد V3، إصلاحات صغيرة فقط — بدون ميزات كبيرة، بدون CASH_REFUND، بدون حذف مسودة.

---

## 1) هل يوجد كسر أو خطأ؟

| الملاحظة | الإجراء في V4 |
|-----------|----------------|
| إمكانية **NO_FINANCIAL_EFFECT** مع **توب وكمية** فيؤثر على المخزون دون قيد GL | **ممنوع في الخادم:** رفض صريح إذا وُجد `fabric_roll_id` وكمية &gt; 0 مع هذا النوع. |
| **مرتجع مبيعات + مورد** أو **مرتجع مشتريات + عميل** في JSON | **مرفوض في POST/PUT** وفي **validateAndBuildReturnDraft**. |
| **posted_at** يُملأ قبل نجاح المخزون/GL | **تم التحقق:** ترتيب التأكيد الحالي هو: مخزون → GL → تحديث حالة الإرجاع على الفاتورة الأصلية → **ثم** `UPDATE status='CONFIRMED', posted_at=now()` → سجل النشاط → `COMMIT`. |
| عكس المخزون **مرتين** (ندرة) | **حماية:** إن وُجدت حركة `RETURN_INVOICE_REVERSAL` لنفس `reference_id` يُرجع `reverseReturnInvoiceInventory` فوراً دون تكرار. |
| كشف العميل/المورد يعرض مرتجع **بدون أثر مالي** بمبلغ صفر | **تصفية:** استبعاد `settlement_type = 'NO_FINANCIAL_EFFECT'` من استعلامي المرتجعات في `partyStatementService`. |
| تعارض اسم سبب الإلغاء | **الجسم:** يقبل `cancellationReason` أو `cancellation_reason` (Zod transform → قيمة واحدة للـ SQL). الواجهة ترسل `cancellationReason`. |
| دالة غير مستخدمة | حذف `computeLineTotal` من `returnInvoiceRoutes.ts`. |

**ترتيب المسارات:** `eligible-sales-invoices`، `eligible-purchase-invoices`، `source-invoice/...` مسجّلة **قبل** `GET /:id` — لا تعارض مع UUID نصّي عادي؛ مسارات ثابتة لا تُلتقط كـ `:id`.

---

## 2) Migration 029 — هل آمنة؟

- **إضافية فقط** (`ADD COLUMN IF NOT EXISTS`، فهارس، CHECK بعد DROP IF EXISTS للقيود بنفس الاسم).
- **القيم الافتراضية:** `settlement_type NOT NULL DEFAULT 'CREDIT_BALANCE'` — البيانات القديمة تبقى صالحة.
- **FK** إلى `sales_invoices` / `purchase_invoices` وأسطرها — أسماء الجداول متوافقة مع المشروع (`016_sales_purchase_invoices.sql`).
- **CHECK** يمنع الجمع بين أصل بيع وشراء؛ ويمنع `original_purchase_invoice_id` مع `SALES_RETURN` والعكس.
- **لا تعديل** على هجرات سابقة داخل الملفات القديمة.

---

## 3) Confirm / Cancel — هل آمنان؟

- **Confirm:** معاملة واحدة (`BEGIN`…`COMMIT`)، نفس `client` لـ validate، مخزون، GL، تحديث حالة الإرجاع على الفاتورة، ثم تحديث الحالة + `posted_at`. فشل أي خطوة → `ROLLBACK`. حالة **DRAFT** فقط؛ الصف **FOR UPDATE**.
- **Cancel:** **CONFIRMED** فقط، **FOR UPDATE**، رفض **CANCELLED** مسبقاً، عكس مخزون ثم GL بنفس `client`، ثم `cancelled_at` + `cancellation_reason`، ثم تحديث `return_fulfillment_status` للفاتورة الأصلية.

---

## 4) NO_FINANCIAL_EFFECT — السياسة النهائية (V4)

1. **الخادم:** يجب أن يكون **إجمالي المرتجع = 0** (كما في V3)، **ومنع أي سطر فيه توب (`fabric_roll_id`) وكمية &gt; 0** حتى لا يحدث فصل بين حركة المخزون وغياب قيد GL.
2. **الواجهة:** خيار «بدون أثر مالي» **مخفٍ** من قائمة التسوية؛ يبقى الدعم في الـ API للحالات الخاصة إن لزم، مع القيود أعلاه.
3. **كشف الحساب:** مرتجعات `NO_FINANCIAL_EFFECT` لا تُدرج في صفوف المرتجعات (لا ضوضاء بمبلغ صفر ولا خلط مع منطق الذمة).

---

## 5) GL و Inventory (ملخص مراجعة)

- **GL:** منع التكرار لـ `RETURN_INVOICE`؛ عكس القيد عبر `RETURN_INVOICE_REVERSAL` مع منع التكرار (منطق موجود في `reverseJournalBySource`). `NO_FINANCIAL_EFFECT` لا يُنشئ قيداً (`postReturnInvoiceToGl` يخرج مبكراً).
- **COGS:** يبقى مشروطاً بتكلفة الوحدة على التوب كما في V3.
- **PURCHASE_RETURN:** قيد AP / Purchase Returns كما هو — **لم يُغيّر**؛ أي تحسين محاسبي لاحق يحتاج قرار سياسة منفصل.
- **المخزون:** منطق SALES_RETURN (زيادة) / PURCHASE_RETURN (نقص) مع حماية من سالب الطول؛ الحركات تحمل `RETURN_INVOICE` / `RETURN_INVOICE_REVERSAL`.

---

## 6) الواجهة و API

- لا اختيار فعّال لـ CASH_REFUND أو MIXED.
- التسوية الظاهرة: **تخفيض ذمة فقط** + تنبيه نصّي بخصوص «بدون أثر مالي» والـ API.
- الإلغاء يرسل `cancellationReason` متوافقاً مع الخادم (مع دعم `cancellation_reason` كبديل).

---

## 7) الاختبارات

- `server/src/services/returnInvoiceQtyHelpers.test.ts`: كميات + `noFinancialEffectConflictsWithPhysicalLines`.
- اختبارات DB شاملة (CONFIRMED فقط، استثناء PUT، إلخ) **غير مضافة** في `npm test` الحالي — يُنصح باختبار يدوي/UAT قبل الزبون.

---

## 8) أوامر التشغيل

```bash
npm run server:check    # نجح
npx tsx server/src/services/returnInvoiceQtyHelpers.test.ts   # نجح
npm run lint          # يفشل بسبب InvoiceForm.tsx فقط (غير مرتبط بالمرتجعات)
```

---

## 9) هل القسم جاهز للمرتجعات المرتبطة بالفواتير؟

**نعم** للمسار المرتبط + CREDIT_BALANCE، بعد تطبيق الهجرة 029 واختبار UAT للمخزون والقيود في بيئتكم.

---

## 10) المؤجّل عمداً

- CASH_REFUND / MIXED.
- حذف مسودة.
- طباعة من الواجهة.
- «بدون أثر مالي» من الواجهة (API محدود كما فوق).

---

## 11) خطوات قبل تسليم الزبون

1. تشغيل `npm run server:migrate` على بيئة الإنتاج/العميل.
2. سيناريوهات: مرتجع بيع مرتبط جزئي/كامل، تأكيد، إلغاء، التحقق من المخزون وكشف الحساب وGL.
3. مراجعة محاسبية لمردود المشتريات إن كانت سياسة الشركة تختلف عن القيد الحالي.

---

## الملفات التي طُعِمت في V4

- `server/src/services/returnInvoiceDraftValidation.ts`
- `server/src/routes/returnInvoiceRoutes.ts`
- `server/src/services/returnInvoiceStockService.ts`
- `server/src/services/partyStatementService.ts`
- `src/pages/ReturnInvoices.tsx`
- `server/src/services/returnInvoiceQtyHelpers.test.ts`
- `RETURN_INVOICES_V4_AUDIT.md` (هذا الملف)

**ملاحظة:** `029_return_invoices_source_linking.sql` و`RETURN_INVOICES_V3_REPORT.md` لم تُعدّل محتواهما؛ التوصيات أعلاه تكمّل V3.
