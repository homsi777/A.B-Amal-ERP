# تقرير المرحلة السابعة — الطباعة الصامتة الأصلية لـ Electron، الطابعة الافتراضية، تصدير PDF، وتصليب بيئة التشغيل

**المشروع:** نظام إدارة مستودعات الأقمشة (ERP)  
**المرحلة:** السابعة (Phase 7)  
**التاريخ:** 2 مايو 2026  
**الحالة:** ✅ مكتملة بنجاح

---

## 1. الملخص التنفيذي

تُعدّ هذه المرحلة ركيزةً أساسية في تطوير نظام ERP لمستودعات الأقمشة؛ إذ تضمنت تحويل تطبيق Windows Desktop من نموذج الطباعة الاحتياطي (WebPrintAdapter) إلى نظام طباعة أصلي حقيقي يعتمد على إمكانيات Electron الأصلية. يمكن للمستخدم الآن اختيار طابعة لصاقات افتراضية، وتفعيل الطباعة الصامتة، وإرسال اللصاقات مباشرةً إلى الطابعة دون إظهار أي حوار.

**النتائج الرئيسية:**
- قائمة طابعات Windows حقيقية من `webContents.getPrintersAsync()`
- طباعة صامتة حقيقية بدون نافذة طباعة Windows عبر `webContents.print({ silent: true })`
- تصدير PDF عبر `webContents.printToPDF()` مع حوار حفظ أصلي
- أداة اختيار ملف Excel أصلية عبر `dialog.showOpenDialog()`
- HashRouter لحل مشكلة المسارات تحت بروتوكول `file://` في Electron
- تحديث حالة مهمة الطباعة (PRINTED/FAILED) بشكل تلقائي بناءً على نتيجة Electron
- لا يحتوي حزمة التطبيق على أي بيانات سرية أو كلمات مرور

---

## 2. الملفات المُنشأة

| الملف | الوصف |
|-------|-------|
| `src/lib/electron/useElectronSettings.ts` | React Hook لقراءة وحفظ إعدادات التطبيق (Electron → IPC، متصفح → localStorage) |

---

## 3. الملفات المُعدَّلة

| الملف | التغييرات |
|-------|-----------|
| `electron/types.ts` | توسيع `AppSettings` بحقول الطباعة الصامتة، إضافة `PrinterInfo`، `ElectronPrintOptions`، `ElectronPrintResult`، `ElectronPdfOptions`، `ElectronPdfResult`، `PickedFileResult`، وقنوات IPC الجديدة |
| `electron/main.ts` | إضافة 5 معالجات IPC جديدة: قائمة الطابعات، طباعة HTML، تصدير PDF، اختيار Excel، حفظ PDF |
| `electron/preload.ts` | كشف الدوال الجديدة عبر `contextBridge`: `listPrinters`، `printHtml`، `printToPdf`، `pickExcelFile`، `pickSavePdfPath` |
| `src/electron-env.d.ts` | تحديث واجهة `Window.fabricApp` بالأنواع الجديدة والدوال الجديدة |
| `src/lib/printing/printAdapters.ts` | إضافة نوع `PrintResult`، دوال `canUseSilentLabelPrinting()`، `toInternalPageSize()`، وتحديث واجهة `PrintAdapter.print()` لتُعيد `PrintResult` |
| `src/lib/printing/webPrintAdapter.ts` | تحديث `print()` لتُعيد `Promise<PrintResult>` |
| `src/lib/printing/electronPrintAdapter.ts` | تطبيق حقيقي كامل: طباعة عادية، طباعة صامتة، تصدير PDF عبر IPC |
| `src/pages/settings/DesktopSettings.tsx` | قسم الطابعات والطباعة الصامتة، أبعاد اللصاقة، طباعة تجريبية |
| `src/pages/inventory/StickerPrinting.tsx` | زر طباعة صامتة، تصدير PDF، تحديث تلقائي لحالة المهمة، Toast notifications |
| `src/App.tsx` | HashRouter للإنتاج في Electron، BrowserRouter للمتصفح |

---

## 4. قنوات IPC المُضافة

| قناة IPC | الوصف | المُدخلات | المُخرجات |
|----------|-------|-----------|-----------|
| `fabric:list-printers` | قائمة طابعات Windows | — | `PrinterInfo[]` |
| `fabric:print-html` | طباعة HTML (صامتة أو بحوار) | `html, ElectronPrintOptions` | `ElectronPrintResult` |
| `fabric:print-to-pdf` | تصدير HTML إلى PDF | `html, ElectronPdfOptions` | `ElectronPdfResult` |
| `fabric:pick-excel-file` | حوار فتح ملف Excel | — | `PickedFileResult | null` |
| `fabric:pick-save-pdf-path` | حوار حفظ ملف PDF | `defaultName?` | `string | null` |

**قنوات موجودة من الإصدار السادس (لا تغيير):**
- `fabric:get-settings` / `fabric:set-settings`
- `fabric:get-api-url` / `fabric:set-api-url`
- `fabric:get-version`

---

## 5. قائمة الطابعات

**التقنية:** `win.webContents.getPrintersAsync()` من العملية الرئيسية.

**السلوك:**
- تُعيد قائمة كاملة بجميع الطابعات المثبتة على جهاز Windows.
- كل طابعة تحتوي على: `name`, `displayName`, `description`, `isDefault`, `status`.
- عند عدم وجود طابعات، تُعيد مصفوفة فارغة بدون رمي استثناء.
- لا يتم كشف بيانات حساسة من الطابعات.
- زر تحديث في الواجهة لإعادة جلب القائمة.

---

## 6. إعدادات الطابعة الافتراضية

**الحقول المضافة إلى `AppSettings`:**

```typescript
defaultLabelPrinterName: string | null;   // طابعة اللصاقات
defaultA4PrinterName: string | null;       // طابعة A4
silentLabelPrintingEnabled: boolean;       // تفعيل الصامتة للصاقات
silentA4PrintingEnabled: boolean;          // تفعيل الصامتة لـ A4
labelWidthMm: number;                      // عرض اللصاقة (افتراضي: 100mm)
labelHeightMm: number;                     // ارتفاع اللصاقة (افتراضي: 80mm)
defaultPrintMode: 'A4' | 'ROLL_LABEL';    // وضع الطباعة الافتراضي
```

**التخزين:** ملف JSON في `app.getPath('userData')/fabric-erp-settings.json`.

**الواجهة (DesktopSettings):**
- قائمة منسدلة لاختيار طابعة اللصاقات.
- زر تحديث القائمة.
- مفتاح تفعيل الطباعة الصامتة.
- حقول أبعاد اللصاقة (العرض × الارتفاع).
- زر طباعة تجريبية للتحقق من الطابعة.
- تحذير عند تفعيل الصامتة بدون تحديد طابعة.

---

## 7. سلوك الطباعة الصامتة

**الشرط:** `silentLabelPrintingEnabled === true && defaultLabelPrinterName !== null`

**التدفق الكامل:**
1. المستخدم يضغط "طباعة صامتة" في صفحة اللصاقات.
2. يُتحقق من `defaultLabelPrinterName` قبل البدء.
3. تُنشأ مهمة طباعة في قاعدة البيانات.
4. يُعرض Toast بالرسالة: "جاري الإرسال إلى <اسم الطابعة>...".
5. يُولَّد HTML + QR codes محلياً.
6. يُرسَل عبر IPC إلى العملية الرئيسية.
7. تُنشئ العملية الرئيسية `BrowserWindow` مخفياً.
8. يُحمَّل HTML من ملف مؤقت (`os.tmpdir()`).
9. تُستدعى `webContents.print({ silent: true, deviceName: printerName })`.
10. الطابعة تطبع **بدون ظهور أي حوار أو نافذة**.
11. بناءً على الـ callback:
    - نجاح → `updatePrintJobStatus(jobId, 'PRINTED')` + Toast ✓
    - فشل   → `updatePrintJobStatus(jobId, 'FAILED', errorMsg)` + Toast ✗
12. لا يظهر حوار "هل تمت الطباعة؟" — تحديث تلقائي.

**حالات الخطأ:**
- لا توجد طابعة افتراضية → رسالة خطأ + رابط للإعدادات.
- الطابعة غير متصلة → `ElectronPrintResult.ok = false` + رسالة بالعربية.
- انتهاء المهلة (30 ثانية) → فشل تلقائي مع رسالة.
- النافذة المخفية لا تُظهر أي شيء للمستخدم.

---

## 8. سلوك الطباعة الأصلية (بدون صمت)

**الزر:** "طباعة عبر Windows" (في Electron) أو "طباعة" (في المتصفح).

**التدفق:**
1. يستخدم `WebPrintAdapter` أو `ElectronPrintAdapter` مع `silent: false`.
2. في Electron: تفتح نافذة `BrowserWindow` مخفية، ثم تفتح حوار طباعة Windows الطبيعي.
3. بعد الطباعة: يظهر حوار "هل تمت الطباعة؟" لأن المتصفح لا يعرف النتيجة الفيزيائية.
4. المستخدم يؤكد النجاح أو الفشل.

---

## 9. سلوك تصدير PDF

**الزر:** "تصدير PDF" (في Electron فقط).

**التدفق:**
1. يُولَّد HTML + QR codes.
2. يُرسَل عبر IPC `fabric:print-to-pdf`.
3. تُنشئ العملية الرئيسية نافذة مخفية وتحمّل HTML.
4. تستدعي `webContents.printToPDF({ printBackground: true, pageSize })`.
5. يظهر حوار حفظ Windows لاختيار المسار.
6. يُحفظ ملف PDF في المسار المختار.
7. يُحفظ آخر مجلد في الإعدادات (`lastPdfFolder`).
8. Toast بالنجاح أو الفشل.

**في المتصفح:** تصدير PDF غير متاح — يظهر رسالة "تصدير PDF متاح داخل تطبيق Windows فقط".

**اقتراح اسم الملف:**
- دفعة: `labels-batch-<8أحرف من UUID>.pdf`
- عام: `labels-YYYY-MM-DD.pdf`

---

## 10. أداة اختيار ملف Excel الأصلية

**القناة:** `fabric:pick-excel-file`

**التقنية:** `dialog.showOpenDialog({ properties: ['openFile'], filters: ['xlsx','xls'] })`

**المُخرجات:**
```typescript
{
  filePath: string;   // المسار الكامل
  fileName: string;   // اسم الملف فقط
  lastFolder: string; // يُحفظ في lastExcelFolder
}
```

**ملاحظة مهمة:** الواجهة الحالية تستخدم `<input type="file">` لاستيراد Excel وتعمل بشكل صحيح في كلا الوضعين. أداة اختيار Excel الأصلية أُسِّست في IPC ومتاحة للاستخدام، لكنها لم تُدمج في واجهة ImportExcel في هذه المرحلة لعدم كسر التدفق الحالي.

---

## 11. تغييرات واجهة StickerPrinting

**الأزرار الجديدة في شريط المعاينة:**

| الزر | الشرط | السلوك |
|------|-------|--------|
| **طباعة صامتة** | Electron + `silentLabelPrintingEnabled` + `defaultLabelPrinterName` | إرسال مباشر للطابعة بدون حوار |
| **طباعة عبر Windows** | Electron | طباعة مع حوار Windows |
| **طباعة** | متصفح | `window.print()` مع حوار |
| **تصدير PDF** | Electron فقط | تصدير + حوار حفظ |

**شارة الطباعة الصامتة:** في رأس الصفحة، يظهر اسم الطابعة الافتراضية إذا كانت الصامتة مفعّلة.

**Toast Notifications:** رسائل منبثقة صغيرة في أسفل الشاشة بدلاً من modal كبير للطباعة الصامتة.

**تحديث مهمة الطباعة:** تلقائي للطباعة الصامتة — لا يحتاج تأكيداً من المستخدم.

---

## 12. تغييرات DesktopSettings

**الأقسام الجديدة:**

### إعدادات الطباعة الصامتة للصاقات
- قائمة منسدلة لاختيار طابعة اللصاقات الافتراضية.
- زر تحديث القائمة (⟳).
- مفتاح تفعيل الطباعة الصامتة مع وصف واضح.
- تحذير عند عدم تحديد طابعة وتفعيل الصامتة.
- حقول عرض × ارتفاع اللصاقة بالمليمتر.
- زر "طباعة تجريبية" يرسل صفحة اختبار للطابعة المختارة.

### إعدادات طباعة A4
- قائمة منسدلة لطابعة A4 الافتراضية (اختياري).
- مفتاح الطباعة الصامتة لـ A4.
- اختيار وضع الطباعة (لصاقة منفصلة / A4).

**في المتصفح:** الأقسام المتعلقة بالطابعات معطّلة مع رسالة: "قائمة الطابعات متاحة داخل تطبيق Windows فقط".

---

## 13. قواعد حالة مهمة الطباعة

| وضع الطباعة | النجاح | الفشل |
|-------------|--------|-------|
| **صامتة (Electron)** | PRINTED تلقائياً بعد callback | FAILED تلقائياً مع رسالة الخطأ |
| **عادية (Electron/متصفح)** | PRINTED بعد تأكيد المستخدم | FAILED بعد رفض المستخدم |

**لا يُسجَّل PRINTED قبل تأكيد نجاح الطباعة من Electron.**

---

## 14. تكامل المخزون / تفاصيل الثوب / الاستيراد

**الطباعة الصامتة المتاحة من:**
- `StickerPrinting` (الصفحة الرئيسية للطباعة) — مُطبَّقة بالكامل ✅
- `?rollId=<uuid>` — تحميل ثوب واحد تلقائياً في المعاينة ✅
- `?batchId=<uuid>` — تحميل دفعة كاملة تلقائياً ✅
- `?rollId=<uuid>&silent=1` — تحميل + طباعة صامتة تلقائية إذا كانت الشروط مستوفاة ✅

**من صفحات أخرى:** يمكن تحقيق ذلك بإضافة رابط إلى `/inventory/labels?rollId=<id>&silent=1` من صفحات Inventory/RollDetails/ImportBatches في المرحلة الثامنة.

---

## 15. تصلّب المسارات (Routing Hardening)

**المشكلة:** `BrowserRouter` يعتمد على web server لخدمة المسارات الفرعية. في Electron production، يُحمَّل التطبيق عبر `file://` مما يُعطل التنقل بعد إعادة التشغيل.

**الحل:** `HashRouter` في Electron، `BrowserRouter` في المتصفح.

```tsx
// src/App.tsx
const RouterComponent =
  typeof window !== 'undefined' && window.fabricApp?.isElectron
    ? HashRouter   // file:// → /#/inventory/labels?rollId=...
    : BrowserRouter; // https:// → /inventory/labels?rollId=...
```

**المسارات المختبرة تعمل بشكل صحيح:**
- `/#/inventory/labels?rollId=...` ✅
- `/#/settings/desktop` ✅
- `/#/inventory/rolls/:id` ✅
- `/#/purchases/import-batches` ✅

---

## 16. تصلّب التغليف والأمان

**ملفات مستبعدة من `app.asar`:**
```
!node_modules
!server
!VPS.md
!.env*
!*.py
!release
!electron
!src
```

**نتيجة فحص الأمان على `app.asar`:**
```
DATABASE_URL      → غير موجود ✓
postgresql://     → غير موجود ✓
كلمة المرور VPS  → غير موجودة ✓
JWT_SECRET (قيمة حقيقية) → غير موجودة ✓
TELEGRAM_BOT_TOKEN → غير موجود ✓
server/.env       → غير موجود ✓
```

*ملاحظة: النص "JWT_SECRET" يظهر في تعليقات الكود وعناصر الواجهة الإرشادية (لا أسرار حقيقية).*

---

## 17. نتائج الاختبارات اليدوية للـ Electron

| الاختبار | النتيجة |
|----------|---------|
| تشغيل التطبيق المُعبَّأ | ✅ يعمل |
| قائمة الطابعات تظهر | ✅ |
| اختيار طابعة افتراضية وحفظها | ✅ يظل بعد إعادة التشغيل |
| تفعيل الطباعة الصامتة | ✅ |
| طباعة صامتة بدون حوار Windows | ✅ |
| حالة المهمة PRINTED تلقائياً | ✅ |
| طباعة تجريبية | ✅ |
| تصدير PDF مع حوار حفظ | ✅ |
| معاينة المسارات بعد إعادة التشغيل | ✅ (HashRouter) |
| الطباعة عبر المتصفح لا تزال تعمل | ✅ |
| WebPrintAdapter سليم | ✅ |

---

## 18. نتائج فحص الأمان

```
✅ DATABASE_URL        → غير موجود في app.asar
✅ postgresql://       → غير موجود في app.asar
✅ كلمة مرور VPS      → غير موجودة في app.asar
✅ JWT_SECRET (قيمة)  → غير موجودة في app.asar
✅ TELEGRAM_BOT_TOKEN → غير موجود في app.asar
✅ server/.env         → مستبعد من التغليف
✅ require غير موجود في renderer (sandbox)
✅ IPC محدود بـ whitelist فقط
✅ الروابط الخارجية تُفتح في متصفح النظام
```

---

## 19. نتائج عمليات البناء

```
npm run server:check   → ✅ نجح (0 أخطاء TypeScript في الخادم)
npm run build          → ✅ نجح (Vite production build)
npm run electron:compile → ✅ نجح (تجميع TypeScript → electron-dist/)
npm run electron:pack  → ✅ نجح (release/win-unpacked/)
```

---

## 20. القيود المعروفة

| القيد | السبب | الحل في المرحلة الثامنة |
|-------|-------|------------------------|
| لا يوجد تكامل مباشر للصامتة من Inventory/RollDetails | نطاق المرحلة محدود | إضافة زر "طباعة لصاقة" صامت في المرحلة 8 |
| أداة Excel الأصلية غير متصلة بواجهة الاستيراد | منع كسر `<input type=file>` الحالي | دمج في المرحلة 8 |
| مقاس اللصاقة المخصص يعتمد على CSS إذا رفضت الطابعة | بعض الطابعات لا تدعم `pageSize` مخصص | إضافة تحقق وتجريب في المرحلة 8 |
| لا يوجد تحديث تلقائي للبرنامج | في نطاق المرحلة القادمة | electron-updater في المرحلة 9 |
| ESC/POS وZPL لم تُطبَّق بعد | خارج نطاق هذه المرحلة | المرحلة 9 |

---

## 21. المرحلة الثامنة الموصى بها

### ميزات مقترحة للمرحلة 8:

1. **تكامل الطباعة الصامتة من Inventory/RollDetails/ImportBatches**
   - زر "طباعة لصاقة صامتة" مباشرةً من جدول المخزون
   - طباعة دفعة بعد تأكيد الاستيراد (ImportBatches) صامتةً

2. **دمج أداة Excel الأصلية**
   - استخدام `pickExcelFile()` في صفحة ImportExcel
   - قراءة محتوى الملف عبر IPC وإرساله للـ frontend

3. **تصلّب أداء الطباعة**
   - معالجة الطابعات التي لا تدعم الحجم المخصص
   - محاولة تلقائية (retry) عند الفشل الأول

4. **تطبيق ESC/POS الحراري**
   - كشف طابعات Thermal label
   - إرسال أوامر raw عبر USB/Serial

5. **تحديث تلقائي للتطبيق**
   - `electron-updater` من خادم GitHub Releases

6. **تحسين تصدير PDF**
   - تحديد حجم الصفحة تلقائياً من إعدادات القالب
   - دعم المشاركة عبر البريد الإلكتروني

---

## ملخص تقني

```
الإصدار:     Node.js (Electron 36.9.5) + React 19 + Vite 6.4 + TypeScript
التغليف:     electron-builder 25.1.8 → release/win-unpacked/
IPC:         contextIsolation=true, nodeIntegration=false, sandbox=true
التوجيه:     HashRouter (Electron) / BrowserRouter (متصفح)
QR:          توليد محلي (qrcode) — بدون شبكة خارجية
الطباعة:     webContents.print() → صامتة حقيقية لـ Windows
PDF:         webContents.printToPDF() → buffer → حوار حفظ
الإعدادات:  userData/fabric-erp-settings.json (لا أسرار مخزَّنة)
```

---

*تقرير المرحلة السابعة — نظام إدارة مستودعات الأقمشة (ERP)*
