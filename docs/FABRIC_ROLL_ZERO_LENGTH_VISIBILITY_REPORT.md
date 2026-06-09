# تقرير تشخيصي: ظهور/إخفاء الأتواب المباعة أو ذات الطول الصفر في المخزون والتقارير

**النطاق:** فحص الكود وملفات الـ migrations الحالية فقط — **بدون تنفيذ تعديلات أو migrations.**  
**التاريخ:** 2026-05-13

---

## 1) بنية المخزون في قاعدة البيانات (حقول حقيقية)

### `fabric_rolls` (المصدر: `server/src/db/migrations/004_fabric_rolls_inventory_engine.sql` + `024_excel_import_traceability_and_metadata.sql`)

| الحقل | ملاحظة |
|--------|--------|
| `id`, `company_id` | معرّف الشركة والرول |
| `roll_no`, `barcode` | الباركود إلزامي وفريد لكل شركة `UNIQUE (company_id, barcode)` |
| `item_id` | FK → `fabric_items(id)` — ربط الرول بالخامة |
| `color_id`, `variant_id` | FK للون والمتغير |
| `supplier_id`, `warehouse_id`, `location_id` | مورد ومستودع وموقع |
| **`length_m`** | `numeric(14,3) NOT NULL DEFAULT 0` مع `CHECK (length_m >= 0)` — **هذا حقل الطول الحالي على الرول** |
| `width_cm`, `gsm`, `calculated_weight_kg`, `actual_weight_kg`, `unit_cost`, `currency_code` | مواصفات وتكلفة |
| `batch_no`, `container_no`, `purchase_invoice_no`, `supplier_roll_ref` | تتبع |
| **`status`** | `text NOT NULL DEFAULT 'AVAILABLE'` مع `CHECK (status IN ('AVAILABLE','RESERVED','SOLD','DAMAGED','TRANSFERRED','INACTIVE'))` |
| `notes`, `created_by_user_id`, `created_at`, `updated_at` | — |
| **إضافات 024** | `import_batch_id`, `purchase_invoice_id`, `purchase_invoice_line_id` — ربط بفاتورة/سطر شراء أو دفعة استيراد |

**لا يوجد** في الـ schema المراجع: `original_length_m`، `initial_length_m`، `sold_at`، `consumed_at`، `inactive_at`، `is_active` على جدول الرول. الطول «الأصلي» للتدقيق يُستنتج من **`inventory_movements`** أو من **`sales_invoice_lines.metadata` (JSON)** بعد التنفيذ الحالي للبيع.

### `fabric_items` (`002_textile_master_data.sql`)

- كتالوج خامات: `is_active boolean NOT NULL DEFAULT true` — **هذا يخص تعطيل تعريف المادة وليس رصيد الأتواب.**
- لا يوجد حقل «رصيد متاح» على الصنف؛ الرصيد مُشتق من أتواب `fabric_rolls` المرتبطة بـ `item_id`.

### `inventory_movements` (`004_fabric_rolls_inventory_engine.sql`)

- سجل تدقيق: `roll_id`, `movement_type` (يشمل `PURCHASE_RECEIPT`, `SALE`, `RETURN`, `ADJUSTMENT`, …)، `old_status`, `new_status`, **`length_delta_m`**, `reference_type`, `reference_id`, `reference_no`, مستودعات من/إلى، إلخ.
- **لا يوجد عمود snapshot كامل للرول**؛ التاريخ يُعاد بناؤه من مجموع `length_delta_m` ومن حالة الرول الحالية في التقارير التي تستخدم ذلك (انظر القسم 6).

### ربط الرول بالفواتير

- `sales_invoice_lines.fabric_roll_id` → `fabric_rolls(id) ON DELETE SET NULL` (`016_sales_purchase_invoices.sql`)
- `purchase_invoice_lines.fabric_roll_id` — نفس النمط
- **حذف فيزيائي للرول:** لا يظهر في كود الخدمات المفحوص `DELETE FROM fabric_rolls` كجزء من تأكيد البيع؛ البيع الكامل يضبط **`length_m = 0` و `status = 'SOLD'`** (انظر القسم 2). حذف الرول قد يحدث في مسارات أخرى (مثلاً CASCADE من كيانات مرتبطة) لكن **ليس مسار تأكيد البيع المعياري**.

---

## 2) منطق تأكيد فاتورة البيع وتأثيره على الرول

**الملف:** `server/src/services/salesInvoiceService.ts` — الدالة `confirmSalesInvoice`.

### عند بيع **كامل** كمية الرول (بعد التقريب `fullSale = newLen <= EPS`)

1. `UPDATE fabric_rolls SET length_m=0, status='SOLD', updated_at=now() WHERE id=...`
2. `INSERT INTO inventory_movements` بنوع **`SALE`**، `old_status` = حالة الرول السابقة (متوقع `AVAILABLE`)، `new_status` = **`SOLD`**، `length_delta_m` = **`-len`** (سالب بقيمة الطول السابق بالكامل)، `reference_type` = **`SALES_INVOICE`**، `reference_id` = معرف الفاتورة.

### عند بيع **جزئي**

1. `UPDATE fabric_rolls SET length_m=$newLen` **فقط** — **لا يتغير `status`** في هذا التحديث (يبقى `AVAILABLE` إن كان كذلك).
2. حركة **`SALE`** مع `new_status` = **`AVAILABLE`** في السجل (الحقل `new_status` في الحركة)، و`length_delta_m` = **`-soldQty`**.

### ملاحظات مهمة

- **لا يُنشأ رول جديد للمتبقي** في هذا المسار؛ نفس `fabric_roll_id` يُخفَّض طوله.
- **الطول/الحالة قبل البيع وكمية البيع** تُخزَّن في **`sales_invoice_lines.metadata.inventory`** (كائن يتضمن `prev_length_m`, `prev_status`, `qty_sold_m`, `final_length_m`, `final_status`) — مفيد لعكس الإلغاء وللتدقيق.
- **شرط قبل البيع:** إذا `roll.status !== 'AVAILABLE'` يُرفض التأكيد (`INVALID_STOCK`). إذن **لا يُفترض** تأكيد بيع على رول غير متاح — لكن الواجهة قد تعرض رولاً غير متاح إن جلبته من API بدون فلتر (انظر القسم 4–5).
- **خطر منطقي:** حالة `AVAILABLE` مع `length_m` قريب جداً من صفر دون بلوغ شرط `fullSale` تعتمد على التقريب؛ المنطق يستخدم `EPS` في `salesInvoiceService` (نفس الملف). أي انحراف تقريبي نادر قد يترك وضعاً غريباً — يستحق مراقبة في اختبارات لاحقة.

### إلغاء فاتورة مبيعات مؤكدة (`voidSalesInvoice` في نفس الملف)

- يقرأ `metadata.inventory` من سطر الفاتورة ويعيد **`length_m` و `status`** إلى `prev_length_m` و `prev_status`.
- يسجل حركة **`RETURN`** مع `reference_type` = **`SALES_INVOICE_VOID`**.

---

## 3) منطق الشراء وإنشاء الرول

**الملف:** `server/src/services/purchaseInvoiceService.ts` — `confirmPurchaseInvoice`.

- عند إنشاء رول جديد: `INSERT INTO fabric_rolls` مع **`status = 'AVAILABLE'`** صراحة في الـ VALUES.
- **`length_m`** يُشتق من كمية السطر: `lengthM = Math.max(0, quantityToMeters(...))` — أي **يسمح منطقياً بصفر** إذا كانت الكمية صفرية (مع وجود تحققات أخرى على مستوى الفاتورة حسب السياق).
- تُنشأ حركات مخزون استلام (`PURCHASE_RECEIPT` في المسارات المفعلة لـ `skipStockMovement`) — التفاصيل الكاملة في نفس الملف حول الربط بـ `purchase_invoice_id` / السطر بعد التأكيد.
- **لا يوجد عمود «طول أولي» منفصل** على الجدول؛ الطول الأولي = أول حركة موجبة + الطول الحالي أو يُستنتج من الحركات.

---

## 4) شاشات الواجهة (Frontend)

| الملف | السلوك المتعلق بالرول |
|--------|------------------------|
| `src/pages/Inventory.tsx` | يستدعي `listFabricRolls` مع `status` اختياري من `filterStatus` (افتراضياً **فارغ = لا فلتر حالة**). **لا يوجد فلتر `length_m > 0`**. إذن الرولات **`SOLD` وطول 0** تظهر إذا اختار المستخدم حالة «مباع» أو إن لم يُقيّد التصفية. الإحصائيات في الصفحة تجمع `length_m` من الصفحة المحمّلة فقط. |
| `src/pages/inventory/Transfers.tsx` | `listFabricRolls({ warehouseId, page, pageSize })` **بدون `status`** → تشمل أدواباً مباعة/غير متاحة ضمن النتائج إن وُجدت في المستودع. |
| `src/pages/inventory/Depreciation.tsx` | مثل التحويلات — **بدون فلتر حالة**. |
| `src/pages/inventory/StickerPrinting.tsx` | يستخدم `listFabricRolls(filters)` حسب فلاتر الشاشة (يجب مراجعة قيم `filters` في الملف للتفاصيل الدقيقة لكل خيار). |
| `src/pages/invoices/InvoiceForm.tsx` | **تحميل أولي:** `listFabricRolls({ status: 'AVAILABLE', pageSize: 10000 })` — جيد لقائمة «المتاح». **لكن:** `lookupStockFromAnywhere` يستدعي `listFabricRolls({ barcode })` أو `{ search }` **بدون `status`** — أي يمكن جلب رول **`SOLD` بطول 0** ودمجه في `apiRolls`. **`applyStockToLine` لا يتحقق من `status`**. عند الحفظ النهائي يوجد تحقق `qty > stockLen` يمنع الكمية أكبر من `length_m`؛ لرول مباع بطول 0 يمنع بيع كمية موجبة، **لكن** مسودة أو سلوك واجهة قد يسمح بإظهار الرول في الاقتراحات بعد الدمج. |
| `src/pages/ReturnInvoices.tsx` | المسار المرتبط بالفاتورة يعتمد على **`getSourceInvoiceForReturn`** وأسطر الفاتورة (تتضمن `fabric_roll_id`) — **لا يعتمد على قائمة «المتاح» فقط** من `listFabricRolls`. للسطور غير المرتبطة يوجد حقل `rollId` يدوي. |

**خلاصة واجهة:** «مخزون متاح» من ناحية المستخدم **غير مضمون** في كل الشاشات؛ جزء كبير يعتمد على فلتر الحالة الاختياري، وجزء حرج في فاتورة البيع هو **بحث السيرفر بدون `status`**.

---

## 5) واجهات API للرولات (Backend)

**البادئة المسجلة:** `server/src/app.ts` — `fabricRollRoutes` على **`/api/inventory/rolls`**.

### `GET /api/inventory/rolls` (`server/src/routes/fabricRollRoutes.ts`)

| Query | دعم |
|--------|-----|
| `search`, `barcode`, **`status`**, `warehouseId`, `locationId`, `itemId`, `colorId`, `variantId`, `supplierId`, `batchNo`, `containerNo`, `labelPrinted`, `purchaseScope`, `recentDays`, `sortBy`, `sortDir`, `page`, `pageSize` | نعم |
| **`includeSold` / `onlyAvailable` / `length_m` min** | **غير موجودة** كمعاملات مستقلة؛ التحكم يتم عبر **`status`** فقط. لا يوجد شرط SQL عام `length_m > 0` في قائمة الرولات. |

### مسارات أخرى مرتبطة بالمخزون (نفس الملف تقريباً)

- `GET /bulk-pricing/groups`, `PATCH /bulk-pricing` — تستخدم **`onlyAvailable`** في **جسم الطلب** (ليس query لقائمة الرول العامة) لتقييد بعض عمليات التسعير على `fr.status = 'AVAILABLE'`.
- `PATCH /:id`, `PATCH /:id/status`, نقل المستودع — تحتوي على قيود عند `SOLD`/`INACTIVE` في مسارات النقل (مثال: قراءة `cur.status === 'SOLD' || cur.status === 'INACTIVE'` في جزء النقل).

### تقارير المخزون (Reports API)

**الملف:** `server/src/routes/reportRoutes.ts`

| Method | Path | الدالة في `reportService.ts` |
|--------|------|-------------------------------|
| GET | `/api/reports/inventory/rolls` | `reportInventoryRolls` — عنوان التقرير: **«كشف أتواب المخزون»** |
| GET | `/api/reports/inventory/movements` | `reportInventoryMovements` — **«حركة الأتواب»** |
| GET | `/api/reports/inventory/by-warehouse` | `reportRollsByWarehouse` |
| GET | `/api/reports/inventory/by-item-color` | `reportRollsByItemColor` |

فلاتر `reportInventoryRolls` تشمل **`status`** اختيارياً (مساواة لحالة الرول)، وبحث ومستودع وخامة ولون وتاريخ إنشاء — **بدون** `includeZeroLength` كمعامل مستقل.

---

## 6) التقارير وكشف المخزون — كيف يُحسب «الطول الأصلي / المباع / المتبقي»؟

### أ) `reportInventoryRolls` (`reportService.ts`)

- يستخدم CTE `roll_lengths` من **`inventory_movements`**: يجمع الموجب في `positive_length_m` والسالب في `sold_length_m` (قيمة مطلقة للمجموع السلبي).
- يعرض أعمدة منها:
  - **`length_m` (مُسمّى في الأعمدة «الطول الأصلي»)** = تقدير من: إما `positive_length_m` غير الصفري، أو `fr.length_m + sold_length_m`، أو `fr.length_m`.
  - **`remaining_length_m`** = `fr.length_m` الحالي.
  - **`sold_length_m`** = الفرق بين التقدير أعلاه والمتبقي (بحد أدنى 0).

**النتيجة:** هذا التقرير **يحاول إظهار البيع تاريخياً** حتى للرول الذي أصبح طوله 0، **ما دامت** حركات `inventory_movements` صحيحة. **لا يُخفي** الرولات المباعة افتراضياً إلا إذا مرّر المستخدم `status` في الفلتر.

### ب) `reportInventoryMovements`

- يعرض كل حركة مع `length_delta_m` ومرجع الفاتورة — **لا يعتمد على إخفاء الرول المباع**؛ مناسب للتدقيق الزمني.

### ج) `reportRollsByWarehouse`

- `LEFT JOIN fabric_rolls` على المستودع: **`rolls_count` و `total_length_m` يشملان كل الأدواب** (المباع يضيف **0** للأمتار لكن يزيد العدد إن بقي الصف في الجدول).
- يعرض أيضاً **`active_count`** بعدّ الأدواب بحالات `AVAILABLE|RESERVED|TRANSFERRED` فقط — **فصل جزئي** بين «عدد كل الأدواب» و«النشطة».

### د) `reportRollsByItemColor`

- يجمّع `SUM(fr.length_m)` لكل خامة/لون — **المباع بالكامل لا يضيف أمتاراً** لكن قد يبقى في `rolls_count` إن كان الصف موجوداً.

### هـ) لوحات ومؤشرات أخرى

- `fetchExtendedDashboardSummary` في `reportService.ts`:  
  - `total_roll_length_m` = **`SUM(length_m)` على كل الرولات** → المباع الكامل يساهم بـ **0**.  
  - `active_fabric_rolls_count` يستثني `SOLD` و `INACTIVE` من «النشطة» بحسب التعريف المستخدم هناك.

- `reportOperationalPosition` في `reportServiceExtended.ts`: سطر «مخزون أقمشة» = **`SUM(length_m)` من كل الرولات** — يعادل **المتاح فعلياً بالأمتار** تقريباً، لكن **لا يفرّق أسماء التقارير** بين «متاح للبيع» و«كل السجلات».

### و) `reportServiceMore.ts`

- عدة استعلامات `SUM(fr.length_m)` و `COUNT` على `fabric_rolls` **بدون استثناء `SOLD`** في كثير من المواضع — **تعريف «المخزون» في كل تقرير يجب قراءته تقريراً تقريراً**؛ خلط محتمل بين «رصيد حالي» و«عدد سجلات أدواب».

---

## 7) المرتجعات (`returnInvoiceStockService.ts`)

### مرتجع مبيعات `SALES_RETURN`

- يقبل الرول إذا **`status` ∈ {`SOLD`, `AVAILABLE`}** فقط.
- يزيد `length_m` بكمية المرتجع؛ إذا كان الرول `SOLD` والكمية المرتجعة تعيد طولاً **> EPS** يصبح **`AVAILABLE`**، وإلا يبقى منطقياً قريباً من البيع الكامل بحسب التقريب.

### التحقق من التغطية

- `validateReturnStockLineCoverage`: **يمنع** سطراً بكمية صفر مع `fabricRollId`؛ وإذا وُجد أي سطر فيزيائي بكمية > 0 يجب أن يكون لكل الأسطر ذات الكمية رول.

### العلاقة بفاتورة المصدر

- الواجهة المرتبطة (`ReturnInvoices.tsx`) تعتمد على أسطر الفاتورة الأصلية وحقول الرول من الـ API — **لا تقتصر على `listFabricRolls` المتاح فقط** في المسار المرتبط.

**الخلاصة:** من ناحية الخادم، **إرجاع مخزون لرول `SOLD` بطول 0 مدعوم** ضمن الشروط أعلاه؛ الخطر الأكبر للمشروع ليس «عدم القدرة على الإرجاع» بل **اتساق واجهة اختيار الرول** في مسارات أخرى.

---

## 8) إخفاء مقابل حذف — الوضع الحالي

| السؤال | الجواب من الكود |
|--------|------------------|
| هل يُحذف الرول عند البيع؟ | **لا** — يُحدَّث `length_m` و`status` (وحركة `SALE`). |
| هل يُخفى تلقائياً من كل الشاشات؟ | **لا** — الإخفاء يعتمد على **فلتر الحالة/الاستعلام** في كل شاشة أو تقرير. |
| أين «يجب» الإخفاء وفق مطلب صاحب المشروع؟ | شاشات «المتوفر للبيع»، اختيار الرول في بيع جديد، تقارير «مخزون حالي» — **حالياً منفذ جزئياً** (بيع: تحميل أولي `AVAILABLE` + ثغرة البحث بدون `status`). |
| أين «يجب» البقاء؟ | فواتير، `inventory_movements`، مرتجعات مرتبطة، تقارير تاريخية/تدقيق — **البيانات موجودة**؛ دقة العرض تعتمد على اختيار التقرير والفلاتر. |

---

## 9) `fabric_item` مقابل الرول

- **الخامة** مستقلة عن «هل يوجد رول متاح»: تبقى في الكتالوج ما دامت `is_active` (واجهة الفاتورة تستورد `listFabricItems({ status: 'active' })` في `InvoiceForm.tsx`).
- **إخفاء المادة بالكامل** عند انعدام الرصيد **ليس مطبقاً تلقائياً** في الملفات المفحوصة — يحتاج سياسة منتج لاحقة (فلتر «لديها رصيد»).

---

## 10) تقييم ومخاطر (جدول)

| المنطقة | التقييم | السبب (من الكود) |
|---------|---------|-------------------|
| شاشة المخزون (`Inventory.tsx`) | **جزئي** | لا فلتر افتراضي على «متاح فقط» أو `length_m > 0`; يمكن عرض `SOLD`. |
| اختيار الرول في فاتورة بيع | **جزئي / خطر محدود** | التحميل الأولي `AVAILABLE`؛ لكن `lookupStockFromAnywhere` **بدون `status`** قد يجلب `SOLD`؛ `applyStockToLine` **لا يفحص الحالة**. التأكيد النهائي يمنع `qty > stockLen`. |
| تقرير «كشف أتواب المخزون» (`reportInventoryRolls`) | **جزئي / غالباً جيد للتاريخ** | يعيد بناء أطوال مباعة/متبقية عبر الحركات؛ **لا يخفي** المباع افتراضياً. |
| تقرير حركة المخزون | **آمن نسبياً** | يعرض الحركات كما هي. |
| المرتجعات (خادم) | **آمن نسبياً** | يدعم `SOLD` + زيادة الطول؛ تحقق من التغطية يمنع أخطاء شكلية. |
| الفواتير القديمة | **آمن** | السطور تحتفظ بـ `fabric_roll_id` و`metadata`. |
| لوحات `SUM(length_m)` الشاملة | **جزئي** | قد تُظهر «أمتار مخزون» منخفضة دون توضيح أنها «متاح فقط» — حسب التقرير. |

**هل يمكن بيع رول مباع مرتين؟**  
- عند التأكيد على الخادم: **لا** إذا بقي `status !== 'AVAILABLE'`.  
- **لكن** يمكن للواجهة عرض/دمج رول `SOLD` عبر البحث، مما يسبب ارتباكاً قبل أن يمنع الخادم التأكيد.

**هل `status` و `length_m` متزامنان دائماً؟**  
- في مسار البيع الكامل: **نعم** (`SOLD` + `0`).  
- في البيع الجزئي: **AVAILABLE** مع نقص الطول — متسق.  
- مسارات يدوية/تعديلات/تقريب: تستحق مراجعة اختبار حافة.

---

## 11) سياسة مقترحة (بدون تنفيذ)

1. **Current Available Inventory:** `status IN ('AVAILABLE', …)` حسب تعريفكم + **`length_m > 0`** + استبعاد المسودات المعلقة إن لزم.
2. **Historical / Movements:** الاعتماد على `inventory_movements` + عرض `metadata` في الفواتير عند الحاجة.
3. **Catalog (`fabric_items`):** يبقى كما هو؛ فلتر اختياري «لديها رصيد متاح».
4. **Sales roll picker:** كل استعلامات البحث/الباركود يجب أن تمرّ بـ **`status=AVAILABLE` و `length_m > 0`** (أو نسخة API `purpose=sale_picker`).
5. **Returns:** الإبقاء على الربط بسطر/رول الفاتورة الأصلية؛ عدم الاكتفاء بقائمة المتاح فقط.
6. **التقارير:** تفرقة صريحة بين تقرير «رصيد حالي قابل للبيع» وتقرير «جميع الأدواب بما فيها المباع» وتقرير «حركة تدقيق».

---

## 12) خطة تنفيذ لاحقة (مقترحة فقط)

1. **Backend:** معاملات واضحة مثل `stockScope=available|all|archived` أو `purpose`؛ توحيد استخدامها في `GET /api/inventory/rolls` والتقارير الحرجة.
2. **Frontend:** ضبط `lookupStockFromAnywhere` ومسارات السكانر لتستخدم نفس فلتر المتاح؛ إخفاء/تحذير عند `SOLD` أو `length_m=0`.
3. **التقارير:** إعادة تسمية/تقسيم تقارير `SUM(length_m)` التي تخلط العدد والطول؛ إضافة تقرير «أدواب مباعة» إن لزم.
4. **اختبارات:** السيناريو الذي طلبته (شراء 100 → بيع 100 → تحقق من عدم الظهور في المتاح، وظهور الحركة، مرتجع 20، إلخ).

---

## 13) ملفات وجداول متوقعة للمساس لاحقاً (مرجعية)

- **Migrations (اختياري لاحقاً):** فقط إذا قررتم أعمدة أرشيف صريحة — **حالياً غير مطلوب للتشخيص.**
- **Backend:** `server/src/routes/fabricRollRoutes.ts`, `server/src/services/reportService.ts`, `reportServiceMore.ts`, `reportServiceExtended.ts`, `server/src/services/salesInvoiceService.ts`, `returnInvoiceStockService.ts`.
- **Frontend:** `src/pages/Inventory.tsx`, `src/pages/inventory/Transfers.tsx`, `src/pages/inventory/Depreciation.tsx`, `src/pages/invoices/InvoiceForm.tsx`, `src/lib/api/fabricRollsApi.ts`, صفحات التقارير التي تستدعي `/api/reports/...`.

---

## الخلاصة التنفيذية

- **قاعدة البيانات:** الرول **يبقى**؛ البيع الكامل يجعل **`length_m = 0`** و **`status = 'SOLD`**؛ الطول الأصلي **غير مخزن كعمود** بل يُستنتج من **الحركات** و/أو **`metadata` على سطر الفاتورة**.
- **الواجهة:** «المتاح للبيع» **مُنفَّذ جزئياً**؛ أخطر فجوة: **بحث الرول في الفاتورة بدون فلتر `AVAILABLE`** مع **`applyStockToLine` بلا فحص حالة**.
- **التقارير:** تقرير **«كشف أتواب المخزون»** مصمم لإظهار **أصل/متبقي/مباع** عبر الحركات؛ تقارير أخرى تجمع **`SUM(length_m)`** على كل الرولات وتخلط الدلالة بين «عدد الأدواب» و«الأمتار الحالية» — يحتاج توضيح منتج/فلتر لاحق.

*نهاية التقرير التشخيصي.*
