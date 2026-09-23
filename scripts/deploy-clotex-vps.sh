#!/usr/bin/env bash
# =============================================================================
# CLOTEX — نشر VPS (clotexerp.org) — نسخة آمنة بلا أي أمر حذف
#
# يُشغَّل يدوياً من قبل نبيل داخل جلسة SSH تفاعلية (ssh -t)، حتى تعمل موجّهات
# sudo بشكل طبيعي — لا يستخدم sudo -S ولا يمرّر كلمة السر بأي شكل.
#
#   ssh -t ubuntu@<host> -p <port>
#   cd ~/ab-amal-erp && ./scripts/deploy-clotex-vps.sh           # تنفيذ فعلي
#   cd ~/ab-amal-erp && ./scripts/deploy-clotex-vps.sh --dry-run # عرض فقط، بلا تنفيذ
#
# لا يحذف أي شيء إطلاقاً (لا rm، لا rsync --delete، لا find -delete). كل نشر
# ينسخ إلى مجلد إصدار جديد بختم زمني، ثم يبدّل رمزاً (symlink) بشكل ذرّي.
# الإصدارات القديمة تبقى في مكانها — نبيل يحذفها يدوياً متى أراد.
# =============================================================================

set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

# ── إعدادات ثابتة (لا تُبنى من متغيرات بيئة قابلة للتفريغ) ──────────────────
readonly APP_ROOT="/home/ubuntu/ab-amal-erp"
readonly RELEASES_ROOT="/var/www/clotexerp/releases"
readonly CURRENT_LINK="/var/www/clotexerp/current"
readonly PM2_NAME="clotexerp-server"
readonly GIT_BRANCH="clotex"
readonly BACKUP_DIR="${HOME:?}/backups"
readonly TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
readonly RELEASE_DIR="${RELEASES_ROOT}/${TIMESTAMP}"

log() { echo ">> $*"; }
err() { echo "❌ $*" >&2; }

# ينفّذ الأمر فعلياً، أو يطبعه فقط مع كل المتغيرات مُستبدَلة بقيمها الحقيقية
# إن كان --dry-run — لا حذف مطلقاً هنا مهما كانت الحالة.
run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    [dry-run] $*"
  else
    "$@"
  fi
}

confirm() {
  local prompt="$1"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    [dry-run] (تخطّي التأكيد) $prompt"
    return 0
  fi
  read -r -p "$prompt [y/N] " reply
  if [[ "$reply" != "y" && "$reply" != "Y" ]]; then
    err "أُلغي النشر عند: $prompt"
    exit 1
  fi
}

cd "${APP_ROOT:?}" || exit 1

# ── الخطوة أ: نسخة احتياطية قبل أي تعديل ────────────────────────────────────
log "الخطوة أ: نسخة احتياطية من قاعدة البيانات قبل النشر"
mkdir -p "${BACKUP_DIR:?}"
readonly BACKUP_FILE="${BACKUP_DIR}/fabric_erp_predeploy_${TIMESTAMP}.dump"
confirm "أخذ نسخة احتياطية إلى ${BACKUP_FILE}؟"
run sudo -u postgres pg_dump -Fc fabric_erp -f "${BACKUP_FILE:?}"
run pg_restore --list "${BACKUP_FILE:?}"
if [[ "$DRY_RUN" != "1" ]]; then
  ls -lh "${BACKUP_FILE}"
fi
echo ""
echo "  ⬇ نزّل هذه النسخة إلى جهازك الآن من PowerShell على جهازك (وليس على السيرفر):"
echo "  scp -P <منفذ SSH> ubuntu@<عنوان السيرفر>:${BACKUP_FILE} ."
echo ""
confirm "هل نزّلت النسخة الاحتياطية بنجاح وتأكدت من وجودها على جهازك؟ (لا تكمل قبل ذلك)"

# ── الخطوة ب: عرض الترحيلات المعلّقة قبل تطبيقها ────────────────────────────
log "الخطوة ب: git fetch + checkout ${GIT_BRANCH} (بدون أي حذف — reset --hard على الشيفرة فقط، ليس على قاعدة البيانات)"
run git fetch origin
run git checkout "${GIT_BRANCH:?}"
run git reset --hard "origin/${GIT_BRANCH:?}"

log "الترحيلات المعلّقة (موجودة بالمجلد وغير مسجَّلة في schema_migrations):"
if [[ "$DRY_RUN" != "1" ]]; then
  comm -23 \
    <(ls server/src/db/migrations/*.sql | xargs -n1 basename | sort) \
    <(sudo -u postgres psql -d fabric_erp -tAc "SELECT filename FROM schema_migrations ORDER BY filename" | sort) \
    || true
else
  echo "    [dry-run] comm -23 <(ls server/src/db/migrations/*.sql) <(psql ... SELECT filename FROM schema_migrations)"
fi
confirm "تطبيق الترحيلات أعلاه على قاعدة الإنتاج؟"

log "npm install"
run npm install

log "بناء الخادم + تطبيق الترحيلات"
run npm run server:build
run npm run server:migrate

log "بناء الواجهة"
run bash -c 'NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}" npm run build'

if [[ "$DRY_RUN" != "1" ]] && [[ ! -f dist/index.html ]]; then
  err "فشل البناء: dist/index.html غير موجود"
  exit 1
fi

# ── الخطوة ج: نسخ لمجلد إصدار جديد + تبديل الرمز الرمزي (بدون حذف أي شيء) ──
log "الخطوة ج: نسخ إلى مجلد إصدار جديد + تبديل الرمز الرمزي"
confirm "نسخ البناء إلى ${RELEASE_DIR} وتفعيله كحالي؟"
run sudo mkdir -p "${RELEASE_DIR:?}"
run sudo cp -r dist/. "${RELEASE_DIR:?}/"
run sudo chown -R www-data:www-data "${RELEASE_DIR:?}"
run sudo find "${RELEASE_DIR:?}" -type d -exec chmod 755 {} \;
run sudo find "${RELEASE_DIR:?}" -type f -exec chmod 644 {} \;

# تبديل ذرّي: رمز مؤقت ثم mv -T فوق الرمز الحالي (لا يوجد لحظة بلا هدف صالح،
# ولا يُحذف أي إصدار سابق — current فقط يتغيّر ليشير لمكان آخر).
readonly TMP_LINK="${CURRENT_LINK}.next"
run sudo ln -sfn "${RELEASE_DIR:?}" "${TMP_LINK:?}"
run sudo mv -T "${TMP_LINK:?}" "${CURRENT_LINK:?}"
echo "  current -> ${RELEASE_DIR} (الإصدارات السابقة بقيت في ${RELEASES_ROOT}، لم يُحذف شيء)"

# ── الخطوة د: إعادة تشغيل الخدمات ───────────────────────────────────────────
log "الخطوة د: إعادة تشغيل الخدمات"
confirm "إعادة تشغيل pm2 وإعادة تحميل nginx؟"
run pm2 restart "${PM2_NAME:?}" --update-env
run sudo nginx -t
run sudo systemctl reload nginx

# ── الخطوة هـ: فحص الصحة ────────────────────────────────────────────────────
log "الخطوة هـ: فحص الصحة (/api/health يجب أن يرجع database: connected)"
if [[ "$DRY_RUN" != "1" ]]; then
  sleep 2
  HEALTH_RESPONSE="$(curl -s http://127.0.0.1/api/health || true)"
  echo "  $HEALTH_RESPONSE"
  if [[ "$HEALTH_RESPONSE" != *'"database":"connected"'* ]]; then
    err "فحص الصحة فشل — راجع القسم «التراجع» أسفل هذا الملف."
    exit 1
  fi
else
  echo "    [dry-run] curl -s http://127.0.0.1/api/health"
fi

echo ""
echo "✓ تم نشر CLOTEX بنجاح — current -> ${RELEASE_DIR}"

# =============================================================================
# تغيير nginx لمرة واحدة (مُطبَّق يدوياً من نبيل، غير منفّذ من هذا السكربت) —
# =============================================================================
#
# في /etc/nginx/sites-available/clotexerp-org، غيّر سطر root ليشير إلى:
#
#   root /var/www/clotexerp/current;
#
# بدل المسار الحالي (كان يشير مباشرة لمجلد واحد ثابت يُستبدل محتواه بالكامل
# بكل نشر — نمط الحذف القديم الذي أدى للحادثة). بعد هذا التغيير الوحيد،
# كل نشر لاحق فقط يبدّل وجهة current، ولا يلمس nginx.conf مرة أخرى.
# طبّق هذا التغيير يدوياً، ثم: sudo nginx -t && sudo systemctl reload nginx
#
# =============================================================================
# التراجع (Rollback) — يدوي، خطوة بخطوة، بدون حذف أي شيء
# =============================================================================
#
# 1) اعثر على الإصدار السابق:
#      ls -1t /var/www/clotexerp/releases | sed -n '2p'
# 2) أعد توجيه current إليه (نفس أسلوب التبديل الذري أعلاه):
#      sudo ln -sfn /var/www/clotexerp/releases/<الإصدار_السابق> /var/www/clotexerp/current.next
#      sudo mv -T /var/www/clotexerp/current.next /var/www/clotexerp/current
# 3) إن كان الترحيل الأخير هو سبب المشكلة، لا يوجد "تراجع تلقائي" عن SQL —
#    استعد النسخة الاحتياطية من الخطوة أ يدوياً بعد مراجعة الوضع مع الفريق:
#      pg_restore --clean --if-exists -d fabric_erp <ملف .dump>
#    هذا أمر إعادة استعادة كامل — لا يُنفَّذ إلا بعد قرار واضح، ويستبدل بيانات
#    القاعدة الحالية بالكامل، لذا خذ نسخة احتياطية من الحالة الحالية أولاً.
# 4) أعد تشغيل الخدمات:
#      pm2 restart clotexerp-server --update-env
#      sudo nginx -t && sudo systemctl reload nginx
# =============================================================================
