# سجل تنفيذ المرحلة 0 + 1 — ALamal-AB Obada

> **التاريخ:** 2026-06-12  
> **المسار:** `obada/` فقط

## تم تنفيذه

### المرحلة 0 — استقلال تقني

- [x] منفذ API الافتراضي: **4030** (`server/src/config/env.ts`, `package.json`, electron)
- [x] واجهة Vite للتطوير: **3030**
- [x] قاعدة بيانات في الأمثلة والنفق: **`obada`**
- [x] `scripts/create-obada-database.sql`
- [x] `scripts/free-dev-port-4030.ps1`
- [x] مفاتيح localStorage منفصلة (`obada_erp_*`) — لا تتداخل مع CLOTEX
- [x] شركة البذرة: `ALAMAL-MAIN` / `ALamal-AB`
- [x] health service: `alamal-ab-obada-api`
- [x] `README.md` + `docs/ENV_OBADA_TEMPLATE.md`

### المرحلة 1 — الهوية (أساس)

- [x] `src/branding.ts` → ALamal-AB, DENIM & TEXTILE, ألوان ذهبية
- [x] `logo.png` + `public/alamal-logo.png` (شعار المدير)
- [x] `index.html` عنوان + favicon
- [x] `metadata.json`, `package.json` (electron-builder)
- [x] لصاقات seed/bootstrap: ALamal-AB

## المتبقي (يدوياً / سحابة)

- [ ] إنشاء DB `obada` على VPS (`scripts/create-obada-database.sql`)
- [ ] `server/.env` بقيم حقيقية (لا يُرفع لـ Git)
- [ ] مستودع GitHub جديد + أول push
- [ ] PM2 `obada-server` + nginx منفصل
- [ ] `migrate` + `seed` على قاعدة `obada`

## المرحلة التالية (2)

- قسم **التسليم** في القائمة والواجهة
