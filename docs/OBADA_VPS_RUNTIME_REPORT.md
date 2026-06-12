# Obada على VPS — تقرير التشغيل الفعلي (مرجع صيانة)

> **لا تُعاد كل الخطوات يدوياً.** استخدم `./scripts/deploy-vps.sh` — يحافظ على الإعدادات الموثّقة هنا.

## المشاريع على نفس السيرفر

| المشروع | PM2 | API | الواجهة |
|---------|-----|-----|---------|
| شركة الشحن | `abooerp-backend` | `4010` | abooerp.org → nginx `:3000` |
| الأقمشة CLOTEX | `clotexerp-server` | `4020` | clotexerp.org → nginx `:80` |
| **Obada** | `obada-server` | `4030` | `65.21.136.217:2730` |

## مسارات Obada

| البند | القيمة |
|-------|--------|
| كود المشروع | `/home/ubuntu/obada` |
| Frontend | `/var/www/obada/frontend` |
| رابط المتصفح | `http://65.21.136.217:2730` |

## nginx — ملفان لـ Obada

### 1) `obada-vps` — المنفذ 2730

وصول مباشر داخل الشبكة:

```nginx
listen 2730;
server_name 65.21.136.217;
root /var/www/obada/frontend;
location /api/ { proxy_pass http://127.0.0.1:4030/api/; }
```

### 2) `obada-ip-3000` — workaround لـ Proxmox/NAT

التوجيه الخارجي يبدو:

```text
65.21.136.217:2730  →  192.168.2.27:3000
```

لذلك يُنشأ بلوك على `:3000` للـ IP فقط (`default_server`) دون إزالة abooerp.org من نفس المنفذ.

## بناء الواجهة (مهم)

`.env.production` على VPS:

```env
VITE_API_BASE_URL=
VITE_APP_BASE_URL=http://65.21.136.217:2730
```

**لا تضع** `VITE_API_BASE_URL=/api` — المسارات في الكود تبدأ بـ `/api/...` وتصبح `/api/api/...`.

السكربت يكتب هذا تلقائياً. الكود يعالج الخطأ إن وُجد.

## الحالة الحالية المتوقعة

- الواجهة تفتح شاشة تسجيل دخول Obada
- API متصل بقاعدة `obada`
- رسالة «يجب تفعيل النظام» = طبيعية — أدخل مفتاح التفعيل

## الحل النظيف لاحقاً (اختياري)

تعديل Port Forward في Proxmox:

```text
65.21.136.217:2730  →  192.168.2.27:2730
```

بعدها يمكن الاعتماد على `obada-vps` فقط (`OBADA_SKIP_NGINX_NAT=1`).

## أوامر صيانة سريعة

```bash
pm2 restart obada-server
curl -s http://127.0.0.1:4030/api/health
curl -s -H "Host: 65.21.136.217" http://127.0.0.1:3000/api/health/live
```
