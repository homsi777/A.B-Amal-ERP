/** وضع الشركة: بدون بيع/شراء حسب اللون — إخفاء حقول وأعمدة اللون من الواجهة */
export const HIDE_FABRIC_COLOR_UI = true;

/** بيع جملة: فاتورة البيع بالخامة + عدد الأتواب + السعر فقط (بدون باركود لكل توب) */
export const WHOLESALE_SALES_MODE = true;

export const FABRIC_CATEGORY_LEVEL_LABELS = HIDE_FABRIC_COLOR_UI
  ? (['اسم خامة', 'كود الخامة'] as const)
  : (['اسم خامة', 'كود الخامة', 'اللون', 'كود اللون'] as const);

export const FABRIC_CATEGORY_MAX_COLUMNS = FABRIC_CATEGORY_LEVEL_LABELS.length;

/** عدد أعمدة جدول المخزون (بدون عمود التحديد الجماعي) */
export const INVENTORY_TABLE_COLUMN_COUNT = HIDE_FABRIC_COLOR_UI ? 7 : 9;
