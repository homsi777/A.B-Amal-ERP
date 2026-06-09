# تقرير — وضع التسليم الطارئ: نفق VPS تلقائي بدون طرفية وبدون إدخال كلمة مرور يدوياً

**التاريخ:** 2026-05-03  
**المشروع:** CLOTEX — نظام إدارة مستودعات الأقمشة (Electron + Fastify + PostgreSQL على VPS)

---

## 1. الملخص

تم تجهيز تشغيل **CLOTEX تلقائياً عبر نفق VPS** بحيث لا يحتاج العميل إلى فتح طرفية أو كتابة أوامر `ssh` أو إدخال كلمة مرور SSH يدوياً عند التشغيل. يُقرأ الاعتماد من ملف JSON مركزي واحد (`electron/config/vps-connection.json`) غير مرفوع إلى Git.

البنية تبقى: التطبيق والـ backend محليان على Windows؛ PostgreSQL على VPS؛ النفق المحلي `127.0.0.1:5433 → VPS 127.0.0.1:5432`.

---

## 2. الملفات المُعدَّلة أو المُنشأة

| الملف | الغرض |
|--------|--------|
| `electron/tunnel/deliveryVpsTunnel.ts` | منطق النفق (حزمة **ssh2** أولاً، ثم احتياطي **PuTTY plink**) + فحص PostgreSQL عبر `pg`. |
| `electron/config/vps-connection.example.json` | قالب الإعدادات (يُرفع إلى Git). |
| `electron/config/vps-connection.json` | نسخة محلية بالأسرار (**في `.gitignore`**). |
| `electron/connect-error.html` | شاشة خطأ عربية مع «إعادة المحاولة» و«تفاصيل تقنية». |
| `electron/copy-assets.cjs` | نسخ `connect-error.html` وأمثلة الإعداد إلى `electron-dist/`. |
| `electron/main.ts` | قبل نافذة التطبيق: التحقق من النفق وقاعدة البيانات؛ عند الفشل عرض شاشة الخطأ؛ عند الخروج إيقاف النفق إن بدأه التطبيق. |
| `electron/preload.ts` + `electron/types.ts` + `src/electron-env.d.ts` | قنوات IPC لإعادة المحاولة وتفاصيل الخطأ. |
| `scripts/dev-vps-auto.ts` | أمر التطوير `npm run electron:dev:vps`. |
| `package.json` | سكربتات `electron:compile`, `electron:dev:vps`, و`extraResources` للمجلد `electron/config`. |
| `.gitignore` | تجاهل `electron/config/vps-connection.json`. |

---

## 3. موضع القيم المركزية

- **ملف واحد للتسليم:** `electron/config/vps-connection.json`  
  أنشئه بنسخ `vps-connection.example.json` واملأ: `sshPassword`, `dbPassword`, والحقول الأخرى إذا لزم.
- **محاذاة الـ backend:** في `server/.env` يجب أن يكون  
  `DATABASE_URL=postgresql://erp_user:<كلمة مرور DB>@127.0.0.1:5433/fabric_erp?sslmode=disable`  
  متطابقاً مع `dbUser` / `dbPassword` في نفس ملف الـ VPS (لا يُستخدم المنفذ 5432 على Windows لهذا الغرض).

---

## 4. كيف يبدأ النفق تلقائياً؟

1. عند بدء Electron يتم تحميل أول ملف موجود من مسارات الإعداد (في التطوير: `electron/config/vps-connection.json`؛ في الحزمة: `resources/config/vps-connection.json`).
2. إذا لم يكن المنفذ المحلي `5433` مستمعاً، يُنشأ اتصال SSH باستخدام **ssh2** (كلمة المرور من الملف، بدون طباعة في الواجهة).
3. إذا فشل **ssh2** (مثلاً لم تُثبت الحزمة)، يُحاول استخدام **plink.exe** من مسار اختياري أو من Program Files أو بجانب التنفيذ.
4. يُفتح مستمع TCP محلي على `127.0.0.1:5433` ويُمرَّر إلى `127.0.0.1:5432` على الخادم.
5. يُنفَّذ فحص PostgreSQL باستخدام `DATABASE_URL` المُشتق من الإعداد.
6. عند الإقلاع من **`npm run electron:dev:vps`** يبدأ النفق في عملية Node الأم قبل تشغيل السيرفر وElectron؛ عند إغلاق العملية يُغلق النفق.

---

## 5. سلوك التطبيق عند فشل النفق أو قاعدة البيانات

- لا يُحمَّل واجه التطبيق الرئيسي؛ تُعرض نافذة منفصلة بنص عربي:
  **«تعذّر الاتصال بقاعدة البيانات السحابية…»**
- زر **إعادة المحاولة** يعيد محاولة النفق والتحقق من قاعدة البيانات.
- زر **تفاصيل تقنية** يعرض آخر رسالة خطأ داخلية للمطور (بدون طباعة كلمات المرور في سجل عادي).

---

## 6. أمر التطوير الموحد

```powershell
npm run electron:dev:vps
```

ينفّذ: `electron:compile` ثم نفقاً تلقائياً و`db:tunnel:check` ثم `electron:dev:stack` (سيرفر + Vite + Electron)، مع تعيين `DATABASE_URL` من الإعداد لجلسة العملية.

**شرط:** وجود `electron/config/vps-connection.json` صالح.

---

## 7. سلوك التطبيق المعاد تعبئته (Windows)

- يُنسَخ محتوى `electron/config/` إلى `resources/config/` عبر **extraResources**.
- عند التشغيل يقرأ Electron `resources/config/vps-connection.json` إن وُجد.
- يُنصح بتجهيز الملف قبل البناء على جهاز التسليم نفسه.

---

## 8. نتائج التحقق (بيئة التطوير)

| الأمر | النتيجة |
|--------|---------|
| `npm run server:check` | نجاح |
| `npm run build` | نجاح |
| `npm run electron:compile` | نجاح |
| `npm run lint` | نجاح |
| `npm run electron:pack` | يُنفَّذ للتحقق من الحزمة (حسب بيئة الجهاز). |

اختبار يدوي كامل (نفق، تسجيل دخول، تقارير) يتطلب ملف `vps-connection.json` صالحاً وشبكة تعمل.

---

## 9. قيود أمنية معروفة

- تخزين **كلمة مرور SSH وكلمة مرور قاعدة البيانات** نصاً صريحاً في ملف JSON محلي مقبول لهذا **مرحلة التسليم السريع فقط**.
- **hostVerifier** لـ ssh2 يقبل مفتاح الخادم دون `known_hosts` لتبسيط التسليم — غير مناسب للإنتاج الأمني الطويل الأمد بدون تدوير وHTTPS/VPN مناسبين.

---

## 10. الخلاصة

تم تجهيز تشغيل CLOTEX تلقائياً عبر نفق VPS دون فتح طرفية ودون إدخال كلمة مرور يدوياً، مع مركزية الإعدادات في `electron/config/vps-connection.json` وسلوك خطأ عربي واضح عند الفشل.
