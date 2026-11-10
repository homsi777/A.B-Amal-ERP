/** مشترك بين seed.ts وبعد التفعيل — مصدر واحد للأدوار والصلاحيات */

export const PERMISSIONS: { code: string; name: string; category: string }[] = [
  { code: 'dashboard.view', name: 'عرض لوحة التحكم', category: 'dashboard' },
  { code: 'inventory.view', name: 'عرض المخزون', category: 'inventory' },
  { code: 'inventory.manage', name: 'إدارة المخزون', category: 'inventory' },
  { code: 'suppliers.view', name: 'عرض الموردين', category: 'suppliers' },
  { code: 'suppliers.manage', name: 'إدارة الموردين', category: 'suppliers' },
  { code: 'customers.view', name: 'عرض العملاء', category: 'customers' },
  { code: 'customers.manage', name: 'إدارة العملاء', category: 'customers' },
  { code: 'purchases.view', name: 'عرض المشتريات', category: 'purchases' },
  { code: 'purchases.manage', name: 'إدارة المشتريات', category: 'purchases' },
  { code: 'reports.view', name: 'عرض التقارير', category: 'reports' },
  { code: 'settings.view', name: 'عرض الإعدادات', category: 'settings' },
  { code: 'settings.manage', name: 'إدارة الإعدادات', category: 'settings' },
  { code: 'users.manage', name: 'إدارة المستخدمين', category: 'users' },
  { code: 'payroll.view', name: 'عرض الرواتب', category: 'payroll' },
  { code: 'payroll.manage', name: 'إدارة الرواتب', category: 'payroll' },
  { code: 'payroll.approve', name: 'اعتماد كشوف الرواتب', category: 'payroll' },
  { code: 'payroll.disburse', name: 'صرف الرواتب', category: 'payroll' },
  { code: 'attendance.manage', name: 'إدارة الحضور والانصراف', category: 'attendance' },
  { code: 'attendance.approve', name: 'اعتماد كشف الانتظام الشهري', category: 'attendance' },
  { code: 'advances.manage', name: 'إدارة السلف', category: 'advances' },
  { code: 'advances.approve', name: 'اعتماد السلف', category: 'advances' },
];

export const ROLES = [
  { code: 'admin', name: 'مدير النظام' },
  { code: 'manager', name: 'مدير عمليات' },
  { code: 'inventory', name: 'مخزون' },
  { code: 'accountant', name: 'محاسب' },
  { code: 'viewer', name: 'مشاهد' },
];
