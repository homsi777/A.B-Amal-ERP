# ALamal-AB · Obada

نظام ERP لجملة الدينيم والأقمشة — مشروع **مستقل** عن CLOTEX.

| البند | القيمة |
|-------|--------|
| منفذ API | **4030** |
| واجهة التطوير (Vite) | **3030** |
| قاعدة البيانات | **`obada`** |
| PM2 (سحابة) | `obada-server` |

## الوثائق

- `docs/README.md` — فهرس الوثائق
- `docs/ALAMAL_AB_OBADA_WHOLESALE_REQUIREMENTS.md` — متطلبات المدير
- `docs/OBADA_MASTER_SETUP_AND_IMPLEMENTATION_PLAN.md` — خطة التنفيذ
- `docs/ENV_OBADA_TEMPLATE.md` — قالب `.env`

## إعداد محلي

```bash
cd obada
npm install
cp server/.env.example server/.env
# عدّل DATABASE_URL → .../obada و PORT=4030
cp .env.example .env
npx tsx server/src/db/migrate.ts
npx tsx server/src/db/seed.ts
npm run dev:server    # API على 4030
npm run dev           # واجهة على 3030
```

## النشر على السحابة

```bash
# 1) إنشاء قاعدة (مرة واحدة على VPS)
psql -U postgres -f scripts/create-obada-database.sql

# 2) على السيرفر
cd ~/obada
git pull origin main
npm install
# server/.env: PORT=4030, DATABASE_URL=.../obada
npx tsx server/src/db/migrate.ts
NODE_OPTIONS="--max-old-space-size=1024" npm run build
sudo cp -r dist/* /path/to/obada/nginx/root/
PORT=4030 pm2 restart obada-server --update-env
sudo nginx -t && sudo systemctl reload nginx
```

**لا تشارك CLOTEX** منفذ 4010/4020 ولا قاعدة `fabric_erp`.
