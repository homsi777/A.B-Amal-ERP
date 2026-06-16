#!/usr/bin/env bash
# =============================================================================
# إصلاح سريع: http://IP:2730 يفتح abooerp.org بدلاً من Alamal-AB Obada
#
# السبب: Proxmox يوجّه المنفذ الخارجي 2730 داخلياً إلى 3000 (موقع abooerp).
# الحل: nginx block obada-ip-3000 على :3000 كـ default_server للـ IP.
#
# الاستخدام (على VPS داخل ~/obada):
#   chmod +x scripts/fix-obada-browser-redirect.sh
#   ./scripts/fix-obada-browser-redirect.sh
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OBADA_PUBLIC_HOST="${OBADA_PUBLIC_HOST:-65.21.136.217}"
OBADA_WEB_PORT="${OBADA_WEB_PORT:-2730}"
OBADA_API_PORT="${OBADA_API_PORT:-4030}"
OBADA_NAT_INTERNAL_PORT="${OBADA_NAT_INTERNAL_PORT:-3000}"
OBADA_NGINX_ROOT="${OBADA_NGINX_ROOT:-/var/www/obada/frontend}"
OBADA_NGINX_SITE_NAT="${OBADA_NGINX_SITE_NAT:-obada-ip-3000}"
OBADA_PUBLIC_URL="http://${OBADA_PUBLIC_HOST}:${OBADA_WEB_PORT}"

render_nginx_site() {
  local template="$1"
  local output="$2"
  sed \
    -e "s|WEB_PORT|$OBADA_WEB_PORT|g" \
    -e "s|NAT_PORT|$OBADA_NAT_INTERNAL_PORT|g" \
    -e "s|PUBLIC_HOST|$OBADA_PUBLIC_HOST|g" \
    -e "s|API_PORT|$OBADA_API_PORT|g" \
    -e "s|NGINX_ROOT|$OBADA_NGINX_ROOT|g" \
    "$template" > "$output"
}

strip_default_server_on_nat_port() {
  local site="$1"
  [[ -f "$site" ]] || return 0
  local base
  base="$(basename "$site")"
  [[ "$base" == "$OBADA_NGINX_SITE_NAT" ]] && return 0
  if grep -q "listen[[:space:]]\+${OBADA_NAT_INTERNAL_PORT}\b" "$site" 2>/dev/null \
     && grep -q "default_server" "$site" 2>/dev/null; then
    echo ">> إزالة default_server من $base على :$OBADA_NAT_INTERNAL_PORT (يخدم abooerp.org فقط)"
    sudo sed -i "s/listen[[:space:]]\\+${OBADA_NAT_INTERNAL_PORT}\\([^;]*\\)[[:space:]]*default_server/listen ${OBADA_NAT_INTERNAL_PORT}\\1/g" "$site"
    sudo sed -i "s/default_server[[:space:]]*;//g" "$site"
  fi
}

echo "=============================================="
echo " إصلاح توجيه Obada (NAT :${OBADA_WEB_PORT} -> :${OBADA_NAT_INTERNAL_PORT})"
echo "=============================================="

if [[ ! -f "$ROOT/scripts/nginx/obada-ip-3000.conf" ]]; then
  echo "خطأ: قالب nginx غير موجود — تأكد أنك داخل مجلد obada."
  exit 1
fi

if [[ ! -d "$OBADA_NGINX_ROOT" ]] || [[ ! -f "$OBADA_NGINX_ROOT/index.html" ]]; then
  echo "تحذير: $OBADA_NGINX_ROOT غير جاهز — شغّل ./scripts/deploy-vps.sh أولاً."
fi

echo ">> إنشاء/تحديث $OBADA_NGINX_SITE_NAT ..."
TMP_NAT="$(mktemp)"
render_nginx_site "$ROOT/scripts/nginx/obada-ip-3000.conf" "$TMP_NAT"
sudo cp "$TMP_NAT" "/etc/nginx/sites-available/$OBADA_NGINX_SITE_NAT"
rm -f "$TMP_NAT"
sudo ln -sf "/etc/nginx/sites-available/$OBADA_NGINX_SITE_NAT" "/etc/nginx/sites-enabled/$OBADA_NGINX_SITE_NAT"

echo ">> ضمان أن Obada هو default_server الوحيد على :$OBADA_NAT_INTERNAL_PORT ..."
for site in /etc/nginx/sites-enabled/* /etc/nginx/sites-available/*; do
  strip_default_server_on_nat_port "$site"
done

sudo nginx -t
sudo systemctl reload nginx

echo ">> تحقق ..."
if curl -sf -H "Host: ${OBADA_PUBLIC_HOST}" "http://127.0.0.1:${OBADA_NAT_INTERNAL_PORT}/api/health/live" | head -c 200; then
  echo ""
  echo ">> API Obada على :$OBADA_NAT_INTERNAL_PORT ✓"
else
  echo "فشل health — تحقق: pm2 logs obada-server --lines 30"
fi

if [[ -f "$OBADA_NGINX_ROOT/index.html" ]]; then
  if grep -q 'Alamal Trading' "$OBADA_NGINX_ROOT/index.html"; then
    echo ">> الواجهة: Alamal Trading ✓"
  else
    echo "تحذير: index.html لا يحتوي Alamal — أعد النشر: ./scripts/deploy-vps.sh"
  fi
fi

echo "=============================================="
echo " افتح المتصفح: $OBADA_PUBLIC_URL"
echo " يجب أن ترى شاشة Alamal-AB وليس abooerp.org"
echo "=============================================="
