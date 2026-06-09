# تقرير تشخيصي: مسودات فواتير البيع/الشراء ومسار التعديل  
**INVOICE_DRAFT_AND_EDIT_FLOW_REPORT.md**

**نطاق التقرير:** فحص الكود الحالي فقط (واجهة + خادم + migrations مرجعية). لم يُنفَّذ أي تعديل على منطق التطبيق أو قاعدة البيانات أثناء إعداد هذا الملف.

**تاريخ المرجعية:** بناءً على المستودع الحالي في المسار `نظام-إدارة-مستودعات-الأقمشة-(erp)`.

---

## 1) صفحات الواجهة والمسارات (Routes)

### أين شاشة إنشاء فاتورة بيع؟
- المكوّن: `src/pages/invoices/InvoiceForm.tsx` (المصدور كـ `InvoiceForm`).
- المسار: في `src/App.tsx` مسجل كـ  
  `Route path="invoices/sales/new" element={<InvoiceForm />}`.

### أين شاشة إنشاء فاتورة شراء؟
- نفس المكوّن: `src/pages/invoices/InvoiceForm.tsx`.
- المسار: `Route path="invoices/purchases/new" element={<InvoiceForm />}` في `src/App.tsx`.

### هل `InvoiceForm.tsx` يُستخدم للنوعين؟
- **نعم.** يفرّق داخلياً عبر المسار (مثلاً `useLocation().pathname` أو ما يعادله) بين بيع وشراء (`isSales` في الكود)، لكنهما نفس المكوّن.

### قوائم الفواتير وتفاصيل/كشف
| الغرض | الملف | المسار |
|--------|--------|--------|
| قائمة مبيعات | `src/pages/Sales.tsx` | `/invoices/sales` |
| قائمة مشتريات | `src/pages/Purchases.tsx` | `/invoices/purchases` |
| كشف/عرض فاتورة (قراءة من API) | `src/pages/invoices/InvoiceStatement.tsx` | `/invoices/statement` و `/invoices/statement/:id` |

### هل يوجد مسار تعديل مثل `/invoices/:id/edit`؟
- **لا يوجد** في `src/App.tsx` أي `Route` يطابق نمط تعديل فاتورة بيع/شراء بالمعرّف (لا `/invoices/sales/:id/edit` ولا مشابه).

### أزرار التعديل في القائمة أو التفاصيل؟
- **`Sales.tsx`:** عمود «الإجراءات» يحتوي رابطاً واحداً «كشف الفاتورة» → `/invoices/statement/${invoice.id}`. **لا يوجد** زر «تعديل» أو «متابعة مسودة» أو «تأكيد».
- **`Purchases.tsx`:** نفس النمط — «كشف الفاتورة» فقط.
- **`InvoiceStatement.tsx`:** لا يظهر من البحث النصي في الملف عن استدعاءات `confirmSalesInvoice` / `voidSalesInvoice` / `updateSalesInvoice` (طباعة/تصدير/عرض فقط من ناحية التدفق المفحوص).

### مكوّنات/خطافات مرتبطة بالحفظ
- `src/components/invoices/InvoiceSaveActionsModal.tsx`: يظهر بعد حفظ **فاتورة بيع** (طباعة A4 / PDF)، **وليس** مسار تعديل أو تأكيد من الخادم.

### عملاء API الواجهة
- `src/lib/api/salesInvoicesApi.ts`
- `src/lib/api/purchaseInvoicesApi.ts`
- تعيين صفوف القائمة: `src/lib/invoiceDbMappers.ts` (`mapSalesListRowToInvoice` / `mapPurchaseListRowToInvoice`)

---

## 2) حالة المسودة في قاعدة البيانات (أسماء جداول/حقول فعلية)

### الجداول (من `server/src/db/migrations/016_sales_purchase_invoices.sql` + توسعات لاحقة)
- **`sales_invoices`**
- **`sales_invoice_lines`**
- **`purchase_invoices`**
- **`purchase_invoice_lines`**

### حقل «حالة المستند» (ليس اسم عمود `status` بل `document_status`)
في `016_sales_purchase_invoices.sql`:
- العمود: **`document_status`** `text NOT NULL DEFAULT 'DRAFT'`
- القيد: `CHECK (document_status IN ('DRAFT', 'CONFIRMED', 'VOIDED'))`

**لا توجد** قيم مثل `POSTED` أو `CANCELLED` كاسم حقل لهذا العمود — الإلغاء النهائي للمستند المؤكَّد يُمثَّل بـ **`VOIDED`** مع **`voided_at`**.

### حالة الدفع (منفصلة عن المسودة)
- العمود: **`payment_status`** مع القيم **`unpaid` | `partial` | `paid`** (ليس `PAID` بأحرف كبيرة).

### تواريخ وأطراف
من `016_sales_purchase_invoices.sql` (للجدولين):
- **`confirmed_at`** (timestamptz)
- **`voided_at`** (timestamptz)
- **`created_by_user_id`**, **`updated_by_user_id`**
- **`created_at`**, **`updated_at`**

### أعمدة مالية/عملة إضافية (لاحقة على 016)
من `server/src/db/migrations/018_exchange_rates_multi_currency_usd_base.sql` (تُطبَّق على رؤوس الفواتير وسطورها حسب الملف):
- على الرؤوس: مثل **`exchange_rate_to_usd`**, **`subtotal_usd`**, **`discount_total_usd`**, **`tax_total_usd`**, **`total_amount_usd`**, **`paid_amount_usd`**, **`remaining_amount_usd`** (مع قيود منطقية في الـ migration).

### ملحق مرتجعات (029)
- `server/src/db/migrations/029_return_invoices_source_linking.sql` يضيف حقولاً على **`sales_invoices`** مثل **`return_fulfillment_status`** — خارج نطاق المسودة لكنه يؤثر على سياق المرتجعات.

### هل يُحفظ الإنشاء كنهائي مباشرة؟
- **في قاعدة البيانات:** الإدراج الابتدائي يضع **`document_status = 'DRAFT'`** دائماً في `createSalesInvoice` / `createPurchaseInvoice` (انظر القسم 3).
- **النهائية التشغيلية:** تتحول إلى **`CONFIRMED`** فقط عند تنفيذ **`confirm*Invoice`** (إما مدمجاً مع الإنشاء عند `confirm: true` أو عبر مسار API منفصل — انظر أدناه).

---

## 3) واجهات برمجة التطبيق (Backend) — ملخص مسارات Fastify

**التسجيل:** `server/src/app.ts`  
- بادئة المبيعات: **`/api/sales-invoices`** ← `server/src/routes/salesInvoiceRoutes.ts`  
- بادئة المشتريات: **`/api/purchase-invoices`** ← `server/src/routes/purchaseInvoiceRoutes.ts`

**المنطق الأساسي:**  
- `server/src/services/salesInvoiceService.ts`  
- `server/src/services/purchaseInvoiceService.ts`  
**الترحيل المحاسبي:** `server/src/services/glPostingService.ts` (`postSalesInvoiceToGl`, `postPurchaseInvoiceToGl`, …)

### جدول APIs (بيع)

| Method | Path | الملف | ماذا يفعل | معاملة DB | مخزون | GL | ذمم (ملاحظة) | تعديل لاحق |
|--------|------|--------|-----------|-----------|--------|-----|----------------|------------|
| GET | `/api/sales-invoices` | `salesInvoiceRoutes.ts` | قائمة (`listSalesInvoices`) | لا | لا | لا | لا | لا |
| GET | `/api/sales-invoices/:id` | نفس الملف | تفاصيل | لا | لا | لا | لا | لا |
| POST | `/api/sales-invoices` | نفس الملف | `createSalesInvoice` | **نعم** (BEGIN/COMMIT في المسار) | فقط إذا `confirm: true` داخل الخدمة | فقط عند التأكيد | عند التأكيد: قيد AR/إيراد (+ COGS اختياري) | عبر `PUT` للمسودة فقط |
| PUT | `/api/sales-invoices/:id` | نفس الملف | `updateSalesInvoiceDraft` | **نعم** | لا (مسودة) | لا | لا | **مسموح فقط إذا `document_status = 'DRAFT'`** |
| DELETE | `/api/sales-invoices/:id` | نفس الملف | `deleteSalesInvoiceDraft` | **نعم** | لا | لا | لا | **مسودة فقط** |
| POST | `/api/sales-invoices/:id/confirm` | نفس الملف | `confirmSalesInvoice` | **نعم** | **نعم** (`fabric_rolls` + `inventory_movements`) | **نعم** إذا `total_amount > 0` | قيد ذمم عملاء في GL + سند قبض إن وُجدت دفعة | **لا** بعد التأكيد (يُرفض التعديل) |
| POST | `/api/sales-invoices/:id/void` | نفس الملف | `voidSalesInvoice` | **نعم** | **عكس مخزون** عبر `metadata.inventory` + حركة `RETURN` | **عكس قيد** `reverseSalesInvoiceGl` | — | **للمؤكدة فقط** (`CONFIRMED`) |

### جدول APIs (شراء)
نفس الأنماط في `purchaseInvoiceRoutes.ts` مع `createPurchaseInvoice`, `updatePurchaseInvoiceDraft`, `deletePurchaseInvoiceDraft`, `confirmPurchaseInvoice`, `voidPurchaseInvoice`.

**عند التأكيد (`confirmPurchaseInvoice` في `purchaseInvoiceService.ts`):**
- إنشاء/ربط **`fabric_rolls`** عند غياب `fabric_roll_id`، وتسجيل **`inventory_movements`** من نوع استلام مرتبط بـ **`PURCHASE_INVOICE`** (ما لم يُستخدم `skipStockMovement`).
- **`postPurchaseInvoiceToGl`**: مدين المخزون / دائن ذمة المورد (**AP**) على مستوى القيود.
- دفعات للمورد: سند **`PAYMENT`** عبر `voucherCashboxService` عند `paid_amount > 0` ووجود `cashboxId`.

### ملاحظة على «الذمم»
- لا يُشترط من فحص migrations السريع وجود عمود `balance` على `customers`/`suppliers` لعكس الذمة؛ التأثير المحاسبي يمر عبر **`journal_entries`** مع **`partyType` / `partyId`** على بنود GL (انظر `glPostingService.ts`).

---

## 4) عميل API في الواجهة (Frontend)

**الملفات:** `src/lib/api/salesInvoicesApi.ts`, `src/lib/api/purchaseInvoicesApi.ts`.

### الدوال الموجودة (بيع)
- `listSalesInvoices`
- `getSalesInvoice`
- `createSalesInvoice` → **POST** `/api/sales-invoices`
- `updateSalesInvoice` → **PUT** `/api/sales-invoices/:id`
- `deleteSalesInvoice` → **DELETE** `/api/sales-invoices/:id`
- `confirmSalesInvoice` → **POST** `/api/sales-invoices/:id/confirm`
- `voidSalesInvoice` → **POST** `/api/sales-invoices/:id/void`

### الدوال الموجودة (شراء)
- `listPurchaseInvoices`, `getPurchaseInvoice`, `createPurchaseInvoice`, `updatePurchaseInvoice`, `deletePurchaseInvoice`, `confirmPurchaseInvoice`, `voidPurchaseInvoice` — نفس الأنماط مع مسارات `/api/purchase-invoices/...`.

### ما لا يوجد كاسم دالة مستقل
- **لا يوجد** `saveDraft` منفصل — المسودة هي **`createSalesInvoice` / `createPurchaseInvoice`** مع **`confirm: false`** (انظر القسم 5).
- **لا يوجد** `getInvoiceById` موحّد — يوجد `getSalesInvoice` و `getPurchaseInvoice`.

### مقارنة Backend ↔ استدعاء الواجهة
- **الخادم يوفّر:** إنشاء، تعديل مسودة، حذف مسودة، تأكيد، إلغاء (void).
- **`InvoiceForm.tsx` يستدعي فقط:** `createSalesInvoice` / `createPurchaseInvoice` (مع حقل **`confirm`** مشتق من زر الحفظ).
- **بحث الاستخدام:** استدعاءات `updateSalesInvoice` / `confirmSalesInvoice` / `voidSalesInvoice` (ومشترياتها) **لا تظهر** خارج ملفات `*InvoicesApi.ts` في مجلد `src` — أي **لا واجهة حالية** تستخدم تعديل/تأكيد/إلغاء عبر هذه الدوال.

---

## 5) سلوك الحفظ في `InvoiceForm.tsx`

### الأزرار (من البحث في الملف)
- `handleSave('draft')` — زر بصيغة amber (مسودة).
- `handleSave('final')` — زر indigo (نهائي/ترحيل ضمني عبر `confirm`).

### ماذا يُرسل للخادم؟
- **`confirm: status === 'final'`** عند استدعاء `postSalesInvoice` / `postPurchaseInvoice`.
- إذن:
  - **مسودة واجهة** = **`confirm: false`** → سجل في DB كـ **`DRAFT`** بدون تشغيل `confirm*Invoice`.
  - **حفظ نهائي من النموذج** = **`confirm: true`** → بعد الإدراج يُستدعى **`confirmSalesInvoice` / `confirmPurchaseInvoice`** داخل نفس معاملة الإنشاء في الخدمة.

### هل يوجد autosave أو localStorage؟
- من نتائج `grep` على `InvoiceForm.tsx`: **لا** تطابق لـ `localStorage` في سياق المسودة/الحفظ المفحوص.
- **لا يوجد** autosave واضح في الملف ضمن الأنماط المبحوثة.

### ضياع البيانات عند مغادرة الصفحة
- طالما لم يُضغط «حفظ مسودة» أو «حفظ نهائي»، البيانات تبقى في **حالة React محلية** فقط → **تضيع** عند إغلاق/تحديث الصفحة.

### هل يمكن العودة لمتابعة مسودة؟
- **لا يوجد** route لفتح `InvoiceForm` بمعرّف فاتورة موجودة.
- **لا يوجد** في القوائم زر يوجّه إلى `/invoices/.../edit/:id`.
- **عملياً:** بعد حفظ مسودة، المتابعة تتطلب بناء شاشة جديدة تستدعي **`PUT`** أو فتح النموذج محمّلاً بـ **`GET`** — غير موجودة حالياً في المسارات المذكورة.

### فاتورة البيع بعد الحفظ
- يُضبط `savedSaleInvoice` ويُعرض **`InvoiceSaveActionsModal`** (طباعة/تصدير)، ثم **`return`** يمنع الانتقال التلقائي لقائمة المبيعات في نهاية الدالة — المستخدم يغلق النافذة فينتقل إلى `/invoices/sales` من `onClose` في المودال.

### فاتورة الشراء بعد الحفظ
- رسالة toast (مسودة vs نهائي)، ثم **`navigate('/invoices/purchases')`** — **بدون** مودال مثل البيع.

---

## 6) متى يتحرك المخزون والذمم والمحاسبة؟

### فاتورة بيع
- **عند الإنشاء بـ `confirm: false`:** إدراج **`sales_invoices` + sales_invoice_lines` فقط** — **لا** تحديث `fabric_rolls` ولا `inventory_movements` ولا `postSalesInvoiceToGl` في هذا المسار.
- **عند التأكيد** (`confirmSalesInvoice` في `salesInvoiceService.ts`):
  - خصم أطوال/تغيير حالة الثوب، وإدراج **`inventory_movements`** (بيع كامل أو جزئي).
  - **`postSalesInvoiceToGl`**: قيد **AR / إيراد** + **COGS/مخزون** عند توفر تكلفة وحدية للثوب.
  - دفعة عميل: **`insertDraftVoucher` + `applyVoucherConfirmation`** ثم ربط **`payment_voucher_id`** عند التأكيد.

### فاتورة شراء
- **مسودة:** إدراج **`purchase_invoices` + lines` فقط** — **لا** إنشاء أدوار مخزون في المسار الافتراضي للمسودة.
- **عند التأكيد:** إنشاء/تحديث **`fabric_rolls`**, **`inventory_movements`**, **`postPurchaseInvoiceToGl`** (مخزون/ذمة مورد), ومسار السندات عند وجود دفعة.

### فرق draft vs confirmed
- **واضح في الخادم:** المسودة لا تنفّذ منطق التأكيد؛ التأكيد يغيّر **`document_status`** إلى **`CONFIRMED`** ويضبط **`confirmed_at`**.

### قفل التعديل
- **`update*Draft`**: يرفض إذا **`document_status !== 'DRAFT'`** (رسالة من نوع «لا يمكن تعديل فاتورة مؤكدة أو ملغاة»).

### تعديل فاتورة أثرت على المخزون/GL
- **لا يوجد** في الخدمات المفحوصة مسار «تعديل مؤكَّد» يعكس تلقائياً ثم يعيد التطبيق.
- **التصحيح المدعوم للمؤكَّد:** **`void*Invoice`** يعكس المخزون (للمبيعات عبر لقطة `metadata.inventory`) ويعكس القيد (`reverse*Gl`).

### خطر التكرار
- **`postSalesInvoiceToGl` / `postPurchaseInvoiceToGl`**: يتحققان من وجود **`journal_entries`** بنفس **`source_type` + `source_id`** قبل الإدراج (**idempotency** عند إعادة المحاولة).
- **التأكيد:** يرفض إذا **`document_status !== 'DRAFT'`** — يقلل خطر تأكيد مزدوج لنفس الفاتورة.

### Audit trail
- **`created_by_user_id` / `updated_by_user_id`** على رأس الفاتورة.
- **لا يوجد** من فحص هذا التقرير جدولاً منفصلاً لسجل تغييرات كل حقل (إن وُدِع لاحقاً فهو خارج النطاق الحالي).

---

## 7) إمكانية التعديل (ملخص تنفيذي)

| السؤال | الجواب المبني على الكود |
|--------|-------------------------|
| تعديل بيع محفوظ؟ | **Backend:** نعم للمسودة فقط (`PUT`). **Frontend:** **لا يوجد** شاشة تستدعي `PUT`. |
| تعديل شراء محفوظ؟ | نفس النمط. |
| تعديل مؤكَّد مع عكس حركة قديمة؟ | **غير موجود** كـ update؛ الإلغاء **`void`** يعكس حسب التصميم الحالي. |
| خطر تكرار عند «تعديل وهمي» من الواجهة؟ | الواجهة لا تستدعي التعديل أصلاً؛ الخطر الحالي هو **غياب مسار مراجعة/تأكيد لاحق** للمسودات من UI. |

---

## 8) قائمة الفواتير وتجربة المستخدم

### عرض الحالة
- **`Sales.tsx` / `Purchases.tsx`:** عمود «الحالة» يعرض **`arInvoicePaymentStatusCode(invoice.status)`** حيث `invoice.status` مأخوذ من **`payment_status`** في المابّر، **وليس** من **`document_status`**.
- **`mapSalesListRowToInvoice` / `mapPurchaseListRowToInvoice`:** يضيفان **`documentStatus`** من الصف، لكن **الجدول لا يعرضه**.

### فلترة مسودات
- زر «تصفية» في القوائم **واجهة فقط** حالياً (لا يربط `documentStatus=DRAFT`).
- **API يدعم** `documentStatus` كـ query في `listSalesInvoices` / `listPurchaseInvoices` — لكن القوائم **لا ترسله**.

### أزرار ناقصة (من منظور المستخدم مقابل الخادم)
- **متابعة مسودة / تعديل / تأكيد لاحق / إلغاء / حذف مسودة من القائمة:** **غير موجودة** في `Sales.tsx` و `Purchases.tsx` و `InvoiceStatement.tsx` ضمن ما فُحص.

---

## 9) مخاطر مرتبطة بالكود الحالي

1. **فجوة UX/Backend:** قاعدة البيانات والـ API يدعمان **`DRAFT` + PUT + DELETE + POST confirm/void**، بينما **مسار الاستخدام اليومي** يقتصر على **إنشاء واحد** من `InvoiceForm` — فيُفهم خطأً أن «لا مسودة» لأن الواجهة **لا تعرض `document_status`** ولا توفّر **متابعة**.
2. **مسار «حفظ نهائي» من النموذج:** يؤكّد فوراً — **لا مرحلة مراجعة** على الخادم منفصلة عن واجهة أخرى.
3. **ضياع العمل:** بلا autosave ولا route للمسودة، أي انقطاع قبل الحفظ يعني فقدان الإدخال.
4. **تأكيد مدمج مع POST:** إذا فشل التأكيد بعد الإدراج، تعتمد الصلاحية على معاملة المسار في `salesInvoiceRoutes.ts` (**ROLLBACK**) — جيد، لكن من ناحية المنتج لا يزال المستخدم بلا شاشة «فشل التأكيد أعد المحاولة» مخصصة.
5. **الترجمة بين لغة المستخدم وقاعدة البيانات:** زر «مسودة» في الواجهة يطابق **`DRAFT`** في DB، لكن عمود «الحالة» في القائمة يظهر **دفعاً** لا **مسودة/مؤكدة** — يسبب التباساً.

---

## 10) معمارية مقترحة (للتنفيذ لاحقاً — بدون تنفيذ الآن)

- الإبقاء على **`document_status`: `DRAFT` | `CONFIRMED` | `VOIDED`** كفصل واضح.
- **الحفظ الأول الافتراضي:** مسودة (`DRAFT`) بدون مخزون/GL.
- **زران:** «حفظ مسودة» (PUT أو POST حسب التصميم) و«تأكيد/ترحيل» (POST `/confirm`) — مع إمكانية تأكيد لاحق من قائمة الفواتير.
- **التأثير المخزني/المحاسبي/الذمم:** عند **`CONFIRMED` فقط** (أو على الأقل خارج `DRAFT`).
- **التعديل:** مسموح للمسودات فقط؛ للمؤكَّد **void + إعادة إصدار** أو مستند تصحيحي (سياسة عمل).
- **حذف:** للمسودات فقط (موجود في الخادم).
- **Audit:** توسيع تدريجي (سجل أحداث أو نسخ JSON للرأس/الأسطر قبل التأكيد).
- **Autosave:** إما محلي (`localStorage`/`IndexedDB`) أو حفظ مسودة دوري عبر API — حسب متطلبات التزامن multi-device.

---

## 11) خطة تنفيذ مقترحة (مراحل)

1. **قاعدة البيانات:** مراجعة إن كانت الحقول الحالية كافية (غالباً كافية)؛ أي مؤشرات/قيود إضافية لحالات المرتجعات إن لزم.
2. **Backend:** إبقاء العقود الحالية؛ توثيق أخطاء واضحة؛ (اختياري) فصل «إنشاء بدون confirm» عن «confirm» في واجهات جديدة دون كسر العميل الحالي.
3. **Frontend API:** استخدام `documentStatus` في `list*`؛ إضافة دوال شِبه-أوامر (`saveDraft`, `confirmInvoice`) كغلاف اختياري للوضوح.
4. **UI — قائمة:** عرض **`document_status`** + فلترة + إجراءات: متابعة، تأكيد، حذف مسودة، إلغاء مؤكَّد (حسب الصلاحيات).
5. **UI — نموذج:** route مثل `/invoices/sales/:id/edit` يحمّل `GET` ويحفظ بـ `PUT` للمسودة؛ زر تأكيد يستدعي `POST .../confirm`.
6. **اختبارات:** وحدات لخدمات التأكيد؛ تكامل للـ E2E: إنشاء مسودة → تعديل → تأكيد → ظهور حركات/قيود.

**ملفات متوقعة للمس:** `InvoiceForm.tsx`, `Sales.tsx`, `Purchases.tsx`, `InvoiceStatement.tsx`, `App.tsx`, `salesInvoicesApi.ts`, `purchaseInvoicesApi.ts`, `invoiceDbMappers.ts` — دون تغيير migrations إلا عند حاجة حقيقية جديدة.

---

## 12) الخلاصة التنفيذية

| البند | الوضع الحالي |
|-------|---------------|
| مسودة حقيقية في DB؟ | **نعم** (`document_status = 'DRAFT'` عند `confirm: false`). |
| مسودة مفهومة في الواجهة؟ | **جزئياً** — زر موجود لكن القائمة لا تعرض حالة المستند ولا يوجد تعديل/متابعة. |
| تعديل حقيقي من UI؟ | **لا** (رغم وجود `PUT` في الخادم). |
| متى يتحرك المخزون؟ | **عند التأكيد** (`confirm*Invoice`)، ليس عند إنشاء المسودة. |
| متى تتأثر الذمم/GL؟ | **عند التأكيد** عبر `post*InvoiceToGl` والسندات عند الدفعات. |
| أمان المنطق للتأكيد/العكس؟ | **جيد نسبياً** (قفل مسودة/مؤكَّد، idempotency للقيود، void يعكس). |
| أمان تجربة المستخدم للمسودات؟ | **ضعيف** (لا متابعة، لا عرض حالة مستند، لا autosave). |

---

## ملحق: مراجع ملفات رئيسية

| الموضوع | المسار |
|---------|--------|
| Routes الواجهة | `src/App.tsx` |
| نموذج الفاتورة | `src/pages/invoices/InvoiceForm.tsx` |
| قائمة مبيعات | `src/pages/Sales.tsx` |
| قائمة مشتريات | `src/pages/Purchases.tsx` |
| كشف فاتورة | `src/pages/invoices/InvoiceStatement.tsx` |
| API بيع/شراء (واجهة) | `src/lib/api/salesInvoicesApi.ts`, `src/lib/api/purchaseInvoicesApi.ts` |
| مابّر القائمة/التفاصيل | `src/lib/invoiceDbMappers.ts` |
| Routes خادم | `server/src/routes/salesInvoiceRoutes.ts`, `server/src/routes/purchaseInvoiceRoutes.ts` |
| خدمات الفواتير | `server/src/services/salesInvoiceService.ts`, `server/src/services/purchaseInvoiceService.ts` |
| ترحيل GL | `server/src/services/glPostingService.ts` |
| مخطط الجداول الأساسي | `server/src/db/migrations/016_sales_purchase_invoices.sql` |
| عملات/USD على الفواتير | `server/src/db/migrations/018_exchange_rates_multi_currency_usd_base.sql` |

---

*نهاية التقرير.*
