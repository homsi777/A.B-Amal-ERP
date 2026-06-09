# دليل الأوامر الأساسية (تطوير + إنتاج)

هذا الملف يجمع أهم الأوامر الضرورية لتشغيل مشروع CLOTEX (Electron + Server + Vite) وإدارة قاعدة البيانات والتغليف والفحص.

> ملاحظة: شغّل الأوامر من داخل مجلد المشروع الرئيسي.

---

## 1) تجهيز أول مرة

### تثبيت الحزم

```powershell
npm install
```

### فحص TypeScript (بدون تشغيل)

```powershell
npm run lint
```

---

## 2) أوامر التشغيل (تطوير)

### تشغيل كامل (المفضل)

```powershell
npm run electron:dev
```

### تشغيل ستاك التطوير مع سكربت الـ VPS/اللوجات

```powershell
npm run electron:dev:stack
```

ملفات اللوج تُكتب عادة داخل:

- `logs/dev-stack-last.log`
- `logs/dev-stack-YYYY-MM-DDTHHMMSS.log`

### تشغيل كل جزء منفصل (للتشخيص)

واجهة Vite فقط:

```powershell
npm run dev:renderer
```

السيرفر فقط:

```powershell
npm run dev:server
```

---

## 3) أوامر قاعدة البيانات (هجرة / seed / تصفير)

> مهم: هذه الأوامر تعتمد على `DATABASE_URL`. إذا اتصال قاعدة البيانات عبر VPN/VPS فيه قيود، نفّذها فقط عندما يكون الاتصال متاح.

### تنفيذ الهجرات (Migrations)

```powershell
npm run server:migrate
```

### إنشاء بيانات أولية (Seed)

```powershell
npm run server:seed
```

### تصفير قاعدة البيانات (حذف كل البيانات) — خطير

هذا الأمر يحذف البيانات. تأكد أنك على قاعدة البيانات الصحيحة قبل التنفيذ.

```powershell
npm run server:reset:clean
```

---

## 4) أوامر الفحص (قبل التغليف أو أثناء التطوير)

### فحص TypeScript للواجهة

```powershell
npm run lint
```

### فحص TypeScript للسيرفر فقط

```powershell
npm run server:check
```

### تشغيل اختبار الوحدة الموجود حالياً

```powershell
npm test
```

---

## 5) أوامر التغليف/الإنتاج (Electron)

### تجهيز نسخة Preview إنتاجية محلية (بدون Installer)

هذا يشغّل نفس سير إنتاج (bundle + build + compile) ثم يفتح Electron.

```powershell
npm run electron:preview
```

### تغليف كـ Folder (بدون تثبيت) — Pack

```powershell
npm run electron:pack
```

### بناء Installer على Windows — Build

```powershell
npm run electron:build
```

### تغليف/بناء مع ملفات لوج (مفيد لتشخيص مشاكل التغليف)

```powershell
npm run electron:pack:log
```

```powershell
npm run electron:build:log
```

### تشغيل النسخة المغلفة (بعد pack/build)

```powershell
npm run electron:run:release
```

---

## 6) أوامر البناء الداخلية (عند الحاجة)

### بناء الواجهة (Vite)

```powershell
npm run build
```

### بناء/تجهيز السيرفر للإنتاج

```powershell
npm run server:build
```

### Bundle للسيرفر (المستخدم في النسخة النهائية داخل server-bundle)

```powershell
npm run server:bundle
```

### Compile لـ Electron (TypeScript)

```powershell
npm run electron:compile
```

---

## 7) أوامر مفيدة إضافية

### فحص اتصال قاعدة البيانات (Tunnel/VPS)

```powershell
npm run db:ping
```

### توليد مفتاح/مفاتيح تفعيل (يتطلب اتصال DB)

مفتاح واحد:

```powershell
npm run activation:generate -- --count=1 --plan=FULL
```

---

## 8) مسار عمل مقترح (مختصر)

### تطوير يومي

```powershell
npm install
npm run server:migrate
npm run electron:dev
```

### قبل إرسال نسخة إنتاج

```powershell
npm run lint
npm run server:check
npm test
npm run electron:pack:log
```

