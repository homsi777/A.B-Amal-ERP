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
  echo ">> git fetch + checkout $CLOTEX_GIT_BRANCH (تجاهل تعديلات محلية على السيرفر) ..."
  git fetch origin
  if git show-ref --verify --quiet "refs/remotes/origin/$CLOTEX_GIT_BRANCH"; then
    git checkout "$CLOTEX_GIT_BRANCH"
    git reset --hard "origin/$CLOTEX_GIT_BRANCH"
  else
    echo ">> فرع origin/$CLOTEX_GIT_BRANCH غير موجود — استخدام acb5ebc (CLOTEX) ..."
    git checkout acb5ebc
  fi
fi

assert_clotex_tree

ensure_pdf_chrome() {
  if [[ -n "${PUPPETEER_EXECUTABLE_PATH:-}" ]] && [[ -x "$PUPPETEER_EXECUTABLE_PATH" ]]; then
    echo "✓ PUPPETEER_EXECUTABLE_PATH=$PUPPETEER_EXECUTABLE_PATH"
    return 0
  fi

  if [[ -x /usr/bin/google-chrome-stable ]] && ! readlink -f /usr/bin/google-chrome-stable | grep -q '/snap/'; then
    echo "✓ google-chrome-stable جاهز لتصدير PDF"
    return 0
  fi

  if [[ -x /usr/bin/google-chrome ]] && ! readlink -f /usr/bin/google-chrome | grep -q '/snap/'; then
    echo "✓ google-chrome جاهز لتصدير PDF"
    return 0
  fi

  echo ">> تثبيت Google Chrome (deb) لتصدير PDF — نسخة snap لا تعمل مع PM2 ..."
  TMP_DEB="$(mktemp /tmp/google-chrome.XXXXXX.deb)"
  wget -q -O "$TMP_DEB" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo dpkg -i "$TMP_DEB" || sudo apt-get install -f -y
  rm -f "$TMP_DEB"

  if [[ -x /usr/bin/google-chrome-stable ]]; then
    echo "✓ تم تثبيت google-chrome-stable"
    echo "   يُفضّل إضافة PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable في بيئة PM2"
  else
    echo "⚠️  تعذر تثبيت Chrome — تصدير PDF من الخادم قد يفشل (المتصفح يستخدم تصديراً احتياطياً)"
  fi
}

ensure_pdf_chrome

echo ">> npm install ..."
npm install

echo ">> بناء الخادم + ترحيلات قاعدة البيانات (مطلوب لأقسام جديدة مثل الكارتيله) ..."
npm run server:build
npm run server:migrate

echo ">> بناء الواجهة ..."
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}" npm run build

if [[ ! -f dist/index.html ]]; then
  echo "❌ فشل البناء: dist/index.html غير موجود"
  exit 1
fi

if grep -qE 'src="\./assets/' dist/index.html 2>/dev/null; then
  echo "❌ تحذير: dist/index.html يستخدم مسارات نسبية ./assets — تحديث الصفحة على مسار فرعي سيفشل."
  echo "   تأكد أن npm run build يضبط VITE_APP_BASE=/ (انظر package.json)."
  exit 1
fi
echo "✓ مسارات الأصول: جذر مطلق (/assets/) — مناسب لتحديث SPA"

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

NGINX_SITE_FILE="/etc/nginx/sites-available/$CLOTEX_NGINX_SITE"
if [[ -f "$NGINX_SITE_FILE" ]] && ! grep -q 'try_files.*index\.html' "$NGINX_SITE_FILE" 2>/dev/null; then
  echo ""
  echo "⚠️  nginx: لم يُعثر على try_files ... /index.html في $NGINX_SITE_FILE"
  echo "   بدونه، تحديث الصفحة على /inventory/... قد يعطي 404 أو شاشة بيضاء."
  echo "   أضِف من scripts/nginx-clotexerp-spa.snippet داخل location / للواجهة."
fi

echo ""
echo "✓ تم نشر CLOTEX"
echo "  تحقق: curl -sI http://127.0.0.1/ | head -1"

