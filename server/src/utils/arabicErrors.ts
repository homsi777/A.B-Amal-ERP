/** رسائل آمنة للواجهة (بدون تفاصيل قاعدة البيانات) */

export const ArabicErrors = {
  unauthorized: 'يجب تسجيل الدخول للمتابعة.',
  forbidden: 'غير مصرح بتنفيذ هذا الإجراء.',
  /** قاعدة بيانات بدون مستخدمين — بعد migrate/التفعيل الأول يجب تشغيل server:seed */
  noUsersYet:
    'لم يُنشَأ أي مستخدم بعد. على مسؤول الخادم تشغيل تهيئة النظام من مجلد المشروع: npm run server:seed ثم تسجيل الدخول (افتراضي التطوير: admin / admin123 إن لم يُعرّف SEED_ADMIN_PASSWORD).',
  invalidCredentials: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
  userInactive: 'هذا الحساب غير مفعّل.',
  tokenInvalid: 'رمز الجلسة غير صالح أو منتهٍ.',
  validation: 'البيانات المرسلة غير صالحة.',
  server: 'حدث خطأ في الخادم. حاول لاحقاً.',
  database: 'تعذر الاتصال بقاعدة البيانات.',
} as const;

export function mapPgError(_err: unknown): string {
  return ArabicErrors.server;
}
