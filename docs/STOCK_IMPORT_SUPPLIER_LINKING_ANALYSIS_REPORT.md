# تحليل استيراد المخزون وربط المورد — تقرير تقني

## الوضع الحالي

### تدفق البيانات أثناء استيراد Excel

```
1. المستخدم يحدد supplierId مع ملف Excel
2. يُنشأ سجل في purchase_import_batches مع supplier_id
3. يُنشأ سجلات في purchase_import_rows لكل صف
4. عند المعالجة:
   - يُنشأ fabric_item مع supplier_id
   - يُنشأ fabric_roll مع supplier_id  
   - يُنشأ inventory_movement بدون ربط محاسبي
```

## المشكلة الموضحة

### ما يحدث فعلياً:
| العنصر | هل يتم إنشاؤه؟ | ملاحظات |
|--------|----------------|---------|
| **فاتورة شراء** | ❌ لا | لا يتم إنشاء purchase_invoice |
| **سند قبض** | ❌ لا | لا يتم إنشاء voucher |
| **سند دفع** | ❌ لا | لا يتم إنشاء payment |
| **حركة مخزون** | ✅ نعم | inventory_movements بـ OPENING status |
| **ربط مورد بالمنتج** | ✅ جزئياً | في fabric_items.supplier_id فقط |

### الجداول المتأثرة:
- `fabric_items.supplier_id` — يُحفظ ✅
- `fabric_rolls.supplier_id` — يُحفظ ✅  
- `inventory_movements` — لا يحتوي على purchase_invoice_id

## الشرح التقني

### 1. لماذا لا تظهر الفواتير؟

الكود في `stockImportJobService.ts` (السطر 548-575):
```typescript
// يُنشأ اللفافة (roll)
INSERT INTO fabric_rolls (..., supplier_id, ...)

// يُنشأ حركة مخزون
INSERT INTO inventory_movements (movement_type='OPENING', ...)
```

النظام لا يملك منطق لإنشاء:
- `purchase_invoices` 
- `purchase_invoice_lines`
- `vouchers` (سندات قبض/دفع)

### 2. ما معنى `sourceType`؟

| النوع | المعنى |
|-------|-------|
| `OPENING_STOCK` | مخزون افتتاحي — لا يُحسب كدين للمورد |
| `PURCHASE_INVOICE` | يجب إنشاء فاتورة شراء |
| `DIRECT_STOCK_IMPORT` | استيراد مباشر — لا علاقة محاسبية |

المشكل: حتى مع اختيار `supplierId`، النظام يستخدم `OPENING_STOCK` افتراضياً.

## الحلول المقترحة

### الحل الأول: إنشاء فاتورة شراء تلقائياً
```sql
-- عند اختيار supplier مع الاستيراد
INSERT INTO purchase_invoices (company_id, supplier_id, invoice_no, ...)
INSERT INTO purchase_invoice_lines (invoice_id, item_id, quantity, unit_price, ...)

-- ربط اللفافة بالفاتورة
UPDATE fabric_rolls SET purchase_invoice_id = $invoice_id
```

### الحل الثاني: تعديل `sourceType` لتكون `PURCHASE_INVOICE`
- عند اختيار supplier → يجب اختيار sourceType = `PURCHASE_INVOICE`
- النظام يتحقق: إذا كان هناك supplier → إنشاء فاتورة

## خلاصة التقرير

**المشكل:** ربط المورد أثناء الاستيراد هو تسمية مجردة بلا علاقة محاسبية.

**التوصية:** إما:
1. تغيير سلوك الاستيراد لإنشاء فاتورة شراء، أو
2. توضيح أن الاستيراد ليس تبادلاً محاسبياً ويجب إنشاء الفواتير يدوياً