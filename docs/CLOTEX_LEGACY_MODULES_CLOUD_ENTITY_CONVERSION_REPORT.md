# تقرير تحويل الأقسام القديمة إلى كيانات سحابية حقيقية — CLOTEX ERP

**التاريخ:** 2026-05-03

---

## 1. الملخص

تم استبدال البيانات الوهمية (مصفوفات ثابتة في React، أرقام JSX، واعتماد Zustand في مركز التقارير) بطبقة **API حقيقية** تستند إلى **PostgreSQL** عبر Fastify، مع الحفاظ على الهيكل البصري العام للصفحات (جداول، بطاقات، ألوان، RTL). أُضيفت ترحيلة **`011_financial_logs_payroll_reports_foundation.sql`** وجداول جديدة للمرتجعات، سجل الأطراف، الصناديق، السندات، والرواتب، وتقارير ملخص من الخادم. تم ربط إنشاء العملاء/الموردين بتسجيل **سجل أطراف** تلقائي عند الإنشاء والتحديث، وتأكيد السندات بحركات صناديق ضمن معاملات آمنة.

---

## 2. الملفات المُنشأة

| المسار | الوصف |
|--------|--------|
| `server/src/db/migrations/011_financial_logs_payroll_reports_foundation.sql` | ترحيلة الجداول الجديدة |
| `server/src/services/partyActivityLogService.ts` | إدراج سجلات `party_activity_logs` |
| `server/src/services/voucherCashboxService.ts` | تأكيد/إلغاء السند مع تحديث الصندوق |
| `server/src/utils/documentNumbers.ts` | توليد أرقام وثائق فريدة (MVP) |
| `server/src/routes/returnInvoiceRoutes.ts` | API المرتجعات |
| `server/src/routes/partyActivityLogRoutes.ts` | API سجل الأطراف |
| `server/src/routes/cashboxRoutes.ts` | API الصناديق والحركات + `GET /movements/all` |
| `server/src/routes/voucherRoutes.ts` | API السندات |
| `server/src/routes/payrollRoutes.ts` | API الموظفين ومسيرات الرواتب |
| `server/src/routes/reportRoutes.ts` | تقارير الملخص من PostgreSQL |
| `src/lib/api/returnsApi.ts` | عميل المرتجعات |
| `src/lib/api/partyLogsApi.ts` | عميل سجل الأطراف |
| `src/lib/api/cashboxesApi.ts` | عميل الصناديق والحركات الموحدة |
| `src/lib/api/vouchersApi.ts` | عميل السندات |
| `src/lib/api/payrollApi.ts` | عميل الرواتب |
| `src/lib/api/reportsApi.ts` | عميل تقارير الملخص |

---

## 3. الملفات المُعدَّلة

- `server/src/app.ts` — تسجيل المسارات الجديدة تحت `/api/returns`, `/api/party-logs`, `/api/cashboxes`, `/api/vouchers`, `/api/payroll`, `/api/reports`.
- `server/src/routes/customerRoutes.ts` — إدراج سجل نشاط عند إنشاء/تحديث عميل.
- `server/src/routes/supplierRoutes.ts` — إدراج سجل نشاط عند إنشاء/تحديث مورد.
- `server/src/db/seed.ts` — صندوق افتراضي **`MAIN-USD`** برصيد صفر (تهيئة وليس بيانات أعمال وهمية).
- الواجهات:  
  `ReturnInvoices.tsx`, `CustomersLog.tsx`, `SuppliersLog.tsx`,  
  `treasury/Safes.tsx`, `treasury/TreasuryLog.tsx`, `treasury/TreasurySettings.tsx`,  
  `PaymentBonds.tsx`, `CollectionBonds.tsx`, `BondRecords.tsx`,  
  `Salaries.tsx`, `reports/ReportsCenter.tsx`.

---

## 4. الترحيلة والجداول

**ملف:** `011_financial_logs_payroll_reports_foundation.sql`

**جداول:**  
`return_invoices`, `return_invoice_lines`, `party_activity_logs`, `cashboxes`, `cashbox_movements`, `vouchers`, `payroll_employees`, `payroll_runs`, `payroll_run_lines` — مع فهارس على `company_id` والحقول الزمنية/الحالة حسب المواصفات.

---

## 5. مسارات الخادم (موجز)

| الأساس | الوظيفة |
|--------|---------|
| `/api/returns` | قائمة، تفاصيل، إنشاء، تحديث (مسودة)، تأكيد، إلغاء |
| `/api/party-logs` | قائمة، ملخص، إنشاء يدوي |
| `/api/cashboxes` | CRUD جزئي، حركات لكل صندوق، **جميع الحركات** `/movements/all`، تعديل رصيد |
| `/api/vouchers` | قائمة، تفاصيل، إنشاء، تحديث (مسودة)، تأكيد، إلغاء مع عكس حركة |
| `/api/payroll` | موظفون، مسيرات مع أسطر، تأكيد، تم الدفع، إلغاء |
| `/api/reports` | `dashboard-summary`, `inventory-summary`, `cashbox-summary`, `vouchers-summary`, `payroll-summary` |

كلها محمية بـ **`authenticateRequest`** وعزل **`company_id`** من JWT.

---

## 6. عملاء الواجهة

جميع العملاء يعتمدون على **`apiFetch`** من `src/lib/api/client.ts` دون بيانات احتياطية وهمية.

---

## 7. تحويل الشاشة تلو الأخرى

| الوحدة | السلوك الجديد |
|--------|----------------|
| **فواتير المرتجعات** | تحميل من `/api/returns`، حالة فارغة «لا توجد فواتير مرتجعات بعد»، نموذج إنشاء مسودة سطر واحد، زر تأكيد يستدعي PATCH؛ تنبيه بعدم تعديل مخزون الأتواب تلقائياً. |
| **سجل العملاء / الموردين** | من `/api/party-logs` مع `partyType=CUSTOMER/SUPPLIER`. |
| **الصناديق** | من `/api/cashboxes`، إنشاء صندوق حقيقي عبر نافذة؛ بطاقات الإيداع/السحب السريع مُعطّلة بصرياً (التدفق عبر السندات). |
| **سجل حركة الصناديق** | من `/api/cashboxes/movements/all`. |
| **إعدادات الصناديق** | عرض صناديق حقيقية، زر حفظ معطّل مع تفسير (لا API إعدادات متقدم بعد). |
| **سند صرف / قبض** | نماذج مربوطة بـ API، قوائم من صناديق/عملاء/موردين؛ توليد رقم سند من الخادم عند الحفظ؛ تدفق «حفظ وتسجيل في الصندوق» = إنشاء + تأكيد. |
| **سجل السندات** | جدول من `/api/vouchers`. |
| **الرواتب** | جدول موظفين من `/api/payroll/employees`، قائمة مسيرات من `/api/payroll/runs`، إضافة موظف، إجماليات محسوبة من البيانات المعروضة. |
| **مركز التقارير** | لوحة KPI من `/api/reports/*`؛ كشف جرد الأتواب من **`listFabricRolls`** مع ترحيل صفحات (حد الخادم 200/صفحة). |

---

## 8. البيانات الوهمية المُزالة

- جميع `useState([...])` الثابتة من الصفحات المستهدفة.
- أرقام سندات ثابتة مثل PAY-8802 / REC-1106.
- صفوف TRX وهمية، أرصدة صناديق ثابتة، موظفون وهميون، إجماليات تذييل ثابتة.
- في **ReportsCenter**: إزالة **useStore** من لوحة التنفيذ وكشف الجرد؛ استبدالها بـ API.

---

## 9. الحفاظ على التصميم

- الإبقاء على نفس تخطيط الصفحات: عناوين، جداول بـ `bg-slate-800` للرأس، بطاقات الصناديق، نماذج السندات بنفس البنية البصرية.
- إضافة حالات تحميل (`Loader2`) ورسائل خطأ داخل صناديق متناسقة مع النمط الحالي.

---

## 10. سلوك الصندوق والسندات

- **تأكيد السند:** معاملة واحدة: تحديث السند، إنشاء `cashbox_movements`، تحديث `current_balance` للصندوق، إدراج `party_activity_logs` للعميل/المورد عند الاختيار.
- **إلغاء سند مؤكد:** حركة عكسية بنوع `ADJUSTMENT` ومصدر `VOUCHER_CANCEL`، مع تحديث الرصيد.
- **إلغاء مسودة:** لا حركة صندوق.

---

## 11. البذرة

- إدراج صندوق **`MAIN-USD`** / «الصندوق الرئيسي» برصيد **0** عند تشغيل البذرة (`ON CONFLICT DO NOTHING`).
- لا فواتير أو رواتب أو سندات وهمية في البذرة.

---

## 12. نتائج الفحص والبناء

| الأمر | النتيجة |
|--------|---------|
| `npm run server:check` | نجاح |
| `npm run lint` (tsc جذر المشروع) | نجاح |
| `npm run build` | نجاح |

**ملاحظة:** تشغيل `npm run server:migrate` و`npm run server:seed` يجب أن يتم على بيئة مضبوطة بـ `DATABASE_URL` (مثلاً عبر نفق SSH إلى VPS). لم يُنفَّذ هنا تلقائياً إن لم تكن البيئة متاحة.

---

## 13. فحص أمني سريع

- لا تطابق لـ `RET-5501`, `PAY-8802`, `REC-1106`, `TRX-` في مجلد `src/pages` للصفحات المحوّلة.
- لا يزال المشروع يخزّن **رمز JWT** في `localStorage`/`sessionStorage` للجلسة — هذا مسموح كمصدر جلسة وليس كمصدر لبيانات الأعمال.

---

## 14. قيود معروفة (MVP)

- تأكيد **مرتجع المبيعات/المشتريات** لا يعدّل كميات **fabric_rolls** تلقائياً — يتطلب تدفق إرجاع مخزون لاحقاً.
- **مسير الرواتب**: تأكيد و«تم الدفع» لا ينشئ قيداً محاسبياً كاملاً ولا خصماً تلقائياً من الصندوق (موثّق في استجابة API).
- **إعدادات الخزينة المتقدمة** (سياسات سالبة، مرفقات) غير محفوظة بعد — الواجهة توضح ذلك.
- كشف الأتواب في التقارير يحمّل حتى **100 صفحة × 200 صف** كحد أمان للحلقة؛ قابل للتوسعة بتصفح الخادم لاحقاً.

---

## 15. المرحلة التالية المقترحة

1. ربط مرتجعات المبيعات بحركات مخزون آمنة على `fabric_rolls`.
2. API لإعدادات الخزينة في `system_settings` أو جدول مخصص.
3. تقارير مالية تفصيلية (دفتر أستاذ، ميزان مراجعة) عندما يُعرَّف محرك محاسبي.
4. ربط «تم دفع الراتب» بحركة صندوق اختيارية.

---

## 16. الحكم النهائي

**تم تحويل الأقسام القديمة من بيانات وهمية إلى كيانات حقيقية مرتبطة بقاعدة PostgreSQL VPS دون كسر التصميم.**

*(تشغيل الترحيل والبذرة على الخادم الفعلي مطلوب لإظهار الصندوق الافتراضي والجداول على VPS.)*
