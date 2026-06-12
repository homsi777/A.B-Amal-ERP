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

## النشر على السحابة (أمر واحد)

**مرة واحدة:** قاعدة `obada` + ملف `server/.env` (انظر `docs/ENV_OBADA_TEMPLATE.md`)

```bash
cd ~/obada
chmod +x scripts/deploy-vps.sh
./scripts/deploy-vps.sh
```

يفتح النظام على: **`http://65.21.136.217:2730`**  
API داخلي: **`127.0.0.1:4030`** (عبر nginx `/api`)

**تحديث لاحق (بدون seed):**
```bash
OBADA_SKIP_SEED=1 ./scripts/deploy-vps.sh
```

**لا تشارك CLOTEX** منفذ 4010/4020 ولا قاعدة `fabric_erp`.
