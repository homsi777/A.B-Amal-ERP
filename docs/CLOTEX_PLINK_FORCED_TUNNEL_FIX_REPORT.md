# CLOTEX — إجبار PuTTY plink في النسخة المغلّفة (Windows)

## الملخص

تم إصلاح فشل الاتصال في النسخة المغلّفة عبر إجبار استخدام **plink.exe** كنفق SSH ثابت عند `app.isPackaged === true`، دون استدعاء **ssh2** داخل asar، مع مسار مطلق تحت `process.resourcesPath`، انتظار منفذ محلي حتى **20 ثانية**، وتسجيل تشخيصي في ملف log.

## السبب الجذري (كما لوحظ)

في بيئة التطبيق المغلّفة، مسار **ssh2** أو spawn ديناميكي قد لا يعمل بشكل موثوق (asar، native، أو سياسات التنفيذ). **PuTTY plink** عملياً يثبت الاتصال عند تشغيله كعملية مستقلة مع مسار exe صريح.

## التغييرات

| المكوّن | التعديل |
|--------|---------|
| `electron/bin/README.txt` | تعليمات نسخ `plink.exe` من PuTTY إلى `electron/bin/` قبل البناء. |
| `electron/bin/` | يُضمَّن عبر `extraResources` إلى `resources/bin/` في المثبت / `win-unpacked`. |
| `package.json` → `build.extraResources` | إدخال ثانٍ: `from: electron/bin` → `to: bin`. |
| `.gitignore` | تجاهل `electron/bin/plink.exe` (لا رفع الثنائي إلى Git). |
| `electron/tunnel/deliveryVpsTunnel.ts` | عند `opts.packaged === true`: **فقط** `path.join(process.resourcesPath, 'bin', 'plink.exe')`، أمر مطابق لـ: `-ssh -P … -l … -pw … -L … <host> -N`، `stdio: 'ignore'`، `detached: false`، انتظار `127.0.0.1:<localDbPort>` 20 ثانية، سجل في `resources/logs/tunnel.log` مع احتياطي `userData/clotex-tunnel.log` إن تعذّر الكتابة تحت `resources`. |
| `electron/main.ts` | استدعاء `ensureDeliveryTunnel(cfg, { packaged: app.isPackaged })` في كل المواضع. |
| `scripts/dev-vps-auto.ts` | بدون تغيير: يستمر استخدام `ensureDeliveryTunnel(cfg)` (تطوير = ssh2 ثم plink الاحتياطي). |

## أمر plink المستخدم (مثال)

مع القيم من `vps-connection.json`:

```text
plink.exe -ssh -P 2727 -l ubuntu -pw "<password>" -L 5433:127.0.0.1:5432 65.21.136.217 -N
```

القيم الفعلية تُقرأ من JSON (`sshPort`, `sshUser`, `sshPassword`, `localDbPort`, `remoteDbHost`, `remoteDbPort`, `sshHost`).

## التحقق بعد التغليف

1. انسخ **PuTTY `plink.exe`** إلى `electron/bin/plink.exe` ثم نفّذ:
   - `npm run electron:build` أو `npm run electron:pack`
2. شغّل الـ `.exe` من `release\win-unpacked\` أو ثبّت الـ NSIS.
3. تأكد من وجود الملف:
   - `…\resources\bin\plink.exe`
4. من PowerShell (اختياري):
   - `netstat -ano | findstr 5433`  
   يجب أن يظهر المنفذ المحلي في حالة LISTENING بعد فتح التطبيق (أو أثناء محاولة النفق).
5. راجع السجل:
   - `…\resources\logs\tunnel.log`  
   أو إن فشلت الكتابة هناك: `%APPDATA%\CLOTEX — Clothes Textile\clotex-tunnel.log` (اسم مجلد userData يتبع `productName` في electron-builder).

## أمر التغليف الشامل (كما في المشروع)

```bash
npm run electron:build
```

يشمل: استخراج اللوغو من PDF (إن وُجد)، `vite build`، تجميع Electron، ثم **electron-builder** (NSIS + `win-unpacked` حسب `package.json`).

**شرط موثوقية النفق في الإنتاج:** وجود `electron/bin/plink.exe` قبل الأمر أعلاه؛ وإلا سيظهر خطأ صريح يشير إلى `electron/bin/README.txt`.

## الاتصال بقاعدة البيانات مقابل الـ API (مهم)

- النفق SSH يفتح **PostgreSQL على المنفذ المحلي** (مثل 5433) ليتحقق التطبيق من أن قاعدة البيانات على الـ VPS تستجيب عبر `pg`.
- **واجهة المستخدم** لا تتصل بقاعدة البيانات مباشرة؛ كل البيانات تمر عبر **خادم Fastify (HTTP/HTTPS)**.
- إذا كان البناء أُجري بـ `VITE_API_BASE_URL=http://127.0.0.1:4010`، فالنسخة المثبّتة تحاول الاتصال بـ API على **جهاز المستخدم** وليس على الـ VPS — فيظهر `ERR_CONNECTION_REFUSED`.

### الحل المطبّق

1. **`apiPublicUrl` في `vps-connection.json`** (مثال: `https://api.yourdomain.com` بدون شرطة أخيرة): عند التشغيل **مغلّفاً فقط**، يتم نسخ هذا العنوان إلى إعدادات سطح المكتب **`apiBaseUrl`** إذا كان العنوان المحفوظ ما زال الافتراضي (`localhost` / `127.0.0.1:4010`).
2. **CSP في الإنتاج**: تم توسيع `connect-src` ليشمل **`http:` و `https:`** حتى لا يحظر المتصفح داخل Electron طلبات الـ API إلى الـ VPS.
3. **Preload**: `desktopApiBaseAtBoot` يقرأ عنوان الـ API من الإعدادات **بشكل متزامن** قبل أول رسم للواجهة، و`getApiBaseUrl()` يعطيه أولوية بعد `localStorage`.

### plink وتجربة المضيف

- تمت إضافة **`-batch`** لتجنّب التعليق على سؤال مفتاح المضيف في وضع غير تفاعلي.
- إذا ظهر خطأ يتعلق بمفتاح المضيف، أضف **`sshHostKey`** في JSON (قيمة `-hostkey` كما في PuTTY)، أو شغّل `plink` يدوياً مرة واحدة لقبول المفتاح ثم أعد البناء.

## الحكم النهائي

تم إصلاح فشل الاتصال في النسخة المغلّفة عبر إجبار استخدام **plink.exe** كنفق SSH ثابت، مع **تهيئة عنوان الـ API العام** و**CSP** حتى يعمل الاتصال بالخادم البعيد كما هو متوقع.
