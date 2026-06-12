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
#      CORS_ORIGIN=http://65.21.136.217:2830
#      APP_BASE_URL=http://65.21.136.217:2830
#      ملاحظة: 2730 = CLOTEX (الشحن القديم) — Obada يستخدم 2830 افتراضياً
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
OBADA_WEB_PORT="${OBADA_WEB_PORT:-2830}"
OBADA_API_PORT="${OBADA_API_PORT:-4030}"
LEGACY_PORTS_RE='(^|:)(4010|4020)([^0-9]|$)'
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

ensure_env_port() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" server/.env; then
    sed -i "s|^${key}=.*|${key}=${value}|" server/.env
  else
    printf '\n%s=%s\n' "$key" "$value" >> server/.env
  fi
}

echo ">> ضبط server/.env للمنافذ الصحيحة..."
if grep -E 'PORT=(4010|4020)' server/.env 2>/dev/null; then
  echo "تحذير: server/.env كان يحتوي منفذ CLOTEX القديم — يُصحَّح إلى $OBADA_API_PORT"
fi
ensure_env_port PORT "$OBADA_API_PORT"
ensure_env_port CORS_ORIGIN "$OBADA_PUBLIC_URL"
ensure_env_port APP_BASE_URL "$OBADA_PUBLIC_URL"

if grep -E "$LEGACY_PORTS_RE" server/.env 2>/dev/null | grep -v '^#'; then
  echo "تحذير: ما زال هناك 4010/4020 في server/.env — راجع الملف يدوياً."
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

# ── 5) نسخ الواجهة إلى /var/www/obada ─────────────────────────────────────
if [[ ! -f dist/index.html ]]; then
  echo "خطأ: dist/index.html غير موجود — فشل البناء. نفّذ npm run build يدوياً وراجع الأخطاء."
  exit 1
fi

echo ">> إنشاء مجلد nginx: $OBADA_NGINX_ROOT (مثال: /var/www/obada) ..."
sudo mkdir -p "$OBADA_NGINX_ROOT"
sudo rm -rf "${OBADA_NGINX_ROOT:?}"/*
echo ">> نسخ مخرجات dist/ إلى $OBADA_NGINX_ROOT ..."
sudo cp -a dist/. "$OBADA_NGINX_ROOT"/
if id www-data >/dev/null 2>&1; then
  sudo chown -R www-data:www-data "$OBADA_NGINX_ROOT"
fi
if [[ ! -f "$OBADA_NGINX_ROOT/index.html" ]]; then
  echo "خطأ: لم يُنسخ index.html إلى $OBADA_NGINX_ROOT — تحقق من صلاحيات sudo."
  exit 1
fi
echo ">> تم النسخ: $(find "$OBADA_NGINX_ROOT" -type f | wc -l) ملف(ات) في $OBADA_NGINX_ROOT"

# ── 6) PM2 — API داخلي ─────────────────────────────────────────────────────
echo ">> PM2 ($OBADA_PM2_NAME) على المنفذ $OBADA_API_PORT ..."

if pm2 describe "$OBADA_PM2_NAME" >/dev/null 2>&1; then
  pm2 delete "$OBADA_PM2_NAME" >/dev/null 2>&1 || true
fi
PORT="$OBADA_API_PORT" pm2 start npm --name "$OBADA_PM2_NAME" --cwd "$ROOT" -- run server:start
pm2 save

sleep 2
if ! curl -sf "http://127.0.0.1:${OBADA_API_PORT}/api/health/live" >/dev/null; then
  echo "تحذير: API لم يستجب على 127.0.0.1:${OBADA_API_PORT} — راجع: pm2 logs $OBADA_PM2_NAME --lines 40"
  pm2 logs "$OBADA_PM2_NAME" --lines 20 --nostream || true
fi

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

  echo ">> تعطيل مواقع nginx الأخرى على المنفذ $OBADA_WEB_PORT (إن وُجدت)..."
  for site in /etc/nginx/sites-enabled/*; do
    [[ -f "$site" ]] || continue
    base="$(basename "$site")"
    [[ "$base" == "$OBADA_NGINX_SITE" ]] && continue
    if grep -q "listen[[:space:]]\+${OBADA_WEB_PORT}\b" "$site" 2>/dev/null; then
      echo "   تعطيل $base (كان يستمع على $OBADA_WEB_PORT — غالباً CLOTEX)"
      sudo rm -f "$site"
    fi
  done

  sudo nginx -t
  sudo systemctl reload nginx
else
  echo ">> تخطي nginx"
fi

# ── 8) تحقق ────────────────────────────────────────────────────────────────
echo ">> تحقق API داخلي (4030)..."
if curl -sf "http://127.0.0.1:${OBADA_API_PORT}/api/health/live" | head -c 200; then
  echo ""
else
  echo "فشل — تحقق: grep ^PORT= server/.env && ss -lntp | grep ${OBADA_API_PORT}"
fi

echo ">> تحقق عبر nginx (${OBADA_WEB_PORT})..."
if curl -sf "${OBADA_PUBLIC_URL}/api/health/live" | head -c 200; then
  echo ""
else
  echo "فشل — تحقق: sudo nginx -T | grep -A3 'listen ${OBADA_WEB_PORT}'"
fi

if [[ -f "$OBADA_NGINX_ROOT/index.html" ]]; then
  if grep -q 'ALamal-AB' "$OBADA_NGINX_ROOT/index.html"; then
    echo ">> الواجهة المنشورة: ALamal-AB ✓"
  else
    echo "تحذير: index.html لا يحتوي ALamal-AB — قد يكون nginx يوجّه لمجلد خاطئ."
  fi
fi

if [[ "$OBADA_WEB_PORT" == "2730" ]]; then
  echo "تحذير: المنفذ 2730 يخص CLOTEX عادةً — استخدم 2830: OBADA_WEB_PORT=2830 ./scripts/deploy-vps.sh"
fi

echo "=============================================="
echo " تم النشر."
echo " افتح المتصفح: $OBADA_PUBLIC_URL"
echo " pm2 logs: pm2 logs $OBADA_PM2_NAME --lines 50"
echo "=============================================="
