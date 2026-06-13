#!/usr/bin/env bash
# =============================================================================
# CLOTEX — نشر الواجهة + API على clotexerp.org
#
# ⚠️  لا تستخدم git pull origin main — فرع main يحتوي مشروع Obada (الأمل).
#     هذا السكربت يسحب فرع clotex فقط ويتأكد من اسم الحزمة قبل النشر.
#
# الاستخدام (على السيرفر داخل ~/ab-amal-erp):
#   chmod +x scripts/deploy-clotex-vps.sh
#   ./scripts/deploy-clotex-vps.sh
#
# متغيرات اختيارية:
#   CLOTEX_SKIP_GIT_PULL=1   تخطي git pull
#   CLOTEX_GIT_BRANCH=clotex  الفرع (افتراضي: clotex)
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CLOTEX_GIT_BRANCH="${CLOTEX_GIT_BRANCH:-clotex}"
CLOTEX_PM2_NAME="${CLOTEX_PM2_NAME:-clotexerp-server}"
CLOTEX_NGINX_SITE="${CLOTEX_NGINX_SITE:-clotexerp-org}"
EXPECTED_PKG="fabric-warehouse-erp"

echo "=============================================="
echo " CLOTEX — نشر VPS (clotexerp.org)"
echo " المسار: $ROOT"
echo "=============================================="

assert_clotex_tree() {
  local pkg
  pkg="$(node -p "require('./package.json').name" 2>/dev/null || echo '')"
  if [[ "$pkg" != "$EXPECTED_PKG" ]]; then
    echo ""
    echo "❌ خطأ: هذا المجلد ليس CLOTEX (package.json.name=$pkg)."
    echo "   غالباً أنت على فرع main (Obada). نفّذ:"
    echo "   git fetch origin"
    echo "   git checkout $CLOTEX_GIT_BRANCH"
    echo "   أو: git checkout acb5ebc   # آخر CLOTEX معروف على GitHub"
    exit 1
  fi
  if ! grep -q 'CLOTEX' index.html 2>/dev/null; then
    echo "❌ خطأ: index.html لا يحتوي CLOTEX — تحقق من الفرع."
    exit 1
  fi
  echo "✓ تحقق: CLOTEX ($EXPECTED_PKG)"
}

if [[ "${CLOTEX_SKIP_GIT_PULL:-}" != "1" ]]; then
  echo ">> git fetch + checkout $CLOTEX_GIT_BRANCH ..."
  git fetch origin
  if git show-ref --verify --quiet "refs/remotes/origin/$CLOTEX_GIT_BRANCH"; then
    git checkout "$CLOTEX_GIT_BRANCH"
    git pull origin "$CLOTEX_GIT_BRANCH"
  else
    echo ">> فرع origin/$CLOTEX_GIT_BRANCH غير موجود — استخدام acb5ebc (CLOTEX) ..."
    git checkout acb5ebc
  fi
fi

assert_clotex_tree

echo ">> npm install ..."
npm install

echo ">> بناء الواجهة ..."
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}" npm run build

if [[ ! -f dist/index.html ]]; then
  echo "❌ فشل البناء: dist/index.html غير موجود"
  exit 1
fi

FRONTEND_ROOT="$(sudo grep -E '^\s*root ' "/etc/nginx/sites-available/$CLOTEX_NGINX_SITE" 2>/dev/null | head -1 | awk '{print $2}' | tr -d ';' || true)"
if [[ -z "$FRONTEND_ROOT" ]]; then
  FRONTEND_ROOT="${CLOTEX_FRONTEND_ROOT:-/var/www/clotexerp/frontend}"
fi
echo ">> Frontend root: $FRONTEND_ROOT"

sudo rm -rf "${FRONTEND_ROOT:?}"/*
sudo cp -r dist/* "${FRONTEND_ROOT}/"
sudo chown -R www-data:www-data "$FRONTEND_ROOT"
sudo find "$FRONTEND_ROOT" -type d -exec chmod 755 {} \;
sudo find "$FRONTEND_ROOT" -type f -exec chmod 644 {} \;

if [[ -f "${FRONTEND_ROOT}/clotex-logo.png" ]]; then
  sudo cp "${FRONTEND_ROOT}/clotex-logo.png" "${FRONTEND_ROOT}/favicon.ico"
elif [[ -f "${FRONTEND_ROOT}/assets/logo-FKhVmTXu.png" ]]; then
  sudo cp "${FRONTEND_ROOT}/assets/"logo-*.png "${FRONTEND_ROOT}/favicon.ico" 2>/dev/null || true
fi

echo ">> pm2 restart $CLOTEX_PM2_NAME ..."
pm2 restart "$CLOTEX_PM2_NAME" --update-env

sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "✓ تم نشر CLOTEX"
echo "  تحقق: curl -sI http://127.0.0.1/ | head -1"
echo "  عنوان الصفحة يجب أن يحتوي CLOTEX وليس ALamal-AB"
