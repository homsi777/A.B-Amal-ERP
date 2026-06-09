/** كلمة مرور المستخدم admin في البذرة / التهيئة التلقائية بعد التفعيل */

export function resolveAdminPassword(): string {
  const fromEnv = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SEED_ADMIN_PASSWORD مطلوب في الإنتاج. عيّن كلمة مرور قوية للمستخدم admin (لا تُكتب في السجلات).',
    );
  }

  console.warn(
    '[env] تنبيه (تطوير): لم يُعرّف SEED_ADMIN_PASSWORD — استخدام admin123 للتطوير المحلي فقط.',
  );
  return 'admin123';
}
