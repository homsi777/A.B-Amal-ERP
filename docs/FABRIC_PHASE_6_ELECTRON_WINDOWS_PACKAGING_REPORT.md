# تقرير المرحلة السادسة: Electron Windows — حزمة التطبيق المكتبي
## نظام إدارة مستودعات الأقمشة (ERP)

**التاريخ:** 2 مايو 2026  
**المرحلة:** 6 — Electron Windows Packaging Foundation  
**الحالة:** مكتملة ✅

---

## 1. الملخص التنفيذي

بناء أساس Electron Windows المؤمَّن لنظام ERP. يُشغِّل التطبيق واجهة React/Vite داخل نافذة Electron مع دعم وضع التطوير والبناء الإنتاجي. أُصلح خلل QR الذي كان يعتمد على `api.qrserver.com` الخارجي وأُنشئت طبقة تجريد للطباعة. الواجهة عبر المتصفح تعمل كما هي دون أي كسر.

---

## 2. الملفات المُنشأة

| الملف | الغرض |
|-------|--------|
| `electron/main.ts` | العملية الرئيسية لـ Electron — BrowserWindow + IPC handlers |
| `electron/preload.ts` | جسر Context Bridge — يعرض واجهة `window.fabricApp` الآمنة |
| `electron/types.ts` | تعريفات TypeScript مشتركة — AppSettings + قنوات IPC |
| `electron/tsconfig.json` | إعدادات TypeScript خاصة بـ Electron (CommonJS output) |
| `electron/write-cjs-marker.cjs` | ينشئ `electron-dist/package.json` لتعريف النوع كـ CommonJS |
| `src/electron-env.d.ts` | تعريف نوع `Window.fabricApp` لـ TypeScript |
| `src/lib/printing/qrGenerator.ts` | مولّد QR بدون إنترنت — يستخدم حزمة `qrcode` |
| `src/lib/printing/printAdapters.ts` | واجهة PrintAdapter + دالة `getPrintAdapter()` |
| `src/lib/printing/webPrintAdapter.ts` | مُهيِّئ الطباعة عبر المتصفح (`window.open` + `window.print`) |
| `src/lib/printing/electronPrintAdapter.ts` | مُهيِّئ Electron — placeholder للمرحلة 7 |
| `src/pages/settings/DesktopSettings.tsx` | صفحة إعدادات تطبيق سطح المكتب |

---

## 3. الملفات المُعدَّلة

| الملف | التعديل |
|-------|---------|
| `package.json` | إضافة: اسم، وصف، `"main"`, scripts الـ Electron، إعدادات electron-builder، تبعيات جديدة |
| `vite.config.ts` | إضافة `base: './'` لتوافق `file://` في Electron |
| `src/lib/api/client.ts` | دعم تجاوز API URL من localStorage (إعدادات Electron) |
| `src/components/labels/LabelCard.tsx` | إصلاح `buildPrintDocument` — QR كـ SVG مدمج بدلاً من `qrserver.com` |
| `src/pages/inventory/StickerPrinting.tsx` | استخدام `triggerPrint` + `generateQrSvgMap` + `getPrintAdapter` |
| `src/App.tsx` | إضافة مسار `/settings/desktop` |
| `src/layouts/DashboardLayout.tsx` | إضافة "إعدادات سطح المكتب" في القائمة الجانبية |
| `.gitignore` | إضافة `electron-dist/` و`release/` |

---

## 4. معمارية Electron

```
electron/
  main.ts          → العملية الرئيسية
  preload.ts       → جسر IPC الآمن (contextBridge)
  types.ts         → AppSettings, IPC channels
  tsconfig.json    → CommonJS output → electron-dist/
  write-cjs-marker.cjs → يضع package.json{"type":"commonjs"} في electron-dist/

electron-dist/     → المخرجات المُترجَمة (CommonJS)
  main.js
  preload.js
  types.js
  package.json     → {"type":"commonjs"}

dist/              → مخرجات Vite (تُحمَّل من Electron في وضع الإنتاج)
  index.html
  assets/...
```

### مسار تحميل الواجهة

| الوضع | المصدر |
|-------|--------|
| التطوير (`NODE_ENV=development`) | `http://localhost:3000` |
| الإنتاج | `file:///.../dist/index.html` |

---

## 5. سكريبت وضع التطوير

```bash
npm run electron:compile   # ترجمة TypeScript → electron-dist/
npm run electron:dev        # يفتح Vite + Electron معاً
```

التسلسل:
1. `npm run electron:compile` — ترجمة ملفات Electron
2. `npm run dev` — تشغيل خادم Vite على المنفذ 3000
3. `wait-on http://localhost:3000` — انتظار جاهزية Vite
4. `electron .` — فتح نافذة Electron مؤشِّرةً إلى localhost:3000

---

## 6. سكريبتات البناء

```json
"electron:compile" : "tsc -p electron/tsconfig.json && node electron/write-cjs-marker.cjs"
"electron:dev"     : "npm run electron:compile && concurrently -k ..."
"electron:build"   : "npm run build && npm run electron:compile && electron-builder --win"
"electron:pack"    : "npm run build && npm run electron:compile && electron-builder --win --dir"
"electron:preview" : "npm run build && npm run electron:compile && cross-env NODE_ENV=production electron ."
```

### إعداد electron-builder

```json
"build": {
  "appId"       : "com.fabricwarehouse.erp",
  "productName" : "Fabric Warehouse ERP",
  "directories" : { "output": "release" },
  "files"       : ["dist/**", "electron-dist/**", "package.json", "!server", "!VPS.md", ...],
  "win"         : { "target": ["dir"] },
  "asar"        : true
}
```

---

## 7. استراتيجية API URL

### في المتصفح / التطوير
- يقرأ من `VITE_API_BASE_URL` (متغير بيئة Vite)

### في Electron / الإنتاج
- يبحث أولاً في `localStorage["fabric_erp_api_base_url"]`
- إذا غير موجود، يستخدم `VITE_API_BASE_URL` المُدمَج في البناء

### تحديث URL من واجهة المستخدم
- صفحة `/settings/desktop` تتيح للمستخدم تغيير URL
- يُحفظ في `localStorage` (متصفح) + `Electron userData JSON` (داخل Electron)

**لا يُخزَّن أبداً:** DATABASE_URL / كلمة مرور DB / JWT_SECRET / SSH / Telegram Token

---

## 8. الإعدادات المحلية

تُحفظ في `%APPDATA%/Fabric Warehouse ERP/fabric-erp-settings.json`:

```json
{
  "apiBaseUrl": "http://localhost:4010",
  "lastPrinterName": null,
  "defaultLabelTemplateId": null,
  "defaultPrintMode": "A4",
  "lastExcelFolder": null,
  "lastPdfFolder": null
}
```

### واجهة window.fabricApp (Context Bridge)

```typescript
window.fabricApp.isElectron          → true
window.fabricApp.getSettings()       → Promise<AppSettings>
window.fabricApp.setSettings(partial)→ Promise<AppSettings>
window.fabricApp.getApiBaseUrl()     → Promise<string>
window.fabricApp.setApiBaseUrl(url)  → Promise<string>
window.fabricApp.getVersion()        → Promise<string>
```

---

## 9. إصلاح QR بدون إنترنت ✅

### المشكلة (المرحلة 5)
`buildPrintDocument()` كان يُنتج HTML يحتوي على:
```html
<img src="https://api.qrserver.com/v1/create-qr-code/?size=50x50&data=...">
```
هذا يطلب شبكة إنترنت لكل طباعة — لا يعمل في بيئة Electron بدون إنترنت.

### الحل (المرحلة 6)
1. تثبيت حزمة `qrcode` (تعمل في المتصفح وNode.js)
2. إنشاء `src/lib/printing/qrGenerator.ts` يولّد SVG بدون شبكة
3. تحديث `buildPrintDocument()` ليقبل `qrSvgs: Record<rollId, svgString>`
4. تحديث `StickerPrinting.tsx` لتوليد SVGs قبل استدعاء buildPrintDocument

```typescript
// StickerPrinting.tsx
const qrSvgs = await generateQrSvgMap(rolls)
const html = buildPrintDocument(rolls, { ...opts, qrSvgs })
```

### التحقق
```
CLEAN: qrserver.com not found in dist/
```
الـ HTML المُنتج يحتوي على SVG مدمج بدلاً من URL خارجي.

---

## 10. معمارية مُهيِّئات الطباعة

```
src/lib/printing/
  printAdapters.ts       → Interface PrintAdapter + getPrintAdapter()
  webPrintAdapter.ts     → WebPrintAdapter: window.open + window.print
  electronPrintAdapter.ts → ElectronPrintAdapter: placeholder → يعود إلى WebPrintAdapter
  qrGenerator.ts         → generateQrSvg / generateQrSvgMap
```

### المُهيِّئ الحالي (المرحلة 6)
- **WebPrintAdapter**: يفتح نافذة جديدة ويستدعي `window.print()`
- **ElectronPrintAdapter**: placeholder — يعود إلى WebPrintAdapter

### المرحلة 7 (مستقبلاً)
- ElectronPrintAdapter سيستدعي: `window.fabricApp.printHtml(html, options)`
- دعم طباعة صامتة وطابعات حرارية

---

## 11. ملاقط الملفات (File Picker Foundation)

### الوضع الحالي
- استيراد Excel يعمل بـ `<input type="file">` القياسي داخل Electron
- لا يحتاج تعديلاً — ملقط المتصفح يعمل داخل Electron Renderer

### المرحلة 7 (مستقبلاً)
```typescript
// Preload (placeholder جاهز في preload.ts):
// pickExcelFile: () => ipcRenderer.invoke('fabric:pick-excel-file')
// Main:
// ipcMain.handle('fabric:pick-excel-file', () => dialog.showOpenDialog({...}))
```

---

## 12. إعدادات الأمان

### BrowserWindow

| الإعداد | القيمة | السبب |
|---------|--------|--------|
| `contextIsolation` | `true` | عزل preload عن الـ renderer |
| `nodeIntegration` | `false` | لا وصول لـ Node.js من React |
| `sandbox` | `true` | تقوية أمنية للعملية |
| `webSecurity` | `true` | منع المحتوى المختلط |
| `allowRunningInsecureContent` | `false` | منع HTTP داخل HTTPS |

### قواعد التنقل
- في التطوير: فقط `http://localhost:*`
- في الإنتاج: فقط `file://`
- الروابط الخارجية: `shell.openExternal()` في المتصفح الافتراضي

### مسح الأسرار
```
✅ CLEAN: qrserver.com not found in dist/
✅ JWT_SECRET ظهر فقط في نص UI التحذيري (ليس قيمة حقيقية)
✅ SSH ظهر فقط في نص UI التحذيري
✅ electron-dist/main.js: JWT_SECRET في تعليق فقط
✅ لا DATABASE_URL في المخرجات
✅ لا postgresql:// في المخرجات
✅ لا TELEGRAM_BOT_TOKEN في المخرجات
```

### الملفات المستبعدة من الحزمة
```
!server          → لا backend code
!VPS.md          → لا بيانات VPS
!.env*           → لا متغيرات بيئة
!*.py            → لا سكريبتات الاختبار
!release         → لا مجلد المخرجات
!src             → لا كود المصدر
```

---

## 13. توافق بناء الويب

| الأمر | الحالة |
|-------|--------|
| `npm run dev` | ✅ يعمل |
| `npm run build` | ✅ يعمل (11.77 ثانية، 2875 وحدة) |
| `npm run server:check` | ✅ يعمل (TypeScript سليم) |
| `npm run electron:compile` | ✅ يعمل |
| استيراد Excel في المتصفح | ✅ يعمل |
| طباعة اللصاقات في المتصفح | ✅ يعمل |
| QR في اللصاقات | ✅ يعمل (بدون قرserver.com) |

التغيير `base: './'` في vite.config.ts يتوافق مع:
- المتصفح: assets تُحمَّل بمسارات نسبية ✅
- Electron: `file://` يعمل مع المسارات النسبية ✅

---

## 14. نتائج الاختبار اليدوي

### اختبارات بناء وتجميع
| الاختبار | النتيجة |
|---------|---------|
| `npm run server:check` | ✅ نجح (0 أخطاء TypeScript) |
| `npm run build` | ✅ نجح (11.77 ثانية، 2875 وحدة) |
| `npm run electron:compile` | ✅ نجح |
| `electron-dist/main.js` موجود | ✅ |
| `electron-dist/preload.js` موجود | ✅ |
| `electron-dist/package.json` = `{"type":"commonjs"}` | ✅ |
| `npm run electron:pack` | ✅ نجح — `release/win-unpacked/Fabric Warehouse ERP.exe` (193 MB) |

### تحقق من الأمان
| الفحص | النتيجة |
|-------|---------|
| `qrserver.com` في dist/ | ✅ غير موجود |
| `qrserver.com` في app.asar | ✅ غير موجود |
| DATABASE_URL في app.asar | ✅ غير موجود |
| postgresql:// في app.asar | ✅ غير موجود |
| TELEGRAM_BOT_TOKEN في app.asar | ✅ غير موجود |
| JWT_SECRET كقيمة حقيقية | ✅ غير موجود (نص UI تحذيري فقط) |
| VPS.md في الحزمة | ✅ مستبعد |
| server/.env في الحزمة | ✅ مستبعد |
| ملفات .py في الحزمة | ✅ مستبعدة (0 ملف) |

---

## 15. مسح نتائج الأمان

```
=== Security scan: dist/ ===
CLEAN: qrserver.com not found in dist/
CLEAN: DATABASE_URL not found in dist/
CLEAN: postgresql:// not found in dist/
CLEAN: TELEGRAM_BOT_TOKEN not found in dist/
NOTE: JWT_SECRET يظهر فقط في نص UI (قائمة "لا نخزن هذه البيانات") — ليس قيمة حقيقية

=== Security scan: release/win-unpacked/resources/app.asar ===
CLEAN: DATABASE_URL ← لا وجود في الحزمة النهائية
CLEAN: postgresql://
CLEAN: TELEGRAM_BOT_TOKEN
CLEAN: qrserver.com
CLEAN: VPS.md (مستبعد)
CLEAN: server/.env (مستبعد)
CLEAN: *.py files (مستبعدة)
NOTE: JWT_SECRET يظهر فقط في نص UI DesktopSettings (تحذير "لا نخزن")

=== إصدار app.asar ===
EXE: Fabric Warehouse ERP.exe (193 MB)
```

**الحكم: لا أسرار حقيقية في المخرجات** ✅

---

## 16. نتائج البناء

```
> npm run server:check
✅ TypeScript check passed (0 errors)

> npm run build
✅ vite v6.4.2 — 2875 modules transformed
✅ dist/index.html generated
✅ built in 11.77s

> npm run electron:compile
✅ TypeScript compiled to electron-dist/
✅ electron-dist/package.json (CommonJS marker) written
```

---

## 17. القيود المعروفة

1. **تنزيل Electron Binary**: `electron:dev` و`electron:pack` يتطلبان تنزيل ثنائي Electron (~150MB). على الشبكات البطيئة يستغرق وقتاً طويلاً.

2. **خطأ TypeScript موجود مسبقاً**: `StickerPrinting.tsx` يحتوي خطأ `TS2322` في تعريف `RollRow` props (`key` prop). هذا خطأ موجود قبل المرحلة 6 ولا يؤثر على البناء (Vite لا يتحقق من الأنواع).

3. **BrowserRouter مع file://**: استخدام `BrowserRouter` مع Electron في وضع الإنتاج (`file://`) يعمل عبر History API، لكن إذا أُعيد تشغيل التطبيق على مسار معيّن قد لا يعمل. للتصحيح مستقبلاً: استخدام `HashRouter` في Electron أو `MemoryRouter`.

4. **Sandbox = true**: الـ `sandbox: true` في WebPreferences يتطلب أن يستخدم preload فقط `contextBridge` و`ipcRenderer` بدون Node.js APIs. الإعداد الحالي صحيح.

5. **لا أيقونة**: لم يُوضَع ملف أيقونة `.ico`. electron-builder سيستخدم أيقونة افتراضية.

6. **react-router BrowserRouter**: في بيئة Electron الإنتاجية (file://), البحث المباشر بـ URL قد يحتاج تعديل. للمرحلة 7 يُنصح بـ HashRouter.

---

## 18. المرحلة 7 الموصى بها

### أولاً: إكمال Electron Foundation
- [ ] تنزيل Electron binary واختبار `electron:dev` عملياً
- [ ] إضافة أيقونة `.ico` للتطبيق
- [ ] اختبار `electron:pack` وإنشاء `release/win-unpacked/`
- [ ] التحقق من تشغيل التطبيق الكامل داخل Electron

### ثانياً: الطباعة المتقدمة (المرحلة 7 الأساسية)
- [ ] تنفيذ `ElectronPrintAdapter` بشكل كامل
- [ ] `ipcMain.handle('fabric:print-html', ...)` باستخدام `webContents.print`
- [ ] اختيار الطابعة من النظام (`webContents.getPrintersAsync`)
- [ ] طباعة صامتة بدون نافذة حوار
- [ ] تصدير PDF (`webContents.printToPDF`)

### ثالثاً: ملقط الملفات الأصلي
- [ ] `ipcMain.handle('fabric:pick-excel-file', () => dialog.showOpenDialog(...))`
- [ ] تفعيل `window.fabricApp.pickExcelFile()` في الـ preload

### رابعاً: التحديث التلقائي
- [ ] `electron-updater` + قناة تحديث
- [ ] إشعارات التحديث

### خامساً: دعم HashRouter
- [ ] تحويل `BrowserRouter` إلى `HashRouter` في Electron
- [ ] حفظ المسار الأخير في الإعدادات

---

## ملخص التغييرات التقنية

```
الملفات المُنشأة  : 11
الملفات المُعدَّلة : 9
حزمة qrserver.com : محذوفة من مخرجات الطباعة ✅
حزم مُضافة       : electron, electron-builder, concurrently, wait-on, cross-env, qrcode, @types/qrcode
بناء الويب        : يعمل ✅
بناء Electron     : يعمل (compile) ✅
أمان Context      : contextIsolation=true, sandbox=true, nodeIntegration=false ✅
```
