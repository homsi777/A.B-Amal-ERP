#!/usr/bin/env bash
# =============================================================================
# ALamal-AB Obada — نشر كامل على VPS بأمر واحد
#
# الاستخدام (على السيرفر داخل مجلد المشروع):
#   chmod +x scripts/deploy-vps.sh
#   ./scripts/deploy-vps.sh
#
# قبل التشغيل مرة واحدة:
#   1) قاعدة obada جاهزة على PostgreSQL
#   2) ملف server/.env مضبوط (PORT=4030, DATABASE_URL, JWT_SECRET, ...)
#      CORS_ORIGIN=http://65.21.136.217:2730
#      APP_BASE_URL=http://65.21.136.217:2730
#
# متغيرات اختيارية:
#   OBADA_SKIP_GIT_PULL=1     تخطي git pull
#   OBADA_SKIP_SEED=1       تخطي seed (تحديث لاحق)
#   OBADA_SKIP_NGINX=1      تخطي إعداد nginx
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── إعدادات Obada (عدّل هنا إن لزم) ─────────────────────────────────────────
OBADA_PUBLIC_HOST="${OBADA_PUBLIC_HOST:-65.21.136.217}"
OBADA_WEB_PORT="${OBADA_WEB_PORT:-2730}"
OBADA_API_PORT="${OBADA_API_PORT:-4030}"
OBADA_NGINX_ROOT="${OBADA_NGINX_ROOT:-/var/www/obada}"
OBADA_PM2_NAME="${OBADA_PM2_NAME:-obada-server}"
OBADA_NGINX_SITE="${OBADA_NGINX_SITE:-obada-vps}"
OBADA_PUBLIC_URL="http://${OBADA_PUBLIC_HOST}:${OBADA_WEB_PORT}"

echo "=============================================="
echo " ALamal-AB Obada — نشر VPS"
echo " المسار: $ROOT"
echo " الواجهة: $OBADA_PUBLIC_URL"
echo " API داخلي: 127.0.0.1:$OBADA_API_PORT"
echo "=============================================="

if [[ ! -f server/.env ]]; then
  echo "خطأ: server/.env غير موجود. انسخ من server/.env.example وعدّله أولاً."
  exit 1
fi

if ! grep -q '^DATABASE_URL=.' server/.env; then
  echo "خطأ: DATABASE_URL فارغ في server/.env"
  exit 1
fi

if grep -q 'كلمة_مرور_المدير' server/.env 2>/dev/null; then
  echo "تحذير: SEED_ADMIN_PASSWORD ما زال نصاً توضيحياً — عدّل server/.env قبل seed."
fi

# ── 1) جلب التحديثات ───────────────────────────────────────────────────────
if [[ "${OBADA_SKIP_GIT_PULL:-0}" != "1" ]] && [[ -d .git ]]; then
  echo ">> git pull..."
  git pull origin main || git pull
else
  echo ">> تخطي git pull"
fi

# ── 2) الحزم ───────────────────────────────────────────────────────────────
echo ">> npm install..."
npm install

# ── 3) بناء الواجهة (نفس المنشأ عبر nginx /api) ───────────────────────────
echo ">> إعداد .env للبناء..."
printf 'VITE_API_BASE_URL=\n' > .env

echo ">> npm run build..."
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}"
npm run build

# ── 4) قاعدة البيانات ──────────────────────────────────────────────────────
echo ">> migrate..."
npx tsx server/src/db/migrate.ts

if [[ "${OBADA_SKIP_SEED:-0}" != "1" ]]; then
  echo ">> seed..."
  npx tsx server/src/db/seed.ts
else
  echo ">> تخطي seed"
fi

# ── 5) نسخ الواجهة ────────────────────────────────────────────────────────
echo ">> نسخ dist إلى $OBADA_NGINX_ROOT ..."
sudo mkdir -p "$OBADA_NGINX_ROOT"
sudo rm -rf "${OBADA_NGINX_ROOT:?}"/*
sudo cp -r dist/* "$OBADA_NGINX_ROOT"/

# ── 6) PM2 — API داخلي ─────────────────────────────────────────────────────
echo ">> PM2 ($OBADA_PM2_NAME) على المنفذ $OBADA_API_PORT ..."
export PORT="$OBADA_API_PORT"

if pm2 describe "$OBADA_PM2_NAME" >/dev/null 2>&1; then
  PORT="$OBADA_API_PORT" pm2 restart "$OBADA_PM2_NAME" --update-env
else
  PORT="$OBADA_API_PORT" pm2 start npm --name "$OBADA_PM2_NAME" -- run server:start
fi
pm2 save

# ── 7) nginx ───────────────────────────────────────────────────────────────
if [[ "${OBADA_SKIP_NGINX:-0}" != "1" ]]; then
  echo ">> إعداد nginx ($OBADA_NGINX_SITE)..."
  TEMPLATE="$ROOT/scripts/nginx/obada-vps.conf"
  TARGET="/etc/nginx/sites-available/$OBADA_NGINX_SITE"
  TMP="$(mktemp)"

  sed \
    -e "s|WEB_PORT|$OBADA_WEB_PORT|g" \
    -e "s|PUBLIC_HOST|$OBADA_PUBLIC_HOST|g" \
    -e "s|API_PORT|$OBADA_API_PORT|g" \
    -e "s|NGINX_ROOT|$OBADA_NGINX_ROOT|g" \
    "$TEMPLATE" > "$TMP"

  sudo cp "$TMP" "$TARGET"
  rm -f "$TMP"
  sudo ln -sf "$TARGET" "/etc/nginx/sites-enabled/$OBADA_NGINX_SITE"
  sudo nginx -t
  sudo systemctl reload nginx
else
  echo ">> تخطي nginx"
fi

# ── 8) تحقق ────────────────────────────────────────────────────────────────
echo ">> تحقق API داخلي..."
curl -sf "http://127.0.0.1:${OBADA_API_PORT}/api/health/live" | head -c 200 || true
echo ""
echo ">> تحقق عبر nginx..."
curl -sf "${OBADA_PUBLIC_URL}/api/health/live" | head -c 200 || true
echo ""

echo "=============================================="
echo " تم النشر."
echo " افتح المتصفح: $OBADA_PUBLIC_URL"
echo " pm2 logs: pm2 logs $OBADA_PM2_NAME --lines 50"
echo "=============================================="
