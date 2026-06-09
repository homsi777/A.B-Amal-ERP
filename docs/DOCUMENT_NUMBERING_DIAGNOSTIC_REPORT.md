# تقرير تشخيصي — نظام ترقيم المستندات (قراءة كود فقط، بدون تنفيذ أو تعديل)

**النطاق:** فحص الشيفرة والـ migrations في المستودع الحالي فقط. لم يُنفَّذ أي تغيير على قاعدة البيانات أو على ملفات التطبيق.  
**التاريخ المرجعي للفحص:** 2026-05-13  

---

## 1) معمارية ترقيم المستندات

### هل يوجد نظام مركزي؟

- **لا يوجد جدول مركزي** مثل `document_sequences` أو `numbering_settings` في الـ migrations المفحوصة.
- يوجد **ملف مركزي للمنطق** فقط: `server/src/utils/documentNumbers.ts` يعرّف:
  - **`generateDocumentNo(prefix)`** — أرقام غير تسلسلية رقمية صِرفة: `prefix-{timestamp base36}-{6 hex}` (تعليق في الملف: «بدون تسلسل DB معقد (MVP)»).
  - **`generateSequentialDocumentNo(client, companyId, kind)`** — تسلسل رقمي ببادئة ثابتة في الكود + عرض أصفار، يعتمد على **استعلام `MAX` على جزء رقمي** من الحقل + **`pg_advisory_xact_lock`** لكل شركة ونوع (قفل معاملة).

### هل كل نوع مستند يولّد رقمه داخل خدمته؟

- **فواتير البيع والشراء:** التوليد داخل `createSalesInvoice` / `createPurchaseInvoice` في الخدمات، باستدعاء `generateSequentialDocumentNo` (انظر الأقسام 2 و 3).
- **سندات القبض/الدفع (مسار الخدمة):** `insertDraftVoucher` في `server/src/services/voucherCashboxService.ts` يستدعي `generateSequentialDocumentNo`.
- **إنشاء سند عبر المسار المباشر للـ API:** `server/src/routes/voucherRoutes.ts` يستدعي `generateSequentialDocumentNo` ثم `INSERT` (توليد مكرر منطقيًا لكنه نفس الدالة).
- **مرتجعات:** `server/src/routes/returnInvoiceRoutes.ts` يستخدم **`generateDocumentNo('RTN')`** وليس التسلسل الرقمي.
- **قيود اليومية (GL):** `insertBalancedJournal` وعكس القيد في `server/src/services/glPostingService.ts` يستخدمان **`generateDocumentNo('JE')`**.
- **حركات الصندوق:** `generateDocumentNo('MOV')` في `voucherCashboxService.ts` وغيره.
- **استيراد شراء Excel:** `purchaseImportRoutes.ts` — `invoiceNoFinal` من الدفعة أو `generateDocumentNo('PI')` (ليس `FS…` التسلسلي).
- **طلبات العملاء:** `customerOrderRoutes.ts` — `orderNumber` من الطلب أو `generateSequentialDocumentNo(..., 'CUSTOMER_ORDER')`.
- **قيود كشف حساب مستورد:** `customerRoutes.ts` — `generateSequentialDocumentNo(..., 'ACCOUNT_STATEMENT')` على `journal_entries.entry_no` (إعداد في `SEQUENTIAL_DOCUMENTS` بـ `prefix: ''`, `width: 10`).

### أسماء الملفات والدوال الأساسية

| الملف | الدوال / الأهمية |
|--------|-------------------|
| `server/src/utils/documentNumbers.ts` | `generateDocumentNo`, `generateSequentialDocumentNo`, جدول `SEQUENTIAL_DOCUMENTS` |
| `server/src/services/salesInvoiceService.ts` | `createSalesInvoice`, `updateSalesInvoiceDraft`, `deleteSalesInvoiceDraft`, … |
| `server/src/services/purchaseInvoiceService.ts` | `createPurchaseInvoice`, `updatePurchaseInvoiceDraft`, `deletePurchaseInvoiceDraft`, … |
| `server/src/routes/salesInvoiceRoutes.ts` | `POST /` → `createSalesInvoice` داخل `BEGIN`/`COMMIT` |
| `server/src/routes/purchaseInvoiceRoutes.ts` | (مسار مماثل لخدمة الشراء) |
| `server/src/services/voucherCashboxService.ts` | `insertDraftVoucher`, `applyVoucherConfirmation` — توليد `voucher_no` |
| `server/src/routes/voucherRoutes.ts` | `POST /` — توليد `voucher_no` + إدراج سند |
| `server/src/routes/returnInvoiceRoutes.ts` | `POST /` — `returnNo = generateDocumentNo('RTN')` |
| `server/src/services/glPostingService.ts` | `insertBalancedJournal`, `reverseJournalBySource` — `entry_no` عبر `generateDocumentNo('JE')` |
| `server/src/routes/purchaseImportRoutes.ts` | توليد أرقام فواتير شراء من الاستيراد |
| `server/src/routes/customerOrderRoutes.ts` | تسلسل `CUSTOMER_ORDER` |
| `server/src/routes/customerRoutes.ts` | تسلسل `ACCOUNT_STATEMENT` على `journal_entries` |
| `src/pages/invoices/InvoiceForm.tsx` | حالة واجهة `invoiceNumber` الافتراضية وعرض `invoice_no` |

### جدول مخصص للترقيم؟

- **لا** (حسب migrations المشار إليها في التقرير: لا يظهر جدول تسلسلات مستقل).

### بادئة / تسلسل منفصل لكل نوع؟

- **البادئات والعرض مُعرَّفة في الكود** داخل `SEQUENTIAL_DOCUMENTS` في `documentNumbers.ts`:
  - `SALES_INVOICE` → بادئة **`FB`**, عرض رقم **`7`**, جدول `sales_invoices`, عمود `invoice_no`.
  - `PURCHASE_INVOICE` → **`FS`**, عرض **`7`**, `purchase_invoices.invoice_no`.
  - `CUSTOMER_ORDER` → **`CO`**, عرض **`7`**, `customer_orders.order_no`.
  - `RECEIPT_VOUCHER` → **`SQ`**, عرض **`6`**, `vouchers.voucher_no` مع `voucher_type = 'RECEIPT'`.
  - `PAYMENT_VOUCHER` → **`SD`**, عرض **`6`**, `vouchers.voucher_no` مع `voucher_type = 'PAYMENT'`.
  - `ACCOUNT_STATEMENT` → بادئة **فارغة**, عرض **`10`**, `journal_entries.entry_no`, `lockKey: 'ACCOUNT_STATEMENT'`.

### تسلسل منفصل لكل شركة؟

- **نعم** في استعلام التسلسل: شرط `company_id = $1` في `generateSequentialDocumentNo`، وقفل `pg_advisory_xact_lock(hashtext(companyId), hashtext(lockKey ?? prefix))`.

### تسلسل منفصل حسب السنة أو الفرع أو المستودع؟

- **لا يظهر في الكود الحالي** ضمن `generateSequentialDocumentNo` (لا يوجد `year` أو `branch_id` في الاستعلام).

---

## 2) ترقيم فواتير البيع (`sales_invoices`)

### اسم حقل الرقم

- **`invoice_no`** (نوع `text NOT NULL`) — انظر `server/src/db/migrations/016_sales_purchase_invoices.sql`.

### أين يُولَّد؟

- **`server/src/services/salesInvoiceService.ts`** — دالة **`createSalesInvoice`**:
  - السطر المنطقي: `const invoiceNo = await generateSequentialDocumentNo(client, companyId, 'SALES_INVOICE');`
  - ثم تحقق تكرار: `SELECT id FROM sales_invoices WHERE company_id=$1 AND invoice_no=$2`
  - ثم `INSERT ... invoice_no ... 'DRAFT'`.

### هل الرقم من الواجهة أم من الخادم؟

- **الخادم يتجاهل قيمة التسلسل الفعلية المرسلة من العميل لغرض الإنشاء:** رغم أن `salesInvoiceCreateSchema` يتطلب `invoiceNo`، فإن **`createSalesInvoice` لا يستخدم `d.invoiceNo` لحقل `invoice_no` المحفوظ** — يُولَّد دائمًا عبر `generateSequentialDocumentNo`.
- **مسار استيراد كشف عميل (`customerRoutes.ts`):** يستدعي `createSalesInvoice` مع حقل `invoiceNo: smartInvoiceNo` (مثل `STMT-…`) في جسم الطلب، لكن **`createSalesInvoice` لا يُسند `d.invoiceNo` إلى `invoice_no` في الـ INSERT** — يُستخدم دائمًا ناتج `generateSequentialDocumentNo` فقط. أي أن **الرقم المخزّن في `sales_invoices.invoice_no` يبقى ضمن نمط `FB` التسلسلي** وليس نص `STMT-…` المرسل (قد يُستخدم في `notes` أو مراجع أخرى حسب نفس الملف).

### آلية التسلسل (MAX / COUNT / جدول)؟

- **`MAX`** على الجزء الرقمي بعد البادئة، مع **تعبير منتظم** يقيّد الصفوف المدخلة في الحساب:
  - للمبيعات: `invoice_no ~ '^FB[0-9]{7}$'`

### إعدادات شركة / بادئة قابلة للتخصيص من DB؟

- **لا** في جدول `companies` الأساسي (`001_core_foundation.sql`: حقول `code`, `name`, `base_currency_code`, … **بدون** حقول ترقيم).

### UNIQUE؟

- **`CONSTRAINT sales_invoices_company_invoice_no UNIQUE (company_id, invoice_no)`** — منع تكرار نفس النص لنفس الشركة.

### خطر التزامن؟

- **`pg_advisory_xact_lock`** قبل قراءة `MAX` — يقلل خطر race على نفس مفتاح القفل داخل المعاملة.

### المسودات DRAFT والرقم؟

- عند **`createSalesInvoice`** يُدرج الصف مباشرةً **`document_status = 'DRAFT'`** مع **`invoice_no` النهائي** المُولَّد (ليس «بدون رقم» ثم تعيين عند التأكيد).

### حذف المسودة؟

- **`deleteSalesInvoiceDraft`** (`salesInvoiceService.ts`): `DELETE FROM sales_invoices` للمسودة فقط.
- **أثر على التسلسل:** الصف يُحذف فيختفي `invoice_no` من الجدول؛ استدعاء لاحق لـ `MAX` قد **لا يعدّ** ذلك الرقم إن لم يبقَ صفوف مطابقة للنمط — **يمكن إعادة استخدام نفس الرقم التسلسلي لاحقًا** (فجوة محاسبية مقبولة أو غير مقبولة حسب السياسة؛ هذا سلوك منطقي من `MAX+1` وليس خطأ DB بالضرورة).

---

## 3) ترقيم فواتير الشراء (`purchase_invoices`)

### اسم الحقل

- **`invoice_no`** (`016_sales_purchase_invoices.sql`).

### أين يُولَّد؟

- **`server/src/services/purchaseInvoiceService.ts`** — **`createPurchaseInvoice`**:
  - `const invoiceNo = await generateSequentialDocumentNo(client, companyId, 'PURCHASE_INVOICE');`
  - تحقق تكرار ثم `INSERT` بحالة `DRAFT`.

### تسلسل مستقل عن البيع؟

- **نعم:** بادئة **`FS`** مقابل **`FB`** وجداول منفصلة في `SEQUENTIAL_DOCUMENTS`.

### نفس دالة البيع؟

- **نفس الدالة العامة** `generateSequentialDocumentNo` مع **`kind` مختلف** (`'PURCHASE_INVOICE'`).

### بادئة مختلفة؟

- **`FS`** + 7 أرقام في النمط `^FS[0-9]{7}$`.

### UNIQUE؟

- **`purchase_invoices_company_invoice_no UNIQUE (company_id, invoice_no)`**.

### تداخل أرقام البيع والشراء؟

- **مقصود أن يكونا مستقلين نصيًا** (`FB…` vs `FS…`)؛ لا يمنع تطابق الجزء الرقمي إن اختلفت البادئة (مثل `FB0000001` و`FS0000001`).

### مسار استيراد الشراء (`purchaseImportRoutes.ts`)

- **`invoiceNoFinal = cleanString(batch.invoice_no) || generateDocumentNo('PI')`** — مسار **مختلف** عن التسلسل `FS0000001`؛ قد يُدرج في `purchase_invoices.invoice_no` نص لا يطابق `^FS[0-9]{7}$` إذا وُجد في الدفعة أو من `PI-…`.

---

## 4) ترقيم فواتير المرتجعات (`return_invoices`)

### كيف يُولَّد `return_no`؟

- **`server/src/routes/returnInvoiceRoutes.ts`** (داخل `POST /`):
  - `const returnNo = generateDocumentNo('RTN');`
  - أي **ليس** التسلسل الرقمي `generateSequentialDocumentNo`.

### مرتجع بيع وشراء — نفس التسلسل؟

- **نفس دالة التوليد العشوائية/الوقتية** لكليهما؛ **لا** يوجد تمييز `SALES_RETURN` vs `PURCHASE_RETURN` في الرقم نفسه من الكود المقتبس (التمييز في `return_type`).

### UNIQUE؟

- **`return_invoices_company_return_no UNIQUE (company_id, return_no)`** (`011_financial_logs_payroll_reports_foundation.sql`).

### `company_id`؟

- **نعم** في الإدراج والقيود.

### أمان التكرار؟

- **احتمال تصادم منخفض جدًا** عمليًا (طابع زمني + عشوائية)، وليس تسلسلًا رسميًا متتابعًا.

---

## 5) ترقيم السندات (`vouchers`)

### الأنواع

- **`voucher_type IN ('RECEIPT','PAYMENT')`** (قيود المخطط في migration `011`).

### توليد الرقم

- **`insertDraftVoucher`**: `generateSequentialDocumentNo` مع **`RECEIPT_VOUCHER`** أو **`PAYMENT_VOUCHER`** (بادئات **`SQ`** و **`SD`**، عرض 6، مع فلتر `voucher_type` في استعلام `MAX`).
- **`voucherRoutes.ts` `POST /`**: يستدعي **`generateSequentialDocumentNo`** ثم `INSERT` — **مسار مزدوج** مع الخدمة لكنه نفس المنطق.

### تسلسل قبض vs دفع

- **منفصل في حساب `MAX`** بسبب `AND voucher_type = $2` داخل `generateSequentialDocumentNo` عندما يكون `cfg.voucherType` معرّفًا.

### UNIQUE؟

- **`vouchers_company_voucher_no UNIQUE (company_id, voucher_no)`**.

### تلقائي عند تأكيد فاتورة؟

- في **`confirmSalesInvoice` / `confirmPurchaseInvoice`** يُستدعى `insertDraftVoucher` ثم التأكيد عند وجود دفعة — التوليد من **`insertDraftVoucher`** (تسلسلي).

### خطر تكرار؟

- نفس آلية القفل الاستشاري + `MAX` + `UNIQUE`؛ خطر التزامن منخفض مع القفل.  
- **ملاحظة:** إن وُجدت سندات قديمة بأرقام لا تطابق النمط `^SQ[0-9]{6}$` / `^SD[0-9]{6}$`، فلن تُحتسب في `MAX` (انظر القسم 9).

---

## 6) ترقيم القيود اليومية (`journal_entries`)

### وجود `entry_no`

- **نعم** — `entry_no text NOT NULL` مع **`UNIQUE (company_id, entry_no)`** (`013_general_ledger_foundation.sql`).

### التوليد عند القيد التلقائي من فاتورة

- **`insertBalancedJournal`** في `glPostingService.ts`: `const entryNo = generateDocumentNo('JE');` — **غير تسلسلي رقمي** بنمط `JE-…`.

### `source_type` / `source_id`

- يُستخدم للربط ومنع تكرار قيد لنفس المصدر عبر فهرس فريد جزئي:
  - **`idx_journal_entries_source_doc`** على `(company_id, source_type, source_id)` لأنواع محددة بما فيها `SALES_INVOICE`, `PURCHASE_INVOICE`, `VOUCHER`, … (انظر `016_sales_purchase_invoices.sql` لتحديث أنواع المصدر).

### «تسلسل محاسبي رسمي» برقم متتابع؟

- **ليس بالشكل الرقمي المتتابع** لمسار `JE-…`؛ مسار **`ACCOUNT_STATEMENT`** يستخدم التسلسل الرقمي على `entry_no` بعرض 10 وبادئة فارغة (انظر `customerRoutes.ts` و `documentNumbers.ts`).

---

## 7) جداول التسلسلات / الإعدادات

- **لا يوجد** جدول `document_sequences` أو ما شابه في المسارات المفحوصة.
- **`companies`** لا يحتوي حقول بادئة أو `next_number`.
- **مصدر الحقيقة للتسلسل الرقمي:** أعمدة `invoice_no` / `voucher_no` / … في جداول المستندات + **`generateSequentialDocumentNo`**.

### آلية التحديث و `FOR UPDATE`

- **لا يوجد** `UPDATE` على صف عدّاد؛ يتم **اشتقاق التالي من `MAX` ثم `INSERT`**.
- **القفل:** `pg_advisory_xact_lock` على مستوى المعاملة (ليس `SELECT … FOR UPDATE` على صف عدّاد).

### `reset` سنوي؟

- **لا يظهر** في `generateSequentialDocumentNo`.

---

## 8) الواجهة وإعدادات الترقيم

### شاشة إعدادات ترقيم في الكود المفحوص؟

- **لم يُعثر** (بحث مسارات صفحات بمفاتيح `numbering` / `ترقيم` في `src/pages`) على شاشة مخصصة لترقيم المستندات.
- **`InvoiceForm.tsx`**:
  - **`useState(isSales ? 'FB0000001' : 'FS0000001')`** لحقل الرقم المعروض قبل التحميل.
  - عند تحميل فاتورة موجودة: `setInvoiceNumber(String(h.invoice_no ?? ''))`.
  - بعد إنشاء فاتورة: `setInvoiceNumber(created.data.invoiceNo || …)`.
  - حقل الرقم **`readOnly`** في الواجهة (سطر تقريبًا 2416 في الملف).

### هل الواجهة تتحكم في الرقم الفعلي عند الإنشاء؟

- **لا للرقم المخزّن:** الخادم يولّد `invoice_no` في `createSalesInvoice` / `createPurchaseInvoice` كما في القسم 2 و 3.

### فرض اختلاف العرض عن الخادم

- **قبل أول حفظ:** قد يبقى العرض على **`FB0000001` / `FS0000001`** حتى يعود الرد من الـ API — إن فُتحت عدة نوافذ «جديد» قد يبدو للمستخدم أن الرقم «نفسه» لكل مسودة جديدة لم تُحفظ.

---

## 9) تحليل سبب ظهور «تكرار الرقم 1» (مبني على الكود، بدون افتراضات بلا أساس)

### أ) عرض واجهة ثابت قبل الحفظ

- الواجهة تضع **`FB0000001` أو `FS0000001`** كقيمة ابتدائية لكل فاتورة جديدة (`InvoiceForm.tsx`).  
- **التفسير المتوافق مع الكود:** المستخدم يرى «الرقم 1» أو «نفس الرقم» لأن **الجزء الرقمي بعد البادئة هو `0000001`** في كل نموذج جديد حتى يُستبدل بقيمة الخادم بعد الإنشاء.

### ب) استعلام `MAX` يتجاهل الصفوف غير المطابقة للنمط

- في `generateSequentialDocumentNo` يُشترط أن يطابق `invoice_no` النمط:
  - مبيعات: `^FB[0-9]{7}$`
  - شراء: `^FS[0-9]{7}$`
- أي فواتير/استيراد مخزّنة بصيغة أخرى (مثل أرقام من **`purchaseImportRoutes`** بصيغة `PI-…`، أو أرقام نصية قديمة **بدون** البادئة والعرض) **لا تُدخل في `MAX`**.
- **النتيجة:** قد يُحسب `next = 1` مرارًا ويُحاول النظام إدراج **`FB0000001`** أو **`FS0000001`** — **قاعدة البيانات والتحقق البرمجي يمنعان التكرار الفعلي** (`UNIQUE` + فحص `dup` قبل `INSERT`)، فيظهر للمستخدم **خطأ تعارض (409 DUPLICATE)** أو فشل إنشاء، وليس بالضرورة صفين بنفس الرقم.

### ج) حذف مسودة تحمل الرقم التسلسلي

- بعد الحذف، قد يُعاد استخدام **نفس الرقم التالي** المتاح — قد يُفسَّر كـ«تكرار» من ناحية المستخدم التجارية رغم أن النظام لم يُخزّن صفين بنفس الرقم في آن واحد.

### د) خلط بين «فاتورة بيع» و«فاتورة شراء»

- الرقمان **`FB0000001`** و **`FS0000001`** مختلفان كنص؛ إن ركز المستخدم على الرقم `0000001` فقط قد يبدو الأمر كتكرار.

### هل المشكلة «بيع فقط» أم «شراء» أم «كل المستندات»؟

- **نفس نمط التسلسل + MAX + regex** ينطبق على البيع والشراء والسندات التسلسلية وطلبات العملاء.  
- **المسارات غير التسلسلية** (مرتجع `RTN-…`, قيد `JE-…`, استيراد `PI-…`) تتصرف بشكل مختلف.

---

## 10) القيود والفهارس ضد التكرار (ملخص)

| الجدول | قيد / فهرس فريد (من migrations) |
|--------|-----------------------------------|
| `sales_invoices` | `UNIQUE (company_id, invoice_no)` |
| `purchase_invoices` | `UNIQUE (company_id, invoice_no)` |
| `return_invoices` | `UNIQUE (company_id, return_no)` |
| `vouchers` | `UNIQUE (company_id, voucher_no)` |
| `journal_entries` | `UNIQUE (company_id, entry_no)` + فهرس فريد جزئي على `(company_id, source_type, source_id)` لمصادر محددة |

**هل يمكن لقاعدة البيانات منع تكرار نفس `invoice_no` لنفس الشركة؟**  
- **نعم** للصيغة المخزّمة كقيمة نصية متطابقة.

**هل بيانات قديمة قد تمنع لاحقًا إضافة UNIQUE جديد؟**  
- غير مطلوب للحقول الحالية (القيود موجودة). قد تُعيق **توحيد الشكل** أو **إعادة ترقيم** إن وُجدت قيم مخالفة للنمط الجديد.

---

## 11) تقييم المخاطر (ملخص)

| النوع | الطريقة | تسلسل منفصل؟ | يمنع التكرار DB؟ | تزامن | مسودات | ملاحظة خطر | مستوى |
|--------|---------|---------------|-------------------|--------|--------|-------------|--------|
| فاتورة بيع | `MAX` + regex + advisory lock | نعم (`FB`) | نعم | جيد ضمن نفس المفتاح | الرقم يُعطى عند الإنشاء؛ الحذف يحرّر الرقم منطقيًا | تجاهل أرقام خارج النمط في `MAX` | **متوسط** |
| فاتورة شراء | مثل البيع (`FS`) | نعم | نعم | جيد | مثل البيع | + مسار استيراد بصيغة مختلفة | **متوسط** |
| مرتجع | `generateDocumentNo` | ليس تسلسلًا رقميًا | نعم | جيد تقريبًا | مسودة برقم فوري | ليس ترقيمًا تسلسليًا تقليديًا | **منخفض** |
| سند قبض | `MAX` + `SQ` | منفصل عن الدفع | نعم | جيد | مسودة برقم فوري | نمط regex | **متوسط** |
| سند دفع | `MAX` + `SD` | منفصل عن القبض | نعم | جيد | مسودة برقم فوري | نمط regex | **متوسط** |
| قيد GL (`JE-`) | عشوائي/وقت | — | نعم (`entry_no`) | جيد تقريبًا | — | ليس تسلسلًا محاسبيًا متتابعًا | **منخفض** |

---

## 12) سياسة مقترحة لاحقًا (بدون تنفيذ)

1. **مسودة برقم رسمي أم مؤقت؟**  
   - الوضع الحالي: **رقم رسمي عند إنشاء المسودة**.  
   - بديل شائع: رقم مؤقت `DRAFT-…` والرقم الرسمي عند التأكيد — يحتاج قرار منتج.

2. **فجوات عند حذف المسودة؟**  
   - مع `MAX+1` الحالي: **نعم ممكن إعادة استخدام الرقم** بعد حذف المسودة إن لم يبقَ سوى أرقام أقل.  
   - القبول المحاسبي: قرار إداري.

3. **عرض المسودة بدون رقم رسمي:**  
   - إما إبقاء الرقم الحالي أو إظهار «مسودة — سيتم الترقيم عند التأكيد».

4. **جدول تسلسلات مركزي (اختياري):**  
   - `document_type`, `company_id`, `next_number`, `prefix`, `padding`, `reset_policy`, `year` — مع `SELECT … FOR UPDATE` على صف العداد.

5. **`FOR UPDATE` على عدّاد:**  
   - بديل عن أو مكمّل لـ `advisory_xact_lock` إذا أُدخل جدول عدادات.

6. **`UNIQUE`:**  
   - موجود بالفعل على الرؤوس؛ الإبقاء عليه عند أي تغيير.

7. **فصل أنواع التسلسل:**  
   - موجود جزئيًا في الكود؛ يمكن توحيد التسمية (SI/PI/…) كقرار منتج.

8. **Multi-company:**  
   - مدمج في الاستعلامات والقيود عبر `company_id`.

9. **Reset سنوي:**  
   - غير مدعوم حاليًا؛ يتطلب عمود سنة أو سياسة في جدول تسلسلات.

---

## 13) خطة تنفيذ مستقبلية (مقترحة فقط)

| المرحلة | الهدف | ملفات/جداول متوقعة | مخاطر | اختبار |
|---------|--------|---------------------|--------|---------|
| 1 | حصر الأرقام الفعلية في DB لكل نوع | استعلامات SQL على `sales_invoices`, `purchase_invoices`, `vouchers`, … | — | تقارير CSV |
| 2 | كشف القيم خارج نمط `^FB…$` / `^FS…$` | نفس الجداول | قد يكشف بيانات قديمة | فلترة SQL |
| 3 | تصميم جدول تسلسلات (إن وُجدت حاجة) | migration جديد + خدمة | تعقيد ترحيل | اختبار على نسخة |
| 4 | توحيد توليد الرقم داخل خدمة واحدة + معاملة | `documentNumbers.ts`, الخدمات | تغيير سلوك | اختبارات تكامل |
| 5 | مراجعة UNIQUE وترحيل البيانات | migrations | وقت توقف | نسخ احتياطي |
| 6 | واجهة إعدادات (اختياري) | `src/pages/...` | تعقيد UX | يدوي |
| 7 | اختبار تزامن | سكربتات متوازية | — | ضغط على `POST` |
| 8 | مسودات/حذف/تأكيد | نفس مسارات الفواتير | فجوات أرقام | سيناريوهات |

---

## 14) قائمة مراجع للملفات والجداول (للتعديل لاحقًا عند الإصلاح)

**ملفات (خادم):**  
`server/src/utils/documentNumbers.ts`, `server/src/services/salesInvoiceService.ts`, `server/src/services/purchaseInvoiceService.ts`, `server/src/services/voucherCashboxService.ts`, `server/src/routes/voucherRoutes.ts`, `server/src/routes/returnInvoiceRoutes.ts`, `server/src/services/glPostingService.ts`, `server/src/routes/purchaseImportRoutes.ts`, `server/src/routes/customerOrderRoutes.ts`, `server/src/routes/customerRoutes.ts`  

**ملفات (واجهة):**  
`src/pages/invoices/InvoiceForm.tsx`  

**جداول:**  
`sales_invoices`, `purchase_invoices`, `return_invoices`, `vouchers`, `journal_entries`, `customer_orders` (للطلبات), `cashbox_movements` (لحركات الصندوق المرتبطة بأرقام `MOV`).

---

**ختامًا:** النظام الحالي يمزج بين **تسلسل رقمي ببادئة ثابتة في الكود** (`generateSequentialDocumentNo`) و**أرقام غير تسلسلية** (`generateDocumentNo`) حسب نوع المستند؛ **لا يوجد جدول إعدادات ترقيم في قاعدة البيانات**؛ **قيود UNIQUE موجودة** على أرقام المستندات الرئيسية. ظهور «نفس الرقم 1» للمستخدم يتسق غالبًا مع **القيمة الافتراضية في الواجهة (`…0000001`)** و/أو **الجزء الرقمي المتطابق بين FB و FS** و/أو **سلوك `MAX` مع أرقام قديمة لا تطابق النمط**، مع أن **التخزين المكرر لنفس `invoice_no` لنفس الشركة** يُفترض أن يُرفض على مستوى التطبيق أو قاعدة البيانات ما دامت القيود سارية.
