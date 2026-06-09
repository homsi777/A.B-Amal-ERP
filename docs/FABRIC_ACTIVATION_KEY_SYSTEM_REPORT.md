# تقرير نظام مفاتيح التفعيل لمستودعات الأقمشة

تاريخ التنفيذ: 2026-05-03

## 1. الملخص

تم بناء نظام تفعيل محلي بسيط لمشروع Fabric Warehouse ERP يعتمد على مفاتيح مرة واحدة بصيغة:

`XXXX.XXXX.XXXX.XXXX`

النظام يحفظ تجزئة المفتاح فقط في قاعدة البيانات، ولا يحفظ المفتاح الخام، ولا يعرض التجزئة أو المفاتيح كلها في الواجهة. تم توليد 20 مفتاحاً أولياً وحفظ النسخة الخام في ملف محلي مستثنى من Git للمالك فقط.

تمت إضافة إدخال التفعيل في:

- شاشة تسجيل الدخول.
- إعدادات النظام داخل قسم `تفعيل النظام`.

لم يتم تغيير مسار تسجيل الدخول أو كسر المصادقة الحالية أو Electron أو build الويب.

## 2. الملفات التي تم إنشاؤها

- `server/src/db/migrations/009_activation_keys.sql`
- `server/src/services/activationService.ts`
- `server/src/routes/activationRoutes.ts`
- `src/lib/api/activationApi.ts`
- `src/components/activation/ActivationKeyInput.tsx`
- `src/components/activation/ActivationSettingsPanel.tsx`
- `docs/FABRIC_ACTIVATION_KEY_SYSTEM_REPORT.md`
- `server/generated/activation-keys.txt` ملف محلي خاص بالمالك وموجود داخل مسار مستثنى من Git.

## 3. الملفات التي تم تعديلها

- `.gitignore`
- `server/.env.example`
- `server/.env` محلي فقط ومستثنى من Git.
- `server/src/config/env.ts`
- `server/src/app.ts`
- `server/src/db/seed.ts`
- `src/pages/Login.tsx`
- `src/pages/SystemSettings.tsx`

## 4. تفاصيل Migration

تم إنشاء migration:

`server/src/db/migrations/009_activation_keys.sql`

### جدول `activation_keys`

الحقول الأساسية:

- `id`
- `company_id`
- `key_hash`
- `key_suffix`
- `status`
- `plan_code`
- `max_activations`
- `activation_count`
- `activated_company_id`
- `activated_by_user_id`
- `activated_at`
- `expires_at`
- `notes`
- `created_at`
- `updated_at`

القيود:

- `key_hash` فريد.
- الحالات المسموحة: `UNUSED`, `USED`, `REVOKED`.
- الخطط المسموحة: `LITE`, `PRO`, `FULL`.
- `activation_count <= max_activations`.

### جدول `activation_events`

الغرض منه تسجيل محاولات التفعيل بدون تسجيل المفتاح الخام.

الأحداث المدعومة:

- `ACTIVATION_SUCCESS`
- `ACTIVATION_FAILED`
- `DUPLICATE_ATTEMPT`
- `REVOKED_ATTEMPT`

البيانات المسجلة لا تحتوي المفتاح كاملاً، فقط `key_suffix`.

## 5. صيغة المفتاح

الصيغة المعتمدة:

`XXXX.XXXX.XXXX.XXXX`

التحقق يتم عبر Regex:

`^[A-Z0-9]{4}\.[A-Z0-9]{4}\.[A-Z0-9]{4}\.[A-Z0-9]{4}$`

التطبيع قبل التحقق:

- إزالة الفراغات.
- تحويل الأحرف إلى uppercase.
- استبدال `-` بـ `.`.
- إزالة الفراغات العرضية داخل النص.

واجهة الإدخال تضيف النقاط تلقائياً عند إدخال 16 رمزاً.

## 6. التجزئة والتخزين

تم تنفيذ التجزئة في:

`server/src/services/activationService.ts`

السلوك:

- استخدام SHA-256.
- استخدام Pepper خادمي من `ACTIVATION_KEY_PEPPER`.
- عدم تخزين المفتاح الخام في قاعدة البيانات.
- عدم إرجاع `key_hash` في أي response للواجهة.
- عدم طباعة المفتاح الخام في السجلات.

تمت إضافة المتغير إلى:

- `server/.env.example`
- `server/.env` المحلي بقيمة قوية مولدة محلياً.

ملاحظة مهمة:

- إذا تغير `ACTIVATION_KEY_PEPPER` بعد توليد المفاتيح، فلن تعمل المفاتيح القديمة لأن التجزئة ستتغير.

## 7. توليد 20 مفتاحاً أولياً

تم تحديث `server/src/db/seed.ts` بحيث:

- عند عدم وجود أي مفاتيح في `activation_keys` يتم توليد 20 مفتاحاً.
- يتم تخزين التجزئات فقط في قاعدة البيانات.
- يتم حفظ المفاتيح الخام في:

`server/generated/activation-keys.txt`

هذا المسار تمت إضافته إلى `.gitignore`:

`server/generated/`

النتيجة النهائية بعد إعادة التهيئة:

- عدد المفاتيح: 20.
- الحالة: كل المفاتيح `UNUSED`.
- لا يوجد مفتاح خام داخل `key_hash`.

## 8. API Endpoints

تم تسجيل المسارات تحت:

`/api/activation`

المسارات:

- `GET /api/activation/status`
- `POST /api/activation/activate`
- `GET /api/activation/keys`
- `POST /api/activation/keys/generate`
- `PATCH /api/activation/keys/:id/revoke`

السلوك الأمني:

- `status` متاح بدون تسجيل دخول حتى يظهر في شاشة الدخول.
- `activate` متاح بشكل محدود بدون تسجيل دخول مع guard بسيط داخل الذاكرة ضد كثرة المحاولات.
- قائمة المفاتيح والتوليد والإيقاف تتطلب صلاحية admin أو `settings.manage`.
- لا يوجد endpoint يرجع `key_hash`.

## 9. تكامل شاشة الدخول

تم تعديل:

`src/pages/Login.tsx`

الإضافة تمت داخل نفس كرت تسجيل الدخول بدون إعادة تصميم الشاشة.

السلوك:

- إذا كان النظام غير مفعّل، يظهر إدخال مفتاح التفعيل.
- إذا كان النظام مفعّلاً، تظهر شارة صغيرة:

`النظام مفعّل`

مع الخطة وآخر 4 رموز فقط.

تسجيل الدخول بقي كما هو:

- لم يتم تغيير `loginApi`.
- لم يتم تغيير token storage.
- لم يتم حظر الدخول أو إعادة توجيه جديدة.

## 10. تكامل إعدادات النظام

تم تعديل:

`src/pages/SystemSettings.tsx`

تمت إضافة قسم داخل إعدادات النظام:

`تفعيل النظام`

بدون إنشاء صفحة top-level جديدة.

القسم يعرض:

- حالة التفعيل.
- الخطة.
- تاريخ التفعيل.
- آخر 4 رموز من المفتاح.
- إدخال مفتاح التفعيل إذا كان النظام غير مفعّل.
- قائمة إدارة مفاتيح masked.
- توليد مفاتيح جديدة.
- إيقاف مفتاح.

## 11. Frontend API Gateway

تم إنشاء:

`src/lib/api/activationApi.ts`

الدوال:

- `getActivationStatus`
- `activateProject`
- `listActivationKeys`
- `generateActivationKeys`
- `revokeActivationKey`

الأنواع:

- `ActivationStatusDto`
- `ActivationKeyAdminDto`
- `ActivateResultDto`

## 12. مكوّن الإدخال الموحد

تم إنشاء:

`src/components/activation/ActivationKeyInput.tsx`

الميزات:

- تحويل تلقائي إلى uppercase.
- تنسيق تلقائي إلى `XXXX.XXXX.XXXX.XXXX`.
- تحقق من الصيغة.
- رسائل عربية.
- حالة تحميل.
- حالة نجاح.

يستخدم في:

- شاشة الدخول.
- إعدادات النظام.

## 13. اختبارات API اليدوية

تم اختبار المسارات داخلياً عبر Fastify inject بدون طباعة المفاتيح الخام:

- `GET /api/activation/status` قبل التفعيل رجع `active=false`.
- `POST /api/activation/activate` بمفتاح صحيح نجح ورجع `active=true`.
- تفعيل نفس المفتاح مرة ثانية رجع `409 KEY_ALREADY_USED`.
- تفعيل صيغة خاطئة رجع `400 INVALID_FORMAT`.
- تسجيل دخول admin نجح.
- `GET /api/activation/keys` رجع 20 مفتاحاً masked فقط.
- لم تظهر `key_hash` في response.
- لم يظهر المفتاح الخام في response.
- إيقاف مفتاح غير مستخدم نجح.
- محاولة استخدام مفتاح موقوف رجعت `409 KEY_REVOKED`.

بعد الاختبار تم إعادة تهيئة حالة المفاتيح النهائية بحيث تبقى 20 مفتاحاً أولياً `UNUSED` للمالك.

## 14. اختبارات الواجهة اليدوية

تم التحقق برمجياً من البناء والدمج:

- شاشة الدخول تحتوي مكوّن التفعيل بدون تغيير نموذج الدخول.
- إعدادات النظام تحتوي قسم `تفعيل النظام`.
- الإدخال يعالج uppercase والتنسيق.
- حالة النظام المفعّل تظهر كشارة مختصرة.
- إدارة المفاتيح لا تعرض إلا آخر 4 رموز.

لم يتم فتح المتصفح يدوياً في هذه المرحلة، لكن build نجح بعد دمج الواجهة.

## 15. اختبارات الأمان

تم تنفيذ:

`rg -n "ACTIVATION_KEY_PEPPER|key_hash|activation-keys|[A-Z0-9]{4}\\.[A-Z0-9]{4}\\.[A-Z0-9]{4}\\.[A-Z0-9]{4}" dist src server --glob '!server/generated/**' -S`

النتيجة:

- ظهرت أسماء المتغيرات والكود والمثال `XXXX.XXXX.XXXX.XXXX`.
- لم تظهر المفاتيح الخام المولدة داخل `dist`.
- لم تظهر التجزئات في واجهة الإدارة.

تم أيضاً فحص مفاتيح `server/generated/activation-keys.txt` ضد `dist`:

- عدد المفاتيح الخام في الملف: 20.
- عدد التسريبات داخل `dist`: 0.

قاعدة البيانات:

- `activation_keys` تحتوي 20 صفاً.
- كل الحالات النهائية `UNUSED`.
- لا يوجد `key_hash` مطابق لصيغة مفتاح خام.

## 16. نتائج الفحص والبناء

تم تشغيل:

- `npm run server:migrate` نجح.
- `npm run server:seed` نجح.
- `npm run server:check` نجح.
- `npm run lint` نجح.
- `npm run build` نجح.

ملاحظات build:

- بقي تحذير Vite القديم عن حجم بعض chunks.
- بقي تحذير xlsx القديم حول dynamic/static import.
- هذه التحذيرات لا تكسر build ولا تخص نظام التفعيل.

## 17. قيود معروفة

- لا يوجد license server خارجي، وهذا مقصود في هذه المرحلة.
- لا يوجد device fingerprinting أو hardware binding، وهذا مقصود.
- لا يتم حظر كل مسارات التطبيق قبل التفعيل، لأن المطلوب كان إدخال التفعيل بدون كسر الدخول أو التدفقات الحالية.
- rate limit الحالي بسيط داخل الذاكرة، مناسب محلياً كبداية وليس بديلاً عن rate limit موزع في بيئة إنتاج متعددة السيرفرات.
- يجب الحفاظ على `ACTIVATION_KEY_PEPPER` وعدم تغييره بعد توزيع المفاتيح.

## 18. الحكم النهائي

تم تنفيذ نظام مفاتيح التفعيل المحلي حسب المطلوب:

- الصيغة `XXXX.XXXX.XXXX.XXXX` معتمدة.
- تم توليد 20 مفتاحاً أولياً.
- كل مفتاح يستخدم مرة واحدة.
- قاعدة البيانات تحفظ hash فقط.
- المفاتيح الخام محفوظة في ملف محلي مستثنى من Git.
- الواجهة لا تعرض hashes.
- شاشة الدخول تحتوي إدخال/حالة التفعيل.
- إعدادات النظام تحتوي قسم تفعيل وإدارة masked.
- التكرار والمفاتيح الموقوفة والصيغ الخاطئة مرفوضة بأخطاء آمنة.
- أوامر الفحص والبناء نجحت.
