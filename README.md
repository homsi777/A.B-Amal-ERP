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

# 1) سحب آخر تحديث (إن لم تسحبيه بعد)
git pull origin main

# 2) بناء الواجهة
npm run build

# 3) استخراج مسار الواجهة من nginx تلقائياً
FRONTEND_ROOT=$(sudo grep -E '^\s*root ' /etc/nginx/sites-available/clotexerp-org | head -1 | awk '{print $2}' | tr -d ';')
echo "مسار الواجهة: $FRONTEND_ROOT"

# 4) نشر ملفات dist
sudo rm -rf "${FRONTEND_ROOT}"/*
sudo cp -r dist/* "${FRONTEND_ROOT}"/

# 5) إعادة تشغيل الـ backend
pm2 restart clotexerp-server --update-env

# 6) إعادة تحميل nginx
sudo nginx -t && sudo systemctl reload nginx