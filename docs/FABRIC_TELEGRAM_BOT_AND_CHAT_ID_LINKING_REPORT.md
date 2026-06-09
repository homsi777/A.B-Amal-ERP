# تقرير تأسيس بوت تيليغرام وربط Chat ID

تاريخ التنفيذ: 2026-05-03

## 1. الملخص

تم تجهيز أساس موثوق لإعدادات بوت تيليغرام داخل نظام إدارة مستودعات الأقمشة، مع آلية جلب ذكية لـ Chat ID من تحديثات البوت، وربط المحادثات بالأشخاص/الحسابات بدون ربط تلقائي وبدون كشف التوكن في الواجهة.

النطاق المنفذ في هذه المرحلة هو **تأسيس الهوية والربط** فقط:

- حفظ توكن بوت واحد للشركة من طرف الخادم.
- إرجاع حالة الإعدادات مع توكن مخفي فقط.
- اختبار البوت عبر Telegram `getMe`.
- جلب التحديثات عبر Telegram `getUpdates`.
- تخزين المحادثات المكتشفة في كاش داخلي.
- إظهار المحادثات المكتشفة مع حالة الربط.
- منع تكرار Chat ID على مستوى الشركة.
- ربط Chat ID مع مستخدم أو عميل أو مورد أو موظف أو جهة أخرى.
- حفظ صلاحيات الاستلام لكل رابط: فواتير، سندات، تقارير، تنبيهات.
- إرسال رسالة اختبار إلى الرابط المحدد.
- تعطيل/إعادة تفعيل الرابط بدون حذف نهائي.
- إضافة فحص تكرار عند إدخال Chat ID يدوياً في العميل أو المورد.

لم يتم تنفيذ الإرسال التلقائي لفواتير PDF أو سندات PDF في هذه المرحلة حسب المطلوب.

## 2. الملفات التي تم إنشاؤها

- `server/src/db/migrations/008_telegram_chat_identity_linking.sql`
- `server/src/services/telegramService.ts`
- `server/src/routes/telegramRoutes.ts`
- `src/lib/api/telegramApi.ts`
- `src/components/settings/TelegramBotSettingsPanel.tsx`
- `docs/FABRIC_TELEGRAM_BOT_AND_CHAT_ID_LINKING_REPORT.md`

## 3. الملفات التي تم تعديلها

- `server/src/app.ts`
- `server/src/routes/customerRoutes.ts`
- `server/src/routes/supplierRoutes.ts`
- `src/pages/SystemSettings.tsx`
- `src/pages/Customers.tsx`
- `src/pages/Suppliers.tsx`
- `src/lib/api/customersApi.ts`
- `src/lib/api/suppliersApi.ts`

## 4. تدقيق الأساس الحالي قبل التنفيذ

كان موجوداً سابقاً:

- Migration رقم `007_telegram_messaging_foundation.sql` لإضافة حقول تيليغرام على العملاء والموردين وإنشاء أساس لسجل الإرسال.
- Middleware في `vite.config.ts` لمسارات تطوير قديمة:
  - `/api/telegram/invoice`
  - `/api/telegram/statement`
- دوال Frontend قديمة لإرسال فاتورة/كشف إلى تيليغرام:
  - `src/lib/telegramInvoice.ts`
  - `src/lib/telegramStatement.ts`
- إعدادات نظام قديمة في `system_settings.mail` تتعامل مع `telegramBotToken`.
- مسارات توافق قديمة في `server/src/routes/systemRoutes.ts` لاختبار البوت وجلب تحديثات بسيطة.

ما كان ناقصاً:

- لا توجد طاولة مركزية لربط Chat ID مع شخص محدد.
- لا يوجد منع مركزي لتكرار Chat ID.
- لا يوجد سجل محادثات مكتشفة من `getUpdates`.
- لا توجد واجهة ربط منظمة داخل إعدادات المراسلة.
- لا توجد API مستقلة وآمنة لإدارة إعدادات بوت تيليغرام.
- التوكن القديم كان جزءاً من إعدادات البريد العامة، وتم الحفاظ على التوافق معه بدون اعتماده كمصدر التصميم الجديد.

## 5. تفاصيل قاعدة البيانات

تم إنشاء migration:

`server/src/db/migrations/008_telegram_chat_identity_linking.sql`

### `telegram_bot_settings`

الغرض: حفظ إعدادات بوت واحد لكل شركة.

الحقول الأساسية:

- `company_id`
- `bot_token_encrypted`
- `bot_username`
- `bot_name`
- `is_enabled`
- `last_updates_offset`
- `created_by_user_id`
- `updated_by_user_id`
- `created_at`
- `updated_at`

القيد المهم:

- `unique(company_id)`

### `telegram_chat_links`

الغرض: السجل المركزي والرسمي لربط Chat ID مع شخص/حساب.

الحقول الأساسية:

- `chat_id`
- `telegram_user_id`
- `telegram_username`
- `telegram_first_name`
- `telegram_last_name`
- `telegram_display_name`
- `chat_type`
- `target_type`
- `target_id`
- `target_name`
- `is_active`
- `can_receive_invoices`
- `can_receive_vouchers`
- `can_receive_reports`
- `can_receive_alerts`
- `notes`
- `linked_by_user_id`

قيود منع التكرار:

- `unique(company_id, chat_id)`
- index فريد للرابط الفعال على `(company_id, target_type, target_id)` عندما يكون `target_id` غير فارغ و`is_active=true`

### `telegram_update_cache`

الغرض: تخزين تحديثات تيليغرام المكتشفة بدون فقدان البيانات.

الحقول الأساسية:

- `update_id`
- `chat_id`
- `telegram_user_id`
- `telegram_username`
- `first_name`
- `last_name`
- `chat_type`
- `message_text`
- `received_at`
- `raw_update`

القيد المهم:

- `unique(company_id, update_id)`

### `telegram_delivery_logs`

تم توسيع أساس سجل الإرسال لدعم:

- `chat_link_id`
- `target_type`
- `target_id`
- `event_type`
- `message_text`
- `sent_at`
- حالات `PENDING`, `SENT`, `FAILED` مع الحفاظ على توافق الحالات القديمة.

## 6. أمان توكن البوت

السلوك الحالي:

- التوكن يحفظ في الخادم فقط داخل `telegram_bot_settings.bot_token_encrypted`.
- لا يتم إرجاع التوكن الخام من أي endpoint جديد.
- `GET /api/telegram/settings` يرجع:
  - `hasToken`
  - `tokenMasked`
  - `botUsername`
  - `botName`
  - `isEnabled`
- القناع المستخدم يظهر نهاية التوكن فقط مثل:
  - `************1234`
- الواجهة تستخدم input من نوع password ولا تعرض التوكن الخام بعد الحفظ.
- لا تتم طباعة التوكن في logs.

التشفير:

- تم تنفيذ تشفير at-rest باستخدام AES-256-GCM.
- مفتاح التشفير مشتق من `JWT_SECRET` عبر SHA-256.

ملاحظة تشغيلية مهمة:

- يجب تثبيت `JWT_SECRET` في الإنتاج وعدم تغييره عشوائياً، لأن تغيير السر يمنع فك تشفير التوكن القديم.
- في مرحلة إنتاج متقدمة يفضل نقل التشفير إلى مفتاح مخصص مثل `TELEGRAM_TOKEN_ENCRYPTION_KEY` أو KMS.

## 7. سلوك جلب Chat ID

المسار:

- `POST /api/telegram/fetch-updates`

السلوك:

1. يقرأ التوكن من الخادم فقط.
2. يستدعي Telegram `getUpdates`.
3. يستخرج بيانات المحادثة والمرسل:
   - `chat_id`
   - `telegram_user_id`
   - `username`
   - `first_name`
   - `last_name`
   - `display_name`
   - `chat_type`
   - آخر رسالة
   - تاريخ آخر رسالة
4. يخزن التحديثات في `telegram_update_cache`.
5. يحدث `last_updates_offset` لتقليل تكرار النتائج القديمة.
6. يرجع المحادثات مع حالة الربط:
   - `linked`
   - `linkedTargetType`
   - `linkedTargetId`
   - `linkedTargetName`

قاعدة الاستخدام:

- يجب أن يرسل العميل/المورد/الشخص أي رسالة إلى البوت أولاً.
- بعدها يضغط المدير زر `جلب Chat ID تلقائياً`.
- النظام يعرض المحادثات، لكنه لا يربط أي محادثة تلقائياً.

## 8. منع التكرار

تم منع التكرار على مستويين:

1. قاعدة البيانات:
   - `unique(company_id, chat_id)` داخل `telegram_chat_links`.
   - رابط فعال واحد لكل target عند وجود `target_id`.

2. الخدمة الخلفية:
   - `linkChatToTarget` يفحص وجود Chat ID فعال قبل الإدخال.
   - إذا كان Chat ID مرتبطاً مسبقاً، يرجع الخطأ `409` مع اسم الشخص المرتبط.
   - إذا كان target لديه رابط فعال سابق، يرجع الخطأ `409` لمنع الربط العرضي المزدوج.

تم أيضاً إضافة فحص على إدخال Chat ID اليدوي في العملاء والموردين:

- `server/src/routes/customerRoutes.ts`
- `server/src/routes/supplierRoutes.ts`

عند وجود Chat ID مرتبط مسبقاً في السجل المركزي يتم رفض الحفظ بـ `409`.

## 9. أنواع الأهداف المدعومة

يدعم الربط الأنواع التالية:

- `USER` مستخدم
- `CUSTOMER` عميل
- `SUPPLIER` مورد
- `EMPLOYEE` موظف
- `OTHER` جهة أخرى

السلوك في الواجهة:

- عند اختيار عميل يتم تحميل العملاء من API العملاء.
- عند اختيار مورد يتم تحميل الموردين من API الموردين.
- عند اختيار مستخدم يتم تحميل المستخدمين من API المستخدمين عند توفرها.
- الموظف والجهة الأخرى يدعمان إدخال اسم يدوي.

## 10. تكامل العملاء والموردين

تم الحفاظ على الحقول القديمة الموجودة من migration رقم 007:

- `telegram_chat_id`
- `telegram_enabled`
- `telegram_label`

وتمت إضافة هذه الحقول إلى:

- أنواع API في `src/lib/api/customersApi.ts`
- أنواع API في `src/lib/api/suppliersApi.ts`
- نموذج العميل في `src/pages/Customers.tsx`
- نموذج المورد في `src/pages/Suppliers.tsx`

السجل المركزي الرسمي هو:

- `telegram_chat_links`

عند الربط من واجهة إعدادات تيليغرام:

- إذا كان target من نوع عميل يتم مزامنة `customers.telegram_chat_id`.
- إذا كان target من نوع مورد يتم مزامنة `suppliers.telegram_chat_id`.
- عند تعطيل الرابط يتم تفريغ الحقل القديم إذا كان يطابق نفس Chat ID.

## 11. API endpoints

تم تسجيل المسارات الجديدة تحت:

`/api/telegram`

المسارات:

- `GET /api/telegram/settings`
- `PUT /api/telegram/settings`
- `POST /api/telegram/test-bot`
- `POST /api/telegram/fetch-updates`
- `GET /api/telegram/detected-chats`
- `GET /api/telegram/chat-links`
- `POST /api/telegram/chat-links`
- `PUT /api/telegram/chat-links/:id`
- `PATCH /api/telegram/chat-links/:id/toggle-status`
- `DELETE /api/telegram/chat-links/:id`
- `POST /api/telegram/chat-links/:id/test-message`

ملاحظات:

- كل المسارات تحتاج مستخدماً مصادقاً.
- `GET /api/telegram/settings` لا يرجع التوكن الخام.
- `DELETE` هو تعطيل ناعم وليس حذفاً نهائياً.

## 12. واجهة المستخدم

تمت إضافة الواجهة داخل مكانها الطبيعي:

`إعدادات النظام > إعدادات المراسلة > بوت تيليغرام`

بدون إنشاء صفحة إعدادات علوية جديدة وبدون إعادة تصميم صفحة الإعدادات.

الأقسام داخل اللوحة:

1. إعدادات البوت
2. جلب Chat ID
3. ربط المحادثات بالأشخاص
4. سجل الروابط

العناصر الأساسية:

- حقل Bot Token من نوع password.
- زر `حفظ الإعدادات`.
- زر `اختبار البوت`.
- زر `جلب Chat ID تلقائياً`.
- جدول المحادثات المكتشفة.
- نافذة ربط المحادثة مع شخص/حساب.
- جدول الروابط الحالية.
- زر إرسال رسالة اختبار للرابط.
- زر تعطيل/تفعيل الرابط.

رسائل التكرار تعرض اسم صاحب الرابط الحالي:

`هذا Chat ID مرتبط مسبقاً بـ {targetName}.`

## 13. Frontend API Gateway

تم إنشاء:

`src/lib/api/telegramApi.ts`

الدوال:

- `getTelegramSettings`
- `updateTelegramSettings`
- `testTelegramBot`
- `fetchTelegramUpdates`
- `getDetectedTelegramChats`
- `listTelegramChatLinks`
- `createTelegramChatLink`
- `updateTelegramChatLink`
- `toggleTelegramChatLinkStatus`
- `sendTelegramTestMessage`

الأنواع:

- `TelegramSettingsDto`
- `DetectedTelegramChatDto`
- `TelegramChatLinkDto`
- `TelegramTargetType`
- `TelegramLinkPayload`

## 14. نتائج الاختبارات اليدوية

تم تنفيذ اختبارات محلية ممكنة بدون توكن حقيقي:

- تم تشغيل migration رقم 008 بنجاح.
- تم التأكد أن `/api/telegram/settings` مسجل خلف بوابة المصادقة ويرجع `401` بدون جلسة.
- تم بناء الواجهة بنجاح.
- تم فحص أن التوكن الخام غير موجود في build الناتج.

اختبارات تحتاج توكن بوت حقيقي وحساب تيليغرام:

- حفظ توكن حقيقي.
- اختبار `getMe` مع Telegram.
- إرسال رسالة من حساب تيليغرام إلى البوت.
- جلب التحديثات الفعلية.
- ربط Chat ID فعلي مع عميل/مورد.
- إرسال رسالة اختبار فعلية إلى الرابط.

هذه لم تنفذ لأن الجلسة لا تحتوي على توكن بوت حقيقي، وهذا صحيح أمنياً.

## 15. نتائج اختبارات الأمان

تم تشغيل فحص بحث عن نمط توكن تيليغرام:

`rg -n "TELEGRAM_BOT_TOKEN|[0-9]{6,}:[A-Za-z0-9_-]{20,}" dist src server -S`

النتيجة:

- لم يظهر توكن حقيقي أو نمط توكن خام داخل `dist`.
- ظهرت فقط أسماء متغيرات بيئة/مفاتيح إعدادات مثل `TELEGRAM_BOT_TOKEN` في ملفات الخادم.

تم التأكد من التصميم التالي:

- الواجهة لا تخزن التوكن الخام.
- API الإعدادات لا يعيد التوكن الخام.
- التوكن يحفظ مشفراً في قاعدة البيانات.
- الاختبار والجلب والإرسال يقرأون التوكن من الخادم فقط.

## 16. نتائج الفحص والبناء

تم تشغيل:

- `npm run server:check`
- `npm run server:migrate`
- `npm run lint`
- `npm run build`

النتائج:

- فحص TypeScript للخادم نجح.
- migration رقم 008 طبق بنجاح.
- lint نجح.
- build نجح.

## 17. القيود المعروفة

- لم يتم اختبار Telegram فعلياً عبر `getMe/getUpdates/sendMessage` لأن توكن بوت حقيقي لم يقدم أثناء التنفيذ.
- الإرسال التلقائي لفواتير PDF وسندات PDF غير منفذ عمداً في هذه المرحلة.
- يوجد middleware تطوير قديم في `vite.config.ts` لمسارات invoice/statement ولا يمثل الأساس الجديد لإدارة الهويات.
- توجد مسارات توافق قديمة في `server/src/routes/systemRoutes.ts` مرتبطة بإعدادات mail القديمة، بينما الأساس الرسمي الجديد هو `/api/telegram/*`.
- يوجد كود واجهة قديم معطل داخل `SystemSettings.tsx` لأزرار تيليغرام السابقة؛ لا يكشف توكناً خاماً، لكنه يفضل تنظيفه لاحقاً بعد التأكد من عدم الحاجة للتوافق القديم.
- التشفير يعتمد حالياً على `JWT_SECRET`، لذلك يجب تثبيته في الإنتاج أو اعتماد مفتاح تشفير مستقل لاحقاً.

## 18. المرحلة التالية المقترحة

المرحلة التالية المنطقية:

- إرسال فاتورة البيع PDF تلقائياً إلى رابط العميل عند حفظ الفاتورة.
- إرسال سند قبض أو دفع PDF إلى رابط العميل/المورد حسب نوع العملية.
- تسجيل كل عملية إرسال في `telegram_delivery_logs`.
- احترام flags الموجودة في الرابط:
  - `can_receive_invoices`
  - `can_receive_vouchers`
  - `can_receive_reports`
  - `can_receive_alerts`
- استخدام قالب PDF المعتمد في المشروع بدون تغيير التصميم.
- إضافة إعادة محاولة للإرسال عند الفشل.

## 19. حالة معايير النجاح

- حفظ توكن بوت الشركة: منفذ.
- عدم إرجاع التوكن الخام: منفذ.
- اختبار البوت: منفذ برمجياً ويحتاج توكن فعلي للتحقق الحي.
- جلب Chat ID من تحديثات Telegram: منفذ برمجياً ويحتاج رسالة فعلية للبوت للتحقق الحي.
- عرض المحادثات مع الاسم وusername وآخر رسالة: منفذ.
- منع تكرار Chat ID: منفذ.
- إظهار المحادثات المرتبطة مسبقاً وصاحبها: منفذ.
- ربط Chat ID مع عميل/مورد/مستخدم/موظف/آخر: منفذ.
- حفظ صلاحيات الاستلام لكل رابط: منفذ.
- إرسال رسالة اختبار للرابط: منفذ برمجياً ويحتاج Chat ID فعلي للتحقق الحي.
- منع التكرار في نماذج العملاء والموردين: منفذ.
- `server:check`: ناجح.
- `build`: ناجح.
- التقرير العربي: تم إنشاؤه.
