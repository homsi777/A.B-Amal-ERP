/** اسم مستخدم وكلمة مرور المدير في البذرة / التهيئة التلقائية بعد التفعيل */

export const DEFAULT_ADMIN_USERNAME = 'بشیر';

export function resolveAdminPassword(): string {
  const fromEnv = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `SEED_ADMIN_PASSWORD مطلوب في الإنتاج. عيّن كلمة مرور قوية للمستخدم ${DEFAULT_ADMIN_USERNAME} (لا تُكتب في السجلات).`,
    );
  }

  console.warn(
    `[env] تنبيه (تطوير): لم يُعرّف SEED_ADMIN_PASSWORD — استخدام 101010 للتطوير المحلي فقط (المستخدم: ${DEFAULT_ADMIN_USERNAME}).`,
  );
  return '101010';
}
