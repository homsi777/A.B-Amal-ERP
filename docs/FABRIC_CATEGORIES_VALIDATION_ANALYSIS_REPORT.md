# تقرير تنفيذ - تعديل منطق التحقق في قسم تصنيفات الأقمشة

## ملخص التغييرات المنجزة

### 1. Migration جديد: `026_allow_duplicate_codes.sql`
```sql
-- إزالة القيد العالمي على الكود
DROP INDEX IF EXISTS fabric_categories_company_id_code_key;

-- إبقاء فهارس للبحث السريع (بدون uniqueness)
CREATE INDEX IF NOT EXISTS idx_fabric_categories_code_lookup 
ON fabric_categories(company_id, code);
```

### 2. تعديل `fabricCategoryRoutes.ts`

#### POST `/` - عند إنشاء تصنيف جديد
```typescript
// Check for duplicate material code within same parent only
if (d.parent_id && d.code && d.code.trim() !== '') {
  const parentCheck = await pool.query(
    `SELECT id FROM fabric_categories WHERE company_id = $1 AND parent_id = $2 AND code = $3 LIMIT 1`,
    [companyId, d.parent_id, d.code.trim()],
  );
  if (parentCheck.rows.length) {
    return sendError(reply, 409, 'كود الخامة موجود مسبقاً ضمن اسم الخامة نفسه', 'DUPLICATE');
  }
}
```

#### PUT `/:id` - عند تعديل تصنيف
```typescript
// Check for duplicate material code within same parent (excluding current record)
if (d.parent_id && d.code && d.code.trim() !== '') {
  const parentCheck = await pool.query(
    `SELECT id FROM fabric_categories WHERE company_id = $1 AND parent_id = $2 AND code = $3 AND id != $4 LIMIT 1`,
    [companyId, d.parent_id, d.code.trim(), id],
  );
  if (parentCheck.rows.length) {
    return sendError(reply, 409, 'كود الخامة موجود مسبقاً ضمن اسم الخامة نفسه', 'DUPLICATE');
  }
}
```

#### POST `/sync-from-materials` - عند المزامنة التلقائية
- تم تعديل دالة `ensureCategory` للتحقق من التكرار ضمن الوالد فقط (وليس عالمياً)
- اللون والكود اللوني يسمح بالتكرار بين جميع الخامات

---

## القواعد النهائية بعد التنفيذ

| العنصر | مسموح؟ | ملاحظات |
|--------|-------|---------|
| **كود اللون** | ✅ نعم | يمكن التكرار بين الخامات المختلفة |
| **اللون** | ✅ نعم | يمكن التكرار بين الخامات المختلفة |
| **كود الخامة** | ⚠️ جزئياً | ممنوع التكرار ضمن اسم خامة واحد، لكن مسموح بين خامات مختلفة |
| **اسم الخامة** | ✅ نعم | يمكن التكرار |

---

## مثال عملي

بإمكانك الآن:
1. إنشاء خامة "كتان"
2. إضافة كود خامة "101" للكتان
3. إضافة كود خامة "102" لنفس الكتان (مسموح)
4. إنشاء خامة "صوف" وإضافة كود خامة "101" له (مسموح - خامة مختلفة)
5. إضافة لون "أبيض" وكود اللون "1" لكل خامة (مسموح بالتكرار)