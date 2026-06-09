# تقرير المرحلة الثانية — بناء APIs البيانات الرئيسية وربط الواجهة بـ PostgreSQL

**نظام إدارة مستودعات الأقمشة (ERP)**
**تاريخ التنفيذ:** 2 مايو 2026
**الحالة:** ✅ مكتملة وتم التحقق منها

---

## 1. الملخص التنفيذي

تمثّل هذه المرحلة النقلة النوعية الأولى من البيانات الوهمية (Zustand mock) إلى البيانات الحقيقية المخزّنة في PostgreSQL على الـ VPS. تم تنفيذ الآتي:

- **8 مجموعات من نقاط النهاية** لجميع البيانات الرئيسية في المرحلة الثانية.
- **7 ملفات API gateway** في الواجهة الأمامية.
- **4 صفحات** تم ربطها بـ API الحقيقي بدلاً من Zustand.
- **صفحة جديدة** لتعريفات الأقمشة بثلاثة تبويبات.
- **هجرة قاعدة بيانات جديدة** `003_master_data_improvements.sql`.
- **31 اختبار API** تم تنفيذها جميعاً بنجاح ✅.
- `server:check` و `build` تمران دون أي أخطاء ✅.

---

## 2. الملفات المنشأة

### الخادم (Backend)

| الملف | الوصف |
|-------|-------|
| `server/src/db/migrations/003_master_data_improvements.sql` | هجرة قاعدة البيانات — إضافة `company_id` و `is_active` إلى `fabric_colors`، وفهارس البحث |
| `server/src/routes/supplierRoutes.ts` | CRUD الموردين |
| `server/src/routes/customerRoutes.ts` | CRUD العملاء |
| `server/src/routes/warehouseRoutes.ts` | CRUD المستودعات ومواقعها |
| `server/src/routes/fabricCategoryRoutes.ts` | CRUD التصنيفات + شجرة |
| `server/src/routes/fabricItemRoutes.ts` | CRUD الخامات |
| `server/src/routes/fabricColorRoutes.ts` | CRUD الألوان |
| `server/src/routes/fabricVariantRoutes.ts` | CRUD متغيرات الخامة |
| `server/_test_phase2_apis.py` | سكريبت اختبار 31 نقطة نهاية |

### الواجهة الأمامية (Frontend)

| الملف | الوصف |
|-------|-------|
| `src/lib/api/suppliersApi.ts` | واجهة API الموردين |
| `src/lib/api/customersApi.ts` | واجهة API العملاء |
| `src/lib/api/warehousesApi.ts` | واجهة API المستودعات والمواقع |
| `src/lib/api/fabricCategoriesApi.ts` | واجهة API التصنيفات |
| `src/lib/api/fabricItemsApi.ts` | واجهة API الخامات |
| `src/lib/api/fabricColorsApi.ts` | واجهة API الألوان |
| `src/lib/api/fabricVariantsApi.ts` | واجهة API المتغيرات |
| `src/pages/inventory/FabricMasterData.tsx` | صفحة تعريفات الأقمشة (جديدة) |

---

## 3. الملفات المعدّلة

| الملف | التعديل |
|-------|---------|
| `server/src/app.ts` | تسجيل 8 مجموعات routes جديدة |
| `src/pages/Suppliers.tsx` | ربط كامل بـ PostgreSQL API |
| `src/pages/Customers.tsx` | ربط كامل بـ PostgreSQL API |
| `src/pages/inventory/Warehouses.tsx` | ربط كامل بـ PostgreSQL API |
| `src/pages/inventory/Categories.tsx` | ربط كامل بـ PostgreSQL API + شجرة Miller |
| `src/App.tsx` | إضافة مسار `/inventory/fabric-master-data` |
| `src/layouts/DashboardLayout.tsx` | إضافة "تعريفات الأقمشة" في التنقل |
| `.gitignore` | إضافة `server/_test_phase2_apis.py` |

---

## 4. الهجرات المضافة

### `003_master_data_improvements.sql`

```sql
-- إضافة company_id و is_active إلى fabric_colors
ALTER TABLE fabric_colors
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- فهارس البحث النصي
CREATE INDEX IF NOT EXISTS idx_suppliers_name_search ON suppliers USING gin(to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_customers_name_search ON customers USING gin(to_tsvector('simple', name));
-- ...وفهارس B-tree للفلترة
```

**حالة التطبيق:** ✅ تم تطبيقها على VPS، تم اختبار الـ idempotency (تشغيل مزدوج ناجح)

---

## 5. نقاط النهاية المنفّذة

### الموردون `/api/suppliers`
| الطريقة | المسار | الوصف |
|---------|--------|-------|
| GET | `/api/suppliers` | قائمة مع بحث/فلترة/pagination |
| GET | `/api/suppliers/:id` | مورد واحد |
| POST | `/api/suppliers` | إنشاء مورد جديد |
| PUT | `/api/suppliers/:id` | تعديل مورد |
| PATCH | `/api/suppliers/:id/toggle-status` | تبديل الحالة |

### العملاء `/api/customers`
| الطريقة | المسار | الوصف |
|---------|--------|-------|
| GET | `/api/customers` | قائمة مع بحث/فلترة/pagination |
| GET | `/api/customers/:id` | عميل واحد |
| POST | `/api/customers` | إنشاء عميل |
| PUT | `/api/customers/:id` | تعديل عميل |
| PATCH | `/api/customers/:id/toggle-status` | تبديل الحالة |

### المستودعات `/api/warehouses`
| الطريقة | المسار | الوصف |
|---------|--------|-------|
| GET | `/api/warehouses` | قائمة المستودعات |
| GET | `/api/warehouses/:id` | مستودع واحد |
| POST | `/api/warehouses` | إنشاء مستودع |
| PUT | `/api/warehouses/:id` | تعديل مستودع |
| PATCH | `/api/warehouses/:id/toggle-status` | تبديل الحالة |
| GET | `/api/warehouses/:warehouseId/locations` | مواقع مستودع |
| POST | `/api/warehouses/:warehouseId/locations` | إضافة موقع |
| PUT | `/api/warehouse-locations/:id` | تعديل موقع |
| PATCH | `/api/warehouse-locations/:id/toggle-status` | تبديل الحالة |

### التصنيفات `/api/fabric/categories`
| الطريقة | المسار | الوصف |
|---------|--------|-------|
| GET | `/api/fabric/categories` | قائمة مسطّحة |
| GET | `/api/fabric/categories/tree` | شجرة متداخلة (فقط النشطة) |
| GET | `/api/fabric/categories/:id` | تصنيف واحد |
| POST | `/api/fabric/categories` | إنشاء تصنيف |
| PUT | `/api/fabric/categories/:id` | تعديل تصنيف |
| PATCH | `/api/fabric/categories/:id/toggle-status` | تبديل الحالة |

### الخامات `/api/fabric/items`
| الطريقة | المسار | الوصف |
|---------|--------|-------|
| GET | `/api/fabric/items` | قائمة مع بحث وفلاتر متعددة |
| GET | `/api/fabric/items/:id` | خامة واحدة مع أسماء التصنيف والمورد |
| POST | `/api/fabric/items` | إنشاء خامة |
| PUT | `/api/fabric/items/:id` | تعديل خامة |
| PATCH | `/api/fabric/items/:id/toggle-status` | تبديل الحالة |

### الألوان `/api/fabric/colors`
| الطريقة | المسار | الوصف |
|---------|--------|-------|
| GET | `/api/fabric/colors` | قائمة مع بحث وفلاتر |
| GET | `/api/fabric/colors/:id` | لون واحد |
| POST | `/api/fabric/colors` | إنشاء لون |
| PUT | `/api/fabric/colors/:id` | تعديل لون |
| PATCH | `/api/fabric/colors/:id/toggle-status` | تبديل الحالة |

### متغيرات الخامة `/api/fabric/variants`
| الطريقة | المسار | الوصف |
|---------|--------|-------|
| GET | `/api/fabric/variants` | قائمة مع بحث وفلاتر (itemId, colorId, widthCm, gsm) |
| GET | `/api/fabric/variants/:id` | متغير واحد مع أسماء الخامة واللون |
| POST | `/api/fabric/variants` | إنشاء متغير |
| PUT | `/api/fabric/variants/:id` | تعديل متغير |
| PATCH | `/api/fabric/variants/:id/toggle-status` | تبديل الحالة |

---

## 6. جداول قاعدة البيانات المستخدمة

| الجدول | الاستخدام |
|--------|-----------|
| `suppliers` | موردون مع كود وحيد لكل شركة |
| `customers` | عملاء مع كود وحيد لكل شركة |
| `warehouses` | مستودعات من المهاجرة 001 |
| `warehouse_locations` | مواقع المستودعات |
| `fabric_categories` | تصنيفات متشعبة بـ parent_id |
| `fabric_items` | خامات مع ربط بتصنيف ومورد |
| `fabric_colors` | ألوان (تمت إضافة company_id في 003) |
| `fabric_item_variants` | متغيرات خامة + لون + عرض + GSM |
| `companies` | الحقل company_id في جميع الجداول |

---

## 7. واجهات API الأمامية

تم إنشاء 7 ملفات gateway في `src/lib/api/`:

- `suppliersApi.ts` — `listSuppliers`, `createSupplier`, `updateSupplier`, `toggleSupplierStatus`
- `customersApi.ts` — CRUD العملاء
- `warehousesApi.ts` — CRUD المستودعات والمواقع
- `fabricCategoriesApi.ts` — `listCategories`, `getCategoryTree`, CRUD التصنيفات
- `fabricItemsApi.ts` — CRUD الخامات مع فلاتر متقدمة
- `fabricColorsApi.ts` — CRUD الألوان مع التحقق من صيغة hex
- `fabricVariantsApi.ts` — CRUD المتغيرات

جميعها تستخدم `apiFetch` من `src/lib/api/client.ts` الذي يُرفق JWT Token تلقائياً.

---

## 8. الصفحات المربوطة بـ PostgreSQL

| الصفحة | المسار | الحالة |
|--------|--------|--------|
| الموردون | `/suppliers` | ✅ مربوطة بالكامل + pagination + بحث + تعديل + تبديل الحالة |
| العملاء | `/customers` | ✅ مربوطة بالكامل + pagination + بحث + تعديل + تبديل الحالة |
| المستودعات | `/inventory/warehouses` | ✅ مربوطة — مستودع MAIN يظهر من seed |
| التصنيفات | `/inventory/categories` | ✅ مربوطة — واجهة Miller columns مع شجرة حقيقية |
| تعريفات الأقمشة | `/inventory/fabric-master-data` | ✅ صفحة جديدة — 3 تبويبات: خامات، ألوان، متغيرات |

---

## 9. ما تبقّى mock / Zustand

البيانات الآتية لا تزال تستخدم Zustand وستُعالَج في مراحل لاحقة:

| القسم | السبب |
|-------|-------|
| المخزون (أطواب الأقمشة) | يتطلب محرك مخزون + استيراد Excel |
| الفواتير | يتطلب محرك فاتورة كامل |
| الطلبيات | يتطلب نظام طلبيات |
| الخزينة والسندات | يتطلب نظام محاسبي |
| الرواتب والمصاريف | مرحلة متأخرة |
| شجرة الحسابات | يتطلب نظام محاسبة كامل |
| `mockInitialData` في `useStore.ts` | **لم تُحذف** كما هو مطلوب |

---

## 10. سلوك المصادقة والصلاحيات

- **جميع النقاط المطلوبة توثيقاً:** `preHandler: authenticateRequest` — إرجاع 401 بدون token.
- **نطاق الشركة:** كل عملية تُقيَّد بـ `companyId` المستخرج من JWT.
- **المدير (admin):** وصول كامل لجميع العمليات.
- **القارئ (viewer):** في هذه المرحلة يملك نفس الصلاحيات — تنفيذ نظام الأدوار الكامل مؤجّل.
- **حقن SQL:** جميع الاستعلامات تستخدم Parameterized queries ($1, $2...).
- **لا تسرّب لكلمات المرور:** لا يُرجع hash في أي استجابة.
- **رسائل الخطأ:** عربية وآمنة، لا تكشف تفاصيل قاعدة البيانات.

---

## 11. نتائج الاختبارات اليدوية عبر API

تم تنفيذ سكريبت `server/_test_phase2_apis.py` بالنتائج التالية:

| الاختبار | النتيجة |
|----------|---------|
| auth login | ✅ |
| auth has token | ✅ |
| supplier_create_201 | ✅ |
| supplier_has_id | ✅ |
| suppliers_list_200 | ✅ |
| suppliers_list_has_data | ✅ |
| supplier_get_200 | ✅ |
| supplier_update_200 | ✅ |
| supplier_name_updated | ✅ |
| supplier_toggle_200 | ✅ |
| supplier_is_inactive | ✅ |
| customer_create_201 | ✅ |
| customers_list_200 | ✅ |
| customer_update_200 | ✅ |
| warehouses_list_200 | ✅ |
| main_warehouse_exists | ✅ |
| warehouse_create_201 | ✅ |
| location_create_201 | ✅ |
| locations_list_200 | ✅ |
| location_exists | ✅ |
| category_create_201 | ✅ |
| child_category_create_201 | ✅ |
| category_tree_200 | ✅ |
| tree_has_data | ✅ |
| item_create_201 | ✅ |
| items_list_200 | ✅ |
| color_create_201 | ✅ |
| colors_list_200 | ✅ |
| color_invalid_hex_rejected | ✅ |
| variant_create_201 | ✅ |
| variants_list_200 | ✅ |

**الإجمالي: 31/31 اختبار ناجح ✅**

---

## 12. نتائج الاختبارات اليدوية على الواجهة

| الاختبار | التوقع | الحالة |
|----------|--------|--------|
| فتح /suppliers | تحميل قائمة من PostgreSQL | ✅ |
| إضافة مورد وتحديث | يظهر في القائمة بعد الحفظ | ✅ |
| تعديل مورد | يُحفظ التعديل في قاعدة البيانات | ✅ |
| تبديل حالة مورد | يتغير الوسم نشط/غير نشط | ✅ |
| فتح /customers | تحميل قائمة من PostgreSQL | ✅ |
| إضافة عميل | يظهر في القائمة | ✅ |
| فتح /inventory/warehouses | يظهر مستودع MAIN من seed | ✅ |
| إضافة مستودع | يُحفظ في قاعدة البيانات | ✅ |
| فتح /inventory/categories | شجرة تصنيفات من قاعدة البيانات | ✅ |
| إضافة تصنيف رئيسي وفرعي | يظهران في الشجرة | ✅ |
| فتح /inventory/fabric-master-data | ثلاثة تبويبات: خامات، ألوان، متغيرات | ✅ |
| إضافة خامة | تظهر في الجدول | ✅ |
| إضافة لون (مع سداسي لوني) | يعرض مربع اللون في المعاينة | ✅ |
| إضافة متغير (خامة + لون + عرض + GSM) | يُحفظ في قاعدة البيانات | ✅ |
| إعادة تحميل الصفحة | البيانات تثبت من PostgreSQL | ✅ |

---

## 13. نتائج البناء والفحص

```
npm run server:check   ✅ (تشغيل نظيف — صفر أخطاء TypeScript)
npm run server:migrate ✅ (003 طُبّقت — idempotency مؤكّدة)
npm run server:seed    ✅ (بيانات موجودة مسبقاً — لا تكرار)
npm run build          ✅ (frontend بُني بنجاح)
```

---

## 14. القيود المعروفة

1. **fabric_colors بدون company_id للبيانات القديمة:** البيانات التي أُنشئت قبل هجرة 003 لها `company_id = NULL`، وهي مرئية للجميع (قصدي للتوافق مع الإصدارات السابقة).
2. **صلاحيات viewer لم تُفرَّق:** في هذه المرحلة admin و viewer يملكان نفس الوصول — التنفيذ الكامل مؤجّل.
3. **كود المورد/العميل لا يُعدَّل بعد الإنشاء:** حماية من تكسير المراجع في الجداول الأخرى.
4. **لا pagination في المستودعات والتصنيفات:** أعدادها محدودة في الغالب، لا تستوجب pagination.
5. **صفحة تعريفات الأقمشة:** تحميل الخامات والألوان (200 سجل) لكل فتح تبويب المتغيرات — يجب تحسين ذلك بـ lazy loading في مرحلة لاحقة.
6. **الهجرة 003 لا تتوافق مع البيانات القديمة عند تفعيل unique constraint على fabric_colors:** لم يُضَف قيد unique على (company_id, color_code) لأن company_id قد يكون NULL للبيانات القديمة.

---

## 15. المرحلة الثالثة الموصى بها

| المهمة | الأولوية |
|--------|---------|
| **محرك مخزون الأطواب** — fabric_rolls، استيراد Excel، قيد المستودع | عالية جداً |
| **فواتير الشراء** — ربط الفواتير بالأطواب والموردين | عالية |
| **فواتير البيع** — إصدار فاتورة وإنقاص المخزون | عالية |
| **تقارير المخزون** — كشف أطواب، قيمة المخزون | متوسطة |
| **إكمال نظام الصلاحيات** — viewer مقابل admin مقابل manager | متوسطة |
| **إشعارات Telegram** — مخزون منخفض، طلبيات جاهزة | منخفضة |
| **تقسيم bundle** — code splitting لتحسين حجم JS | منخفضة |

---

*تقرير المرحلة الثانية — تم إنشاؤه تلقائياً بواسطة Cursor Agent*
*المشروع: نظام إدارة مستودعات الأقمشة (ERP)*
*التحقق: ضد PostgreSQL 16.13 على VPS Ubuntu 24.04 — 65.21.136.217*
