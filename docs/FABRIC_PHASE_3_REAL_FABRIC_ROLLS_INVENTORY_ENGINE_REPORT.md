# تقرير المرحلة الثالثة — محرك مخزون أتواب الأقمشة الحقيقي

**تاريخ الإنجاز:** السبت 2 مايو 2026  
**الحالة:** ✅ مكتملة بالكامل — 23/23 اختبار API ناجح

---

## 1. الملخص التنفيذي

تمّ في هذه المرحلة بناء محرك مخزون أتواب الأقمشة الحقيقي مرتبط بقاعدة بيانات PostgreSQL على الخادم الافتراضي (VPS). كل ثوب قماش أصبح الآن سجل مستقل في قاعدة البيانات يحمل:

- **باركود فريد** توليد تلقائي أو يدوي، مضمون الفرادة داخل الشركة.
- **بيانات تشغيلية كاملة**: الطول، العرض، GSM، الوزن المحسوب، الوزن الفعلي.
- **تتبع حركي كامل**: كل تغيير في الحالة، الموقع، أو الكمية يُسجَّل في جدول `inventory_movements`.
- **ربط بالبيانات الرئيسية**: الخامة، اللون، المتغير، المورد، المستودع، الموقع.
- **أرقام مرجعية للمستقبل**: رقم الدُفعة، رقم الحاوية، رقم فاتورة الشراء، مرجع ثوب المورد.

---

## 2. الملفات المُنشأة

| الملف | الوصف |
|-------|--------|
| `server/src/db/migrations/004_fabric_rolls_inventory_engine.sql` | ترحيل قاعدة البيانات — جدولا `fabric_rolls` و`inventory_movements` |
| `server/src/utils/rollHelpers.ts` | أداة حساب الوزن + توليد الباركود + التحقق من انتقالات الحالة |
| `server/src/routes/fabricRollRoutes.ts` | 7 مسارات API لمحرك الأتواب |
| `src/lib/api/fabricRollsApi.ts` | بوابة API للواجهة الأمامية مع أنواع TypeScript |
| `src/pages/inventory/CreateRoll.tsx` | صفحة إضافة ثوب جديد (`/inventory/rolls/new`) |
| `src/pages/inventory/RollDetails.tsx` | صفحة تفاصيل الثوب + سجل الحركات (`/inventory/rolls/:id`) |

---

## 3. الملفات المُعدَّلة

| الملف | التغيير |
|-------|---------|
| `server/src/app.ts` | استيراد وتسجيل `fabricRollRoutes` بالبادئة `/api/inventory/rolls` |
| `src/pages/Inventory.tsx` | إعادة كتابة كاملة — تعرض الآن أتواباً حقيقية من PostgreSQL |
| `src/App.tsx` | إضافة مسارات: `/inventory/rolls/new`، `/inventory/rolls/:id` |
| `.gitignore` | إضافة `server/_test_phase3_apis.py` |

---

## 4. تفاصيل الترحيل

### الترحيل: `004_fabric_rolls_inventory_engine.sql`
- **مطبَّق في:** السبت 2 مايو 2026 على قاعدة بيانات PostgreSQL 16 على VPS.
- **الحالة:** idempotent — آمن للتشغيل المتكرر.
- **لا يُغيِّر** جداول المراحل السابقة.

---

## 5. مخطط جدول `fabric_rolls`

```sql
CREATE TABLE fabric_rolls (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  roll_no              text,
  barcode              text        NOT NULL,
  item_id              uuid        NOT NULL REFERENCES fabric_items(id),
  color_id             uuid        REFERENCES fabric_colors(id),
  variant_id           uuid        REFERENCES fabric_item_variants(id),
  supplier_id          uuid        REFERENCES suppliers(id),
  warehouse_id         uuid        NOT NULL REFERENCES warehouses(id),
  location_id          uuid        REFERENCES warehouse_locations(id),
  length_m             numeric(14,3) NOT NULL DEFAULT 0,
  width_cm             numeric(14,2),
  gsm                  numeric(14,2),
  calculated_weight_kg numeric(14,3),
  actual_weight_kg     numeric(14,3),
  unit_cost            numeric(14,4),
  currency_code        text        REFERENCES currencies(code),
  batch_no             text,
  container_no         text,
  purchase_invoice_no  text,
  supplier_roll_ref    text,
  status               text        NOT NULL DEFAULT 'AVAILABLE',
  notes                text,
  created_by_user_id   uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, barcode)
);
```

**القيود:**
- `length_m >= 0`
- `width_cm > 0` عند التوفر
- `gsm > 0` عند التوفر
- `actual_weight_kg >= 0` عند التوفر
- الحالة: `AVAILABLE | RESERVED | SOLD | DAMAGED | TRANSFERRED | INACTIVE`

**الفهارس:** 12 فهرس لتسريع الفلترة والبحث.

---

## 6. مخطط جدول `inventory_movements`

```sql
CREATE TABLE inventory_movements (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  roll_id             uuid        NOT NULL REFERENCES fabric_rolls(id) ON DELETE CASCADE,
  movement_type       text        NOT NULL CHECK (movement_type IN (...)),
  from_warehouse_id   uuid        REFERENCES warehouses(id),
  to_warehouse_id     uuid        REFERENCES warehouses(id),
  from_location_id    uuid        REFERENCES warehouse_locations(id),
  to_location_id      uuid        REFERENCES warehouse_locations(id),
  old_status          text,
  new_status          text,
  length_delta_m      numeric(14,3),
  weight_delta_kg     numeric(14,3),
  reference_type      text,
  reference_id        uuid,
  reference_no        text,
  notes               text,
  created_by_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

**أنواع الحركة المتاحة:**
`OPENING | PURCHASE_RECEIPT | MANUAL_CREATE | TRANSFER_OUT | TRANSFER_IN | RESERVE | RELEASE_RESERVATION | SALE | RETURN | ADJUSTMENT | DAMAGE | STATUS_CHANGE`

---

## 7. قاعدة حساب الوزن

```
calculated_weight_kg = length_m × (width_cm ÷ 100) × (gsm ÷ 1000)
```

**مثال تحقق:**
```
length = 100 م
width  = 150 سم
gsm    = 150
weight = 100 × 1.5 × 0.15 = 22.5 كجم
```
✅ **تم التحقق:** الاختبار `weight_calculation_22_5` اجتاز بنجاح.

**قواعد:**
- إذا توفرت الثلاثة (الطول، العرض، GSM) — يُحسب `calculated_weight_kg` تلقائياً.
- لا يُستبدل `actual_weight_kg` بالقيمة المحسوبة.
- يُحفظ كلاهما في قاعدة البيانات.

---

## 8. نقاط نهاية API الخلفي

| الطريقة | المسار | الوصف |
|---------|--------|--------|
| `GET` | `/api/inventory/rolls` | قائمة الأتواب مع فلترة وترقيم صفحات |
| `GET` | `/api/inventory/rolls/:id` | تفاصيل ثوب واحد مع آخر 50 حركة |
| `POST` | `/api/inventory/rolls` | إنشاء ثوب جديد + حركة `MANUAL_CREATE` |
| `PUT` | `/api/inventory/rolls/:id` | تعديل بيانات الثوب الوصفية |
| `PATCH` | `/api/inventory/rolls/:id/status` | تغيير حالة الثوب + حركة `STATUS_CHANGE` |
| `POST` | `/api/inventory/rolls/:id/move` | نقل الثوب بين مستودعات/مواقع |
| `GET` | `/api/inventory/rolls/:id/movements` | سجل الحركات الكامل |

**فلاتر البحث والقائمة:**
`search, barcode, itemId, colorId, variantId, supplierId, warehouseId, locationId, status, batchNo, containerNo, page, pageSize`

**البحث النصي يشمل:** الباركود، رقم الثوب، اسم الخامة، الكود الداخلي، كود المورد، اسم اللون، كود اللون، مرجع ثوب المورد، رقم الدُفعة، رقم الحاوية.

---

## 9. بوابة API للواجهة الأمامية

**الملف:** `src/lib/api/fabricRollsApi.ts`

| الدالة | الوصف |
|--------|--------|
| `listFabricRolls(filters)` | قائمة مع فلترة |
| `getFabricRoll(id)` | تفاصيل + حركات |
| `createFabricRoll(payload)` | إنشاء ثوب |
| `updateFabricRoll(id, payload)` | تعديل |
| `updateFabricRollStatus(id, status, notes)` | تغيير الحالة |
| `moveFabricRoll(id, payload)` | نقل |
| `getFabricRollMovements(id)` | سجل الحركات |

**الأنواع المُصدَّرة:** `FabricRollDto`, `InventoryMovementDto`, `FabricRollListFilters`, `FabricRollCreatePayload`, `FabricRollUpdatePayload`, `RollStatus`

---

## 10. تغييرات صفحة المخزون

**الملف:** `src/pages/Inventory.tsx`

تم إعادة كتابة الصفحة بالكامل لاستخدام الـ API الحقيقي:

**الميزات الجديدة:**
- تحميل الأتواب من `/api/inventory/rolls` مع تحميل تدريجي وحالة فارغة.
- بحث نصي فوري (debounced) في الباركود، الخامة، اللون، الدُفعة.
- فلاتر: الحالة، المستودع.
- ترقيم صفحات (30 ثوب/صفحة) مع العدد الإجمالي.
- إحصائيات: إجمالي الأتواب، مجموع الأمتار، مجموع الكيلوغرامات.
- أزرار إجراءات لكل ثوب: عرض، تعديل، نقل، تغيير الحالة، طباعة لصاقة.
- نافذة تغيير الحالة المدمجة مع تحقق من صحة الانتقالات.
- شارات حالة بالعربية: متاح، محجوز، مباع، تالف، منقول، غير نشط.

---

## 11. واجهات إنشاء الثوب والتفاصيل والحركات

### صفحة إضافة ثوب جديد (`/inventory/rolls/new`)
**الملف:** `src/pages/inventory/CreateRoll.tsx`

- تحميل جميع البيانات الرئيسية تلقائياً (الخامات، الألوان، المتغيرات، الموردين، المستودعات).
- تصفية المتغيرات بحسب الخامة المختارة.
- تصفية المواقع بحسب المستودع المختار.
- عرض الوزن المحسوب في الوقت الفعلي.
- بعد الحفظ: الانتقال التلقائي لصفحة تفاصيل الثوب المُنشأ.

### صفحة تفاصيل الثوب (`/inventory/rolls/:id`)
**الملف:** `src/pages/inventory/RollDetails.tsx`

**تعرض:**
- معلومات الثوب الكاملة (الباركود، الخامة، اللون، المتغير، المورد).
- الأبعاد والموقع (الطول، العرض، GSM، الوزن المحسوب والفعلي، المستودع، الموقع).
- مراجع الشراء (رقم الدُفعة، الحاوية، فاتورة الشراء، مرجع ثوب المورد).
- جدول سجل الحركات الكامل.

**الإجراءات:**
- تعديل البيانات الوصفية (نافذة).
- نقل الثوب (نافذة مع تحميل مواقع المستودع الهدف).
- تغيير الحالة (نافذة).
- رابط طباعة لصاقة → `/inventory/labels`.

---

## 12. استراتيجية توليد الباركود

**التنسيق:** `ROLL-YYYYMMDD-NNNNNN`

**مثال:** `ROLL-20260502-943965`

**الضمانات:**
- يُولَّد من جانب الخادم فقط — الواجهة لا تُولِّد باركودات.
- يتحقق من قاعدة البيانات قبل القبول.
- يحاول 10 مرات مع رقم عشوائي مختلف.
- في حال الفشل (نادر جداً): يستخدم timestamp base36.
- القيد `UNIQUE(company_id, barcode)` في قاعدة البيانات يضمن الفرادة.
- يقبل باركود مُدخَل يدوياً (من مسح ضوئي مثلاً) ويرفض المكرر بـ 409.

---

## 13. قواعد التحقق

| الحقل | القيد | رسالة الخطأ العربية |
|-------|-------|---------------------|
| `itemId` | مطلوب | "الخامة مطلوبة." |
| `warehouseId` | مطلوب | "المستودع مطلوب." |
| `barcode` | فريد/شركة | "باركود الثوب موجود مسبقاً." |
| `locationId` | يتبع للمستودع | "الموقع المحدد لا يتبع هذا المستودع." |
| `lengthM` | >= 0 | "الطول يجب أن يكون رقماً موجباً أو صفراً." |
| `widthCm` | > 0 | "عرض التوب يجب أن يكون أكبر من صفر." |
| `gsm` | > 0 | "GSM يجب أن يكون أكبر من صفر." |
| DAMAGED→SOLD | ممنوع | "لا يمكن بيع ثوب تالف." |
| SOLD→AVAILABLE | ممنوع | "لا يمكن تحويل ثوب مباع إلى متاح مباشرة." |
| نقل ثوب مباع/غير نشط | ممنوع | "لا يمكن نقل ثوب مباع أو غير نشط." |

---

## 14. ما يبقى وهمياً (Zustand)

| الوحدة | السبب |
|--------|--------|
| `src/pages/inventory/CreateItem.tsx` | صفحة قديمة للبيانات الوهمية — محفوظة للتوافق |
| `src/pages/inventory/StickerPrinting.tsx` | تقرأ من Zustand — ستُربط بـ API في المرحلة 5 |
| الفواتير (مبيعات/مشتريات) | مرحلة مستقبلية |
| استيراد Excel | المرحلة 4 |
| رصيد العملاء/الموردين | مرحلة مستقبلية |

---

## 15. نتائج اختبارات API اليدوية

**التاريخ:** السبت 2 مايو 2026 — الاتصال بـ VPS عبر نفق SSH

```
============================================================
Phase 3 API Tests: Fabric Rolls Inventory Engine
============================================================

[AUTH] Login
  [OK]  login_200 | status=200

[PRE] Fetching prerequisite master data IDs
  [OK]  get_items | count=2
  [OK]  get_colors | count=3
  [OK]  get_warehouses | count=3
  [OK]  get_suppliers

[ROLLS] Create roll
  [OK]  create_roll_201 | status=201 barcode=ROLL-20260502-943965
  [OK]  weight_calculation_22_5 | calculatedWeightKg=22.5

[ROLLS] List and search
  [OK]  list_rolls_200 | total=1
  [OK]  search_by_barcode | found=1
  [OK]  filter_by_status | available=1

[ROLLS] Get roll by ID
  [OK]  get_roll_200 | barcode=ROLL-20260502-943965
  [OK]  roll_has_movements | movements_count=1

[ROLLS] Update metadata
  [OK]  update_roll_200 | status=200

[ROLLS] Status change
  [OK]  status_to_reserved_200 | status=200
  [OK]  new_status_is_reserved
  [OK]  status_to_damaged_200
  [OK]  reject_damaged_to_sold | status=400

[ROLLS] Duplicate barcode rejection
  [OK]  reject_duplicate_barcode_409 | status=409

[ROLLS] Move roll
  [OK]  move_roll_200 | status=200

[ROLLS] Movement history
  [OK]  get_movements_200 | count=5
  [OK]  movements_not_empty

[ROLLS] Validation errors
  [OK]  reject_invalid_location | status=400

RESULTS: 23/23 passed | 0 failed
============================================================
```

---

## 16. نتائج اختبارات واجهة المستخدم

**المتطلبات:** تشغيل `npm run dev` + نفق SSH إلى VPS

| الاختبار | النتيجة |
|---------|---------|
| فتح `/inventory` وتحميل البيانات الحقيقية | ✅ يعرض الأتواب من PostgreSQL |
| زر "إضافة ثوب جديد" → `/inventory/rolls/new` | ✅ يفتح الصفحة مع البيانات الرئيسية المحملة |
| إضافة ثوب مع الطول=100، العرض=150، GSM=150 | ✅ يظهر وزن محسوب 22.5 كجم |
| حفظ الثوب → انتقال لصفحة التفاصيل | ✅ |
| تحديث المتصفح → الثوب موجود | ✅ |
| البحث بالباركود | ✅ يظهر الثوب المطابق |
| فلتر بالحالة/المستودع | ✅ |
| فتح تفاصيل الثوب → عرض سجل الحركات | ✅ 5 حركات بعد تشغيل الاختبارات |
| نقل الثوب من مستودع لآخر | ✅ |
| تغيير الحالة مع رسالة تحقق | ✅ |

---

## 17. نتائج فحص البناء

```
npm run server:check  →  ✅ تمرير (0 أخطاء TypeScript)
npm run server:migrate → ✅ مُطبَّق
npm run build         →  ✅ بنجاح (2815 وحدة)
```

---

## 18. القيود المعروفة

1. **صفحة طباعة اللصاقات (`StickerPrinting.tsx`)** لا تزال تقرأ من Zustand — تحتاج ربط بـ `/api/inventory/rolls` في المرحلة 5.
2. **صفحة `CreateItem.tsx`** (المسار `/inventory/create`) لا تزال تكتب إلى Zustand — محفوظة بدون كسر.
3. **استيراد Excel** لا يزال يكتب إلى Zustand — المرحلة 4 ستعيد توجيهه لـ `fabric_rolls`.
4. **واجهة الأمتار والياردات** في صفحة المخزون القديمة: الحقل `meters/yards` لم يُحذف من Zustand لأن الفواتير تعتمد عليه.
5. **ترقيم الصفحات في إحصائيات المخزون**: إجمالي الأمتار والكيلوغرامات يحسب من الصفحة الحالية فقط (30 ثوباً)، وليس من كامل المخزون.

---

## 19. توصيات المرحلة 4

1. **ربط استيراد Excel بـ `fabric_rolls`**:
   - تعديل `excelInventoryImport.ts` ليستدعي `POST /api/inventory/rolls` لكل صف.
   - الحقول المُعدَّة: `batch_no`, `container_no`, `purchase_invoice_no`, `supplier_roll_ref`.

2. **ربط فواتير الشراء بـ `fabric_rolls`**:
   - عند تسجيل فاتورة شراء → إنشاء أتواب تلقائياً بحركة `PURCHASE_RECEIPT`.
   - ربط `purchase_invoice_no` بالفاتورة.

3. **ربط طباعة اللصاقات بـ `fabric_rolls`**:
   - تعديل `StickerPrinting.tsx` ليجلب الأتواب من `/api/inventory/rolls`.
   - طباعة باركود `ROLL-YYYYMMDD-NNNNNN` على كل لصاقة.

4. **فواتير البيع**:
   - عند تسجيل بيع → تغيير حالة الثوب إلى `SOLD` وإنشاء حركة `SALE`.

5. **لوحة إحصائيات المخزون**:
   - إضافة نقطة نهاية `GET /api/inventory/summary` لإجماليات كل المستودعات.

6. **بحث متقدم**:
   - واجهة متقدمة للبحث بمتعدد الفلاتر مع تصدير Excel.

---

*تم إنشاء هذا التقرير تلقائياً في نهاية المرحلة الثالثة بتاريخ السبت 2 مايو 2026.*
