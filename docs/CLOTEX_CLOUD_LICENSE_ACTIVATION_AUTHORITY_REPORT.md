# تقرير تحويل تفعيل CLOTEX إلى سلطة ترخيص سحابية على VPS

تاريخ التنفيذ: 2026-05-03

## 1. الملخص

تم استبدال نموذج التفعيل المحلي السابق بنموذج ترخيص سحابي يعتمد على الـ Backend API وقاعدة PostgreSQL على الـ VPS كسلطة الترخيص الوحيدة.

المعماريّة المعتمدة الآن:

`CLOTEX Frontend / Electron → Backend API على VPS → PostgreSQL على VPS → License Authority Tables`

النظام لم يعد يعتمد على ملف مفاتيح محلي مثل:

`server/generated/activation-keys.txt`

هذا الملف أزيل من بيئة العمل الحالية، و`server/generated/` بقي مستثنى من Git احتياطياً. توليد مفاتيح الإنتاج يتم الآن فقط من API إداري محمي، والمفاتيح الخام تظهر مرة واحدة في response التوليد فقط ولا تحفظ في قاعدة البيانات.

## 2. ماذا كان خطأ في النموذج المحلي

النموذج السابق كان مناسباً كبروتوتايب فقط لأنه:

- كان يولد 20 مفتاحاً تلقائياً أثناء `server:seed`.
- كان يكتب المفاتيح الخام إلى ملف محلي.
- كان يوحي أن التفعيل يمكن أن يعتمد على ملف داخل المشروع.
- لم يكن يحظر APIs الأعمال عند عدم التفعيل.
- لم يكن يحتوي سجل أحداث كامل لتوليد المفاتيح وإيقافها وفحص الحالة.

هذا لا يناسب مشروع CLOTEX لأنه مشروع cloud-first، وقاعدة البيانات والـ backend على VPS هي مصدر الحقيقة.

## 3. المعمارية الجديدة

القواعد النهائية:

- التفعيل والتحقق يتمان عبر Backend API فقط.
- PostgreSQL على VPS هي سلطة الترخيص.
- Electron والويب لا يتصلان بقاعدة البيانات مباشرة.
- لا يوجد `DATABASE_URL` أو `JWT_SECRET` أو `ACTIVATION_KEY_PEPPER` في الواجهة أو Electron.
- المفتاح الخام يولد من API إداري محمي ويظهر مرة واحدة فقط.
- قاعدة البيانات تحفظ `key_hash` و`key_suffix` فقط.
- كل مفتاح يستخدم مرة واحدة افتراضياً.
- APIs الأعمال تحظر عند عدم التفعيل إذا كان `ACTIVATION_REQUIRE_ACTIVE=true`.
- شاشة الدخول وAPI التفعيل تبقى متاحة دائماً حتى يمكن إدخال المفتاح.

## 4. الملفات التي تم إنشاؤها

- `server/src/db/migrations/010_cloud_license_authority_hardening.sql`
- `src/components/RequireActivation.tsx`
- `docs/CLOTEX_CLOUD_LICENSE_ACTIVATION_AUTHORITY_REPORT.md`

## 5. الملفات التي تم تعديلها

- `server/src/services/activationService.ts`
- `server/src/routes/activationRoutes.ts`
- `server/src/app.ts`
- `server/src/db/seed.ts`
- `server/src/config/env.ts`
- `server/.env.example`
- `server/.env` محلي فقط ومستثنى من Git.
- `src/lib/api/activationApi.ts`
- `src/components/activation/ActivationSettingsPanel.tsx`
- `src/App.tsx`
- `electron/types.ts`
- `electron/preload.ts`
- `electron/main.ts`
- `src/electron-env.d.ts`

## 6. تفاصيل Migration

تم إنشاء:

`server/src/db/migrations/010_cloud_license_authority_hardening.sql`

التعديلات على `activation_keys`:

- إضافة `created_by_user_id`.
- إضافة `revoked_by_user_id`.
- إضافة `revoked_at`.
- توسيع حالات المفتاح لتشمل:
  - `UNUSED`
  - `USED`
  - `REVOKED`
  - `EXPIRED`

التعديلات على `activation_events`:

- إضافة `device_fingerprint`.
- إضافة `app_version`.
- توسيع أنواع الأحداث لتشمل:
  - `KEY_GENERATED`
  - `ACTIVATION_SUCCESS`
  - `ACTIVATION_FAILED`
  - `DUPLICATE_ATTEMPT`
  - `REVOKED_ATTEMPT`
  - `EXPIRED_ATTEMPT`
  - `KEY_REVOKED`
  - `STATUS_CHECK`

تم إنشاء جدول اختياري:

`activation_devices`

الغرض:

- تتبع الجهاز الذي فعّل المفتاح.
- تخزين `device_fingerprint` مع بيانات خفيفة مثل اسم الجهاز ونظام التشغيل وإصدار التطبيق.
- عدم استخدام بصمة عتاد عميقة أو invasive fingerprinting.

## 7. متغيرات البيئة

تم اعتماد:

- `ACTIVATION_KEY_PEPPER`
- `ACTIVATION_GENERATE_DEV_KEYS=false`
- `ACTIVATION_REQUIRE_ACTIVE=true`

السلوك:

- `ACTIVATION_KEY_PEPPER` لا يعرض في الواجهة ولا Electron.
- إذا كان Pepper مفقوداً، فإن عمليات التوليد/التفعيل تفشل بأمان برسالة إعدادات خادم ناقصة.
- `ACTIVATION_GENERATE_DEV_KEYS` افتراضيه false، لذلك `server:seed` لا يولد مفاتيح إنتاج.
- `ACTIVATION_REQUIRE_ACTIVE=true` يفعّل حظر APIs الأعمال عند عدم التفعيل.

## 8. تدفق توليد المفاتيح

التوليد الرسمي الآن يتم عبر:

`POST /api/activation/keys/generate`

الشروط:

- يتطلب تسجيل دخول.
- يتطلب admin أو صلاحية `settings.manage`.
- يقبل:
  - `count`
  - `planCode`
  - `expiresAt`
  - `notes`
- يرجع المفاتيح الخام مرة واحدة فقط في response.
- لا يحفظ المفاتيح الخام.
- لا يطبع المفاتيح الخام في logs.
- يحفظ `key_hash` و`key_suffix`.
- يسجل حدث `KEY_GENERATED` لكل مفتاح مع suffix فقط.

## 9. تدفق التفعيل

المسار:

`POST /api/activation/activate`

السلوك:

1. يطبع المفتاح normalized format داخلياً بدون تسجيله.
2. يتحقق من الصيغة `XXXX.XXXX.XXXX.XXXX`.
3. يحسب hash باستخدام `ACTIVATION_KEY_PEPPER`.
4. يبحث عن المفتاح في PostgreSQL.
5. إذا غير موجود: يرجع خطأ آمن.
6. إذا مستخدم: يرجع `409 KEY_ALREADY_USED`.
7. إذا موقوف: يرجع `409 KEY_REVOKED`.
8. إذا منتهي: يرجع `409 KEY_EXPIRED`.
9. إذا صالح وغير مستخدم:
   - يزيد `activation_count`.
   - يغير الحالة إلى `USED` عند الوصول للحد.
   - يحفظ حالة التفعيل في `system_settings` تحت `activation.status`.
   - يسجل `ACTIVATION_SUCCESS`.
   - يخزن device info إن وجد.

## 10. حارس التفعيل

تمت إضافة حارس في:

`server/src/app.ts`

إذا كان:

`ACTIVATION_REQUIRE_ACTIVE=true`

والنظام غير مفعّل، يتم حظر APIs الأعمال برسالة:

```json
{
  "code": "SYSTEM_NOT_ACTIVATED",
  "message": "النظام غير مفعّل. يرجى إدخال مفتاح التفعيل."
}
```

المسموح قبل التفعيل:

- `/api/health`
- `/api/auth/login`
- `/api/auth/logout`
- `/api/auth/me`
- `/api/activation/status`
- `/api/activation/activate`
- كل مسارات `/api/activation` الإدارية عند وجود auth وصلاحية.

المحظور قبل التفعيل:

- العملاء.
- الموردون.
- المستودعات.
- المخزون.
- الاستيراد.
- اللصاقات.
- الإعدادات العامة.
- أي API أعمال تحت `/api/*` غير مستثنى.

## 11. إدارة المفاتيح من الإعدادات

قسم `تفعيل النظام` داخل إعدادات النظام بقي في مكانه، بدون صفحة علوية جديدة.

يدعم:

- عرض حالة التفعيل.
- عرض الخطة.
- عرض تاريخ التفعيل.
- عرض آخر 4 رموز فقط.
- إدخال مفتاح تفعيل عند عدم التفعيل.
- عرض قائمة مفاتيح masked.
- توليد مفاتيح جديدة عبر API.
- عرض المفاتيح الخام المولدة مرة واحدة فقط.
- إيقاف مفتاح.
- عرض سجل أحداث التفعيل.

تمت إضافة رسالة:

`انسخ المفاتيح الآن. لن تظهر مرة أخرى.`

## 12. تكامل شاشة الدخول

شاشة الدخول لم يتم إعادة تصميمها.

السلوك الحالي:

- إذا كان النظام غير مفعّل يظهر إدخال مفتاح التفعيل في نفس كرت الدخول.
- إذا كان النظام مفعّلاً تظهر شارة صغيرة:
  - `النظام مفعّل`
  - الخطة
  - آخر 4 رموز فقط.

بعد تسجيل الدخول، إذا كان النظام غير مفعّل، يوجه حارس الواجهة المستخدم إلى:

`/settings?tab=activation`

## 13. معلومات الجهاز في Electron

تمت إضافة API آمن في Electron:

`window.fabricApp.getDeviceInfo()`

يرجع:

- `deviceName`
- `osInfo`
- `appVersion`
- `deviceFingerprint`

طريقة `deviceFingerprint`:

- UUID يولد مرة واحدة.
- يحفظ في `app.getPath('userData')`.
- لا يعتمد على قراءة عتاد حساس.
- لا يحتوي أسراراً.

الواجهة ترسل هذه البيانات أثناء التفعيل إذا كانت تعمل داخل Electron. في المتصفح لا يتم إرسال fingerprint.

## 14. تنظيف التدفق المحلي القديم

تم تنفيذ التالي:

- إيقاف توليد 20 مفتاحاً تلقائياً أثناء `server:seed`.
- إبقاء التوليد التطويري فقط إذا تم ضبط:

`ACTIVATION_GENERATE_DEV_KEYS=true`

- إزالة ملف:

`server/generated/activation-keys.txt`

- الإبقاء على `server/generated/` داخل `.gitignore`.
- اعتماد admin API كتدفق رسمي لتوليد المفاتيح.

ملاحظة:

- مفاتيح DB الموجودة سابقاً يمكن أن تبقى كسجلات داخل PostgreSQL، لكنها لم تعد تأتي من ملف محلي رسمي.

## 15. API Endpoints

المسارات الحالية:

- `GET /api/activation/status`
- `POST /api/activation/activate`
- `GET /api/activation/keys`
- `POST /api/activation/keys/generate`
- `PATCH /api/activation/keys/:id/revoke`
- `GET /api/activation/events`
- `GET /api/activation/devices`

لا يوجد endpoint يعرض:

- المفتاح الخام بعد التوليد.
- `key_hash`.
- `ACTIVATION_KEY_PEPPER`.

## 16. نتائج اختبارات API

تم تنفيذ اختبار عملي عبر Fastify inject:

- `GET /api/activation/status` قبل التفعيل:
  - `200`
  - `active=false`
  - `requireActive=true`
- تسجيل دخول admin:
  - `200`
- طلب `/api/customers` قبل التفعيل:
  - `403 SYSTEM_NOT_ACTIVATED`
- توليد 3 مفاتيح عبر admin API:
  - `201`
  - الصيغة صحيحة.
- تفعيل مفتاح صحيح:
  - `200`
  - `active=true`
  - response يعرض suffix فقط.
- تفعيل نفس المفتاح:
  - `409 KEY_ALREADY_USED`
- طلب `/api/customers` بعد التفعيل:
  - `200`
- قائمة المفاتيح الإدارية:
  - لا تحتوي `key_hash`.
  - لا تحتوي المفتاح الخام.
- إيقاف مفتاح غير مستخدم:
  - `200 REVOKED`
- محاولة تفعيل مفتاح موقوف:
  - `409 KEY_REVOKED`
- مفتاح بصيغة خاطئة:
  - `400 INVALID_FORMAT`
- قائمة الأحداث:
  - تحتوي أحداثاً مسجلة.

## 17. نتائج اختبارات الأمان

تم التأكد من:

- لا يوجد `server/generated/activation-keys.txt`.
- لا توجد مفاتيح خام في `dist`.
- لا توجد قيمة Pepper الفعلية في `dist`.
- لا توجد `key_hash` في responses الإدارية.
- قاعدة البيانات لا تحتوي key_hash مطابقاً لصيغة مفتاح خام.
- `server/generated/` مستثنى من Git.
- Electron لا يحتوي `DATABASE_URL` أو `JWT_SECRET` أو VPS credentials كقيم سرية.

ملاحظة: تظهر كلمات مثل `JWT_SECRET` أو `DATABASE_URL` داخل نصوص توعوية/تعليقات أمنية، لكن لا تظهر القيم السرية نفسها.

## 18. نتائج الفحص والبناء

تم تشغيل:

- `npm run server:migrate` نجح وطبق migration 010.
- `npm run server:seed` نجح ولم يولد مفاتيح لأن التوليد التطويري معطل افتراضياً.
- `npm run server:check` نجح.
- `npm run lint` نجح.
- `npm run electron:compile` نجح.
- `npm run build` نجح.

تحذيرات build المتبقية:

- تحذير Vite عن حجم بعض chunks.
- تحذير xlsx عن dynamic/static import.

هذه التحذيرات لا تخص نظام الترخيص ولا تكسر البناء.

## 19. القيود المعروفة

- لا يوجد license server خارجي مستقل عن Backend المشروع، لأن المطلوب حالياً سلطة ترخيص داخل VPS backend.
- لا يوجد payment/subscription أو renewal workflow.
- لا يوجد hardware fingerprinting عميق، وتم اعتماد UUID محلي آمن في Electron فقط.
- في المتصفح لا توجد بصمة جهاز، وهذا مقبول لهذه المرحلة.
- عند عدم التفعيل، بعض صفحات الإعدادات قد تعرض رسالة تحميل إعدادات خادم لأن `/api/system/*` محظور؛ قسم التفعيل نفسه يعمل لأنه يستخدم `/api/activation/*`.

## 20. الحكم النهائي

تم تحويل نظام التفعيل إلى نموذج cloud-first مناسب لـ CLOTEX:

- Backend API على VPS هو سلطة الترخيص.
- PostgreSQL هو مصدر الحقيقة.
- التوليد المحلي التلقائي لم يعد التدفق الرسمي.
- توليد مفاتيح الإنتاج يتم من API إداري محمي فقط.
- المفاتيح الخام تظهر مرة واحدة فقط ولا تخزن.
- قاعدة البيانات تحفظ hashes فقط.
- المفتاح يستخدم مرة واحدة افتراضياً.
- المستخدم/العميل لا يستطيع دخول APIs الأعمال قبل التفعيل عند تفعيل الحارس.
- شاشة الدخول وقسم التفعيل في الإعدادات بقيا متاحين.
- Electron والويب لا يحملان أسراراً ولا يتصلان بقاعدة البيانات مباشرة.
