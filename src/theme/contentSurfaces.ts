/**
 * أسطح المحتوى (بطاقات، جداول، حقول) — نهاري / ليلي
 * تُطبَّق مع لوحة الثيم حتى يتبنّى الوضع الليلي كامل الصفحات دون تعديل كل مكوّن.
 */
export const LIGHT_CONTENT_SURFACES: Record<string, string> = {
  '--surface-card': '#ffffff',
  '--surface-card-muted': '#f1f5f9',
  '--surface-input': '#ffffff',
  '--surface-hover': '#f8fafc',
  '--surface-table-row': '#ffffff',
  '--surface-table-row-alt': '#f8fafc',
  '--surface-summary-gradient-end': '#eff6ff'
};

export const DARK_CONTENT_SURFACES: Record<string, string> = {
  '--surface-card': '#1e293b',
  '--surface-card-muted': '#334155',
  '--surface-input': '#0f172a',
  '--surface-hover': '#334155',
  '--surface-table-row': '#1e293b',
  '--surface-table-row-alt': '#172554',
  '--surface-summary-gradient-end': 'color-mix(in oklab, var(--ui-accent) 26%, #1e293b)'
};
