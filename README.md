<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/423eaadc-a5fc-4988-b26d-071427be05b1

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev `
A.B-Amal-ERP
npm run lint
npm run server:check
npm run test
npm run server:build
npm run electron:dev













cd ~/ab-amal-erp

# ⚠️ مهم: لا تستخدم git pull origin main — main = مشروع Obada (الأمل)
# clotexerp.org يجب أن ينشر من فرع clotex فقط:

chmod +x scripts/deploy-clotex-vps.sh
./scripts/deploy-clotex-vps.sh

# ── إصلاح فوري إن لم يُرفع فرع clotex بعد ──
# git fetch origin && git checkout acb5ebc && ./scripts/deploy-clotex-vps.sh

# ── أو يدوياً (بدون السكربت) ──
# git fetch origin && git checkout clotex   # أو acb5ebc
# npm install && NODE_OPTIONS="--max-old-space-size=1024" npm run build
# FRONTEND_ROOT=$(sudo grep -E '^\s*root ' /etc/nginx/sites-available/clotexerp-org | head -1 | awk '{print $2}' | tr -d ';')
# sudo rm -rf "${FRONTEND_ROOT}"/* && sudo cp -r dist/* "${FRONTEND_ROOT}"/
# sudo cp "${FRONTEND_ROOT}/clotex-logo.png" "${FRONTEND_ROOT}/favicon.ico" 2>/dev/null || true
# pm2 restart clotexerp-server --update-env
# sudo nginx -t && sudo systemctl reload nginx