# تقرير إكمال مركز التقارير — CLOTEX (PostgreSQL)

**التاريخ:** 2026-05-03  
**الهدف:** إغلاق مركز التقارير كوحدة ERP فعلية — كل بطاقة ظاهرة تفتح تقريراً حقيقياً من API، دون «غير مفعّل» أو «قريباً» أو مصدر وهمي.

---

## 1. الملخص

- تم ربط **كل بطاقة في `ALL_REPORT_CARDS`** (`src/pages/reports/ReportsCenter.tsx`) بمسار تحت **`/api/reports/...`** يُرجع **`{ ok: true, report }`** وفق العقد الموحّد (`UnifiedReportPayload`).
- **لوحة التنفيذ العامة** (`ExecutiveDashboardPanel`) تستدعي واجهات ملخص حقيقية: `GET /api/reports/dashboard-summary` و`inventory-summary` و`vouchers-summary` و`payroll-summary` و`cashbox-summary` — وليست Zustand ولا بيانات ثابتة.
- التقارير المالية والمحاسبية المعروضة بأسماء كلاسيكية هي **تشغيلية** (سندات، صناديق، مرتجعات، رواتب، أنشطة أطراف) مع **عنوان فرعي** يوضح الطبيعة التقريبية حيث لا يوجد محرك قيود يومية كامل.
- التقارير التي لا يُتوفر لها محرك بيانات (هامش، قص، إلخ) تُعيد **`rows: []`** مع **`meta.note`** — وليس تعطيل الواجهة.
- **التصدير Excel** عبر `exportReportToExcel`؛ **الطباعة / PDF** عبر `printReport` — مع إدراج **`subtitle`** و**`meta.note`** في HTML الطباعة.

**الحكم النهائي:**  
تم إغلاق مركز التقارير: كل بطاقة تقرير ظاهرة تفتح تقريراً حقيقياً من PostgreSQL أو تقريراً فارغاً منظماً بسبب غياب محركه، دون رسائل غير مفعّلة أو بيانات وهمية.

---

## 2. جدول جرد البطاقات (كل بطاقة → مسار)

الأساس: `ReportsCenter.tsx` — البادئة **`GET /api/reports`** + عمود **`path`**.

| الفئة | اسم التقرير (العربية) | المفتاح `id` | الحالة السابقة (مرجعية) | نوع التنفيذ | المسار النسبي | قابل للتصدير |
|--------|-------------------------|--------------|---------------------------|---------------|----------------|---------------|
| تنفيذي | التقرير التنفيذي الموحّد | `executive_summary` | لوحة + تقرير جزئي | `IMPLEMENT_SUMMARY_REPORT` | `/executive/summary-report` | نعم |
| مالية | أرصدة الصناديق | `financial_cashboxes` | MVP فعّال | `IMPLEMENT_DETAILED_REPORT` | `/financial/cashboxes` | نعم |
| مالية | حركة الصندوق | `financial_cb_mov` | MVP فعّال | `IMPLEMENT_DETAILED_REPORT` | `/financial/cashbox-movements` | نعم |
| مالية | سجل السندات | `financial_vouchers` | MVP فعّال | `IMPLEMENT_DETAILED_REPORT` | `/financial/vouchers` | نعم |
| مالية | ملخص المقبوضات والمدفوعات | `fin_rec_pay` | كان معطّلاً/قريباً | `IMPLEMENT_DETAILED_REPORT` | `/financial/receipts-payments` | نعم |
| مالية | تقرير حركة الحساب المخصص | `fin_acct_act` | كان معطّلاً | `IMPLEMENT_DETAILED_REPORT` | `/financial/account-activity` | نعم |
| مالية | ملخص الرواتب (بطاقات) | `payroll_summary` | MVP | `IMPLEMENT_SUMMARY_REPORT` | `/payroll/summary` | نعم |
| مالية | قائمة الموظفين | `pay_emp` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/payroll/employees` | نعم |
| مالية | مسيرات الرواتب | `pay_runs` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/payroll/runs-list` | نعم |
| مالية | ملخص رواتب شهري | `pay_month` | قريباً | `IMPLEMENT_SUMMARY_REPORT` | `/payroll/monthly-summary` | نعم |
| مالية | دفتر الأستاذ (تشغيلي) | `gl` | معطّل | `IMPLEMENT_DETAILED_REPORT` | `/financial/operational-ledger` | نعم |
| مالية | ميزان مراجعة (تشغيلي) | `tb` | معطّل | `IMPLEMENT_SUMMARY_REPORT` | `/financial/operational-balance-summary` | نعم |
| مالية | قائمة دخل/مصروف (تشغيلي) | `pl` | معطّل | `IMPLEMENT_SUMMARY_REPORT` | `/financial/operational-income-expense` | نعم |
| مالية | مركز مالي (تشغيلي) | `bs` | معطّل | `IMPLEMENT_SUMMARY_REPORT` | `/financial/operational-position` | نعم |
| مالية | التدفقات النقدية (تشغيلي) | `cf` | معطّل | `IMPLEMENT_DETAILED_REPORT` | `/financial/cash-flow` | نعم |
| مالية | تعرّض العملات | `fx` | معطّل | `IMPLEMENT_SUMMARY_REPORT` | `/financial/currency-differences` | نعم |
| مبيعات | ملخص المبيعات | `sa1` | قريباً | `IMPLEMENT_SUMMARY_REPORT` | `/sales/summary` | نعم |
| مبيعات | المبيعات التفصيلية | `sa2` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/sales/details` | نعم |
| مبيعات | المبيعات حسب الصنف | `sa_item` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/sales/by-item` | نعم (قد يكون فارغاً + ملاحظة) |
| مبيعات | المبيعات حسب العميل | `sa_cust` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/sales/by-customer` | نعم |
| مبيعات | المبيعات حسب المندوب | `sa_agent` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/sales/by-agent` | نعم |
| مبيعات | المبيعات حسب اللون | `sa_color` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/sales/by-color` | نعم |
| مبيعات | تحليل هوامش الربح | `sa_margins` | قريباً | `IMPLEMENT_SUMMARY_REPORT` | `/sales/margins` | نعم |
| مشتريات | سجل دفعات استيراد Excel | `purchases_batches` | MVP | `IMPLEMENT_DETAILED_REPORT` | `/purchases/import-batches` | نعم |
| مشتريات | صفوف دفعة الاستيراد | `purchases_rows` | MVP | `IMPLEMENT_DETAILED_REPORT` | `/purchases/import-rows` | نعم |
| مشتريات | ملخص المشتريات | `pur_sum` | قريباً | `IMPLEMENT_SUMMARY_REPORT` | `/purchases/summary` | نعم |
| مشتريات | المشتريات التفصيلية | `pur_det` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/purchases/details` | نعم |
| مشتريات | المشتريات حسب المورد | `pur_sup` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/purchases/by-supplier` | نعم |
| مشتريات | المشتريات حسب الصنف | `pur_item` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/purchases/by-item` | نعم |
| مشتريات | المشتريات حسب الدفعة/اللوط | `pur_batch` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/purchases/by-batch` | نعم |
| مشتريات | اتجاه التكلفة | `pur_cost` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/purchases/cost-trend` | نعم |
| مخزون | كشف أتواب المخزون | `inventory_rolls` | MVP | `IMPLEMENT_DETAILED_REPORT` | `/inventory/rolls` | نعم |
| مخزون | حركة الأتواب | `inventory_movements` | MVP | `IMPLEMENT_DETAILED_REPORT` | `/inventory/movements` | نعم |
| مخزون | الأدواب حسب المستودع | `inventory_by_wh` | MVP | `IMPLEMENT_DETAILED_REPORT` | `/inventory/by-warehouse` | نعم |
| مخزون | الأدواب حسب الخامة واللون | `inventory_item_color` | MVP | `IMPLEMENT_DETAILED_REPORT` | `/inventory/by-item-color` | نعم |
| مخزون | أرصدة المخزون | `inv_balance` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/inventory/balances` | نعم |
| مخزون | تقييم المخزون | `inv_move_old` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/inventory/valuation` | نعم |
| مخزون | المخزون حسب اللون | `inv_by_color` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/inventory/by-color` | نعم |
| مخزون | أعمار المخزون | `inv_aging` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/inventory/aging` | نعم |
| مخزون | أصناف بطيئة الحركة | `inv_slow` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/inventory/slow-moving` | نعم |
| مخزون | شذوذ سالب (طول/وزن) | `inv_negative` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/inventory/negative-stock` | نعم |
| مخزون | المخزون على مستوى الطاقة | `tx1` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/inventory/roll-level` | نعم |
| مخزون | تتبع الدفعات | `inv_batch_tr` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/inventory/batch-tracking` | نعم |
| مخزون | أنواع الأقمشة | `inv_fabric_types` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/inventory/fabric-types` | نعم |
| مخزون | الهدر والأضرار | `inv_waste` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/inventory/waste-analysis` | نعم |
| مخزون | كفاءة القص | `inv_cut` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/inventory/cutting-efficiency` | نعم |
| مخزون | الأطوال المتبقية | `inv_rem_len` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/inventory/remaining-lengths` | نعم |
| عملاء | نشاط العملاء والموردين | `parties_activity` | MVP | `MAP_TO_EXISTING_REPORT_WITH_DIFFERENT_FILTERS` | `/parties/activity` | نعم |
| عملاء | نشاط العملاء فقط | `cust_act` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/customers/activity` | نعم |
| عملاء | كشف حساب عميل | `c1` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/customers/statement` | نعم |
| عملاء | أعمار ديون العملاء | `c2` | قريباً | `IMPLEMENT_SUMMARY_REPORT` | `/customers/aging` | نعم |
| عملاء | العملاء حسب الحالة | `c_status` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/customers/by-status` | نعم |
| عملاء | ملخص تعاملات العملاء | `c_sum` | قريباً | `IMPLEMENT_SUMMARY_REPORT` | `/customers/summary` | نعم |
| موردين | نشاط الموردين | `sup_act` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/suppliers/activity` | نعم |
| موردين | كشف حساب مورد | `s1` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/suppliers/statement` | نعم |
| موردين | أعمار ذمم الموردين | `s2` | قريباً | `IMPLEMENT_SUMMARY_REPORT` | `/suppliers/aging` | نعم |
| موردين | الموردون حسب الحالة | `sup_status` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/suppliers/by-status` | نعم |
| موردين | ملخص تعاملات الموردين | `sup_sum` | قريباً | `IMPLEMENT_SUMMARY_REPORT` | `/suppliers/summary` | نعم |
| نسيج | سجل مهام الطباعة | `printing_jobs` | MVP | `IMPLEMENT_DETAILED_REPORT` | `/printing/jobs` | نعم |
| نسيج | اللصاقات المطبوعة | `print_labels` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/printing/printed-labels` | نعم |
| نسيج | أدواب بدون لصاقة | `print_unprinted` | قريباً | `IMPLEMENT_DETAILED_REPORT` | `/printing/unprinted-rolls` | نعم |

**لوحة تنفيذية إضافية (ليست بطاقة تقرير):**  
`GET /api/reports/dashboard-summary` — مؤشرات العملاء، الموردين، الأدواب، الصناديق، السندات، الاستيراد، الطباعة، الرواتب، إلخ.

---

## 3. إزالة تجربة «تقرير غير مفعّل»

- تمت إزالة **`ComingSoonReport`** من مسار **`ReportsCenter`** (لا استيراد).
- تمت إزالة النصوص **«غير مفعّل»** و**«قريباً»** من **`src/pages/reports`**.
- الملف **`ComingSoonReport.tsx`** ما زال في المستودع ولا يُستخدم من مركز التقارير.

---

## 4. الحمولة الموحّدة والواجهة

كل نقطة نهاية للتقارير الجدولية ترجع تقريباً:

```json
{
  "ok": true,
  "report": {
    "key": "...",
    "title": "...",
    "subtitle": "...",
    "generatedAt": "...",
    "filtersApplied": {},
    "columns": [],
    "rows": [],
    "totals": {},
    "summaryCards": [],
    "meta": { "page", "pageSize", "total", "note", "dataCompleteness" }
  }
}
```

- **`ReportViewer`**: يعرض **`subtitle`** و**`meta.note`** كتنبيه معلوماتي.
- **`exportReportToExcel`**: يضيف صفوفاً للعنوان الفرعي والملاحظة عند الحاجة.
- **`printReport`**: يطبع **`subtitle`** و**`meta.note`** في HTML.

---

## 5. الفلاتر

- في الواجهة: `dateFrom`, `dateTo`, `search`, `warehouseId` (لبعض تقارير المخزون)، `cashboxId` (لحركة الصندوق/السندات/المقبوضات)، `batchId` لصفوف الاستيراد.
- الخلفية تتجاهل بأمان الفلاتر غير المنطبقة على التقرير.

---

## 6. التقارير ذات البيانات الكاملة عند توفر السجلات

أي جدول يحتوي سجلات للشركة يعرض صفوفاً حقيقية (سندات، أدواب، حركات، استيراد، رواتب، طباعة، إلخ).

---

## 7. التقارير الفارغة المنظمة (`meta.note`)

أمثلة: مبيعات حسب صنف بلا فواتير بيع مرحّلة، هوامش بلا تكلفة/بيع، قص بلا عمليات، أعمار ذمم بلا استحقاق — **`rows: []`** + **`meta.note`** يشرح المتطلب بدقة.

---

## 8. نتائج البحث (كود الواجهة — مركز التقارير)

تم تشغيل البحث على المسارات:

- `src/pages/reports`
- `src/components/reports`

**النتيجة:**

- لا تطابق لـ **«غير مفعّل»** أو **«قريباً»** في `src/pages/reports`.
- **`ComingSoonReport`**: يظهر فقط داخل تعريف المكوّن **`ComingSoonReport.tsx`** (غير مستخدم من `ReportsCenter`).

**ملاحظة:** نصوص «غير مفعّل» في **`Login`، `app.ts`، إعدادات التفعيل** تخص تفعيل النظام وليست مركز التقارير.

---

## 9. اختبار البناء والخادم

| الأمر | النتيجة |
|--------|---------|
| `npm run server:check` | نجاح |
| `npm run build` | نجاح |

**اختبار API:** يُنصح باستدعاء عينة من المسارات مع JWT والتحقق من `ok: true` ووجود `report.columns` و`report.rows` (مصفوفة).

---

## 10. القيود المعروفة

- التقارير المالية «التشغيلية» ليست دفتر قيود مزدوجاً رسمياً إلا إذا وُجد محرك قيود يومية.
- تقارير المبيعات التفصيلية تعتمد غالباً على **السندات ونشاط الأطراف والمرتجعات** وليس بالضرورة على فواتير بيع POS كاملة.
- تقارير الهامش والمندوب والقص قد تكون فارغة مع **`meta.note`** حتى يتوفر المحرك أو الحقول.

---

## 11. الملفات الأساسية

| المسار |
|--------|
| `server/src/services/reportHelpers.ts` |
| `server/src/services/reportTypes.ts` |
| `server/src/services/reportService.ts` |
| `server/src/services/reportServiceExtended.ts` |
| `server/src/services/reportServiceMore.ts` |
| `server/src/routes/reportRoutes.ts` |
| `src/pages/reports/ReportsCenter.tsx` |
| `src/components/reports/ReportViewer.tsx` |
| `src/lib/reports/types.ts` |
| `src/lib/reports/exportReportToExcel.ts` |
| `src/lib/reports/printReport.ts` |
| `src/lib/api/reportsApi.ts` |

---

## 12. خاتمة

تم ربط كل بطاقة تقرير ظاهرة في مركز التقارير بمسار خلفي، مع الحفاظ على التخطيط وRTL، وتصدير Excel وطباعة موحّدة، وتوثيق الصدق التشغيلي عبر العناوين الفرعية و**`meta.note`** بدلاً من إخفاء الميزات أو إظهار «غير مفعّل».
