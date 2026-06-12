# قالب إعدادات Obada — لا ترفع هذا الملف بقيم حقيقية إلى Git

انسخ إلى `obada/server/.env` وعدّل القيم.

```env
NODE_ENV=development
PORT=4030

# قاعدة بيانات مستقلة — اسم DB: obada
DATABASE_URL=postgresql://erp_user:YOUR_PASSWORD@127.0.0.1:5433/obada?sslmode=disable

JWT_SECRET=CHANGE_ME_OBADA_ONLY_MIN_32_CHARS
JWT_EXPIRES_IN=7d

CORS_ORIGIN=http://65.21.136.217:2730
APP_BASE_URL=http://65.21.136.217:2730

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

ACTIVATION_KEY_PEPPER=CHANGE_ME_OBADA_PEPPER
ACTIVATION_GENERATE_DEV_KEYS=false
ACTIVATION_REQUIRE_ACTIVE=true

SEED_ADMIN_PASSWORD=
```

جذر المشروع `obada/.env`:

```env
VITE_API_BASE_URL=http://127.0.0.1:4030
```

**السحابة (بدون دومين):**
```env
CORS_ORIGIN=http://65.21.136.217:2730
APP_BASE_URL=http://65.21.136.217:2730
```
الواجهة للمتصفح: `http://65.21.136.217:2730` — nginx يوجّه `/api` إلى `127.0.0.1:4030`.

**نشر دفعة واحدة:** `./scripts/deploy-vps.sh`
