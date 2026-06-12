# ALamal-AB · Obada — الخطة الشاملة للإعداد والتنفيذ

> **المسار الوحيد للعمل:**  
> `C:\Users\Homsi\Desktop\نظام-إدارة-مستودعات-الأقمشة-(erp)\obada`  
> **لا يُعدَّل المشروع الأب (CLOTEX) أبداً أثناء بناء Obada.**

| البند | القيمة |
|-------|--------|
| **اسم المشروع** | ALamal-AB · Obada · الامل.AB |
| **منفذ API (السحابة والتطوير)** | **4030** |
| **قاعدة البيانات** | **`obada`** (مستقلة تماماً عن `fabric_erp`) |
| **CLOTEX على السحابة** | منافذ **4010** و **4020** — لا نلمسها |

---

## 0. قاعدة ذهبية

```
كل تعديل · كل commit · كل نشر · كل migrate
        ↓
فقط داخل مجلد obada/
        ↓
قاعدة بيانات obada + منفذ 4030 + هوية ALamal-AB
```

---

## 1. البنية على السحابة (مستقل عن CLOTEX)

```
┌─────────────────────────────────────────────────────────┐
│  VPS                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ CLOTEX       │  │ (مشروع آخر)  │  │ Obada        │ │
│  │ API :4010    │  │ API :4020    │  │ API :4030    │ │
│  │ DB fabric_erp│  │ DB …         │  │ DB obada     │ │
│  │ clotexerp.org│  │ …            │  │ (نطاق جديد)  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
```

| المكون | Obada |
|--------|-------|
| مجلد السحابة | `~/obada` أو `~/alamal-ab-erp` (منفصل عن `~/ab-amal-erp`) |
| PM2 | `obada-server` — `PORT=4030` |
| PostgreSQL | قاعدة **`obada`** |
| nginx | موقع جديد (مثال: `obada.clotexerp.org` أو نطاق المدير) |
| GitHub | **مستودع جديد** — ليس فرعاً من CLOTEX |

---

## 2. المنافذ (4030)

### 2.1 السحابة

| الخدمة | المنفذ |
|--------|--------|
| Fastify / Node API | **4030** |
| PostgreSQL | **5432** (داخلي — اسم DB: `obada`) |
| nginx | 80/443 (يوجّه للواجهة + يبروكسي `/api` → 4030) |

### 2.2 التطوير المحلي (عند تشغيل CLOTEX و Obada معاً)

| المشروع | API | واجهة Vite (اقتراح) |
|---------|-----|---------------------|
| CLOTEX | 4010 / 4020 | 3000 |
| **Obada** | **4030** | **3030** (اختياري لتجنب التعارض) |

### 2.3 ملفات تُعدَّل لاحقاً (داخل `obada/` فقط)

| الملف | التعديل |
|-------|---------|
| `server/.env` | `PORT=4030` |
| `server/.env.example` | `PORT=4030` + مثال `DATABASE_URL` → `.../obada` |
| `server/src/config/env.ts` | default `PORT` → 4030 (اختياري) |
| `.env` (جذر) | `VITE_API_BASE_URL=http://127.0.0.1:4030` محلياً |
| `package.json` | `dev:electron` و `wait-on` → 4030 |
| `electron/main.ts` / `embedded-backend.ts` | مراجع 4010 → 4030 |
| `scripts/free-dev-port-*.ps1` | نسخة لـ 4030 أو تعديل المسار |
| `CORS_ORIGIN` | إضافة منفذ/نطاق Obada |

---

## 3. قاعدة البيانات `obada`

### 3.1 إنشاء على VPS (مرة واحدة)

```sql
CREATE DATABASE obada OWNER erp_user;
-- أو المستخدم الذي تستخدمونه لـ CLOTEX مع صلاحيات منفصلة
```

### 3.2 `server/.env` في Obada

```env
NODE_ENV=production
PORT=4030
DATABASE_URL=postgresql://erp_user:PASSWORD@127.0.0.1:5432/obada?sslmode=disable
JWT_SECRET=<مفتاح جديد مختلف عن CLOTEX>
CORS_ORIGIN=https://YOUR-OBADA-DOMAIN
APP_BASE_URL=https://YOUR-OBADA-DOMAIN
ACTIVATION_KEY_PEPPER=<قيمة جديدة>
```

**مهم:** لا تنسخ `JWT_SECRET` ولا `ACTIVATION_KEY_PEPPER` من CLOTEX.

### 3.3 تهيئة الجداول

```bash
cd obada
npx tsx server/src/db/migrate.ts
npx tsx server/src/db/seed.ts   # إن لزم
```

---

## 4. GitHub والنشر

### 4.1 مستودع جديد

1. من جذر `obada/` (ليس المجلد الأب):
   ```bash
   cd obada
   git init
   git remote add origin https://github.com/USER/ALamal-AB-Obada.git
   ```
2. `.gitignore` يستثني: `node_modules`, `dist`, `server/.env`, `.venv-i18n`
3. **لا ترفع** `server/.env` ولا كلمات مرور.

### 4.2 أول push

```bash
git add .
git commit -m "init: ALamal-AB Obada wholesale ERP fork from CLOTEX"
git push -u origin main
```

### 4.3 السحابة — أول نشر

```bash
cd ~/obada   # أو ~/alamal-ab-erp
git clone ... أو git pull
npm install
# إنشاء server/.env بقيم Obada (4030 + obada DB)
npx tsx server/src/db/migrate.ts
NODE_OPTIONS="--max-old-space-size=1024" npm run build
# nginx: جذر static من dist
pm2 start ... --name obada-server --update-env   # PORT=4030
sudo nginx -t && sudo systemctl reload nginx
```

### 4.4 PM2 (مثال)

```bash
PORT=4030 pm2 start server/dist/index.js --name obada-server
pm2 save
```

---

## 5. مراحل التنفيذ (الترتيب المحكم)

### المرحلة 0 — استقلال تقني (أولوية قصوى)

**الهدف:** Obada يعمل على السحابة بمنفذ 4030 وقاعدة `obada` — نفس شكل CLOTEX لكن مستقل.

| # | المهمة | المسار |
|---|--------|--------|
| 0.1 | تأكيد النسخ في `obada/` | محلي |
| 0.2 | `PORT=4030` + `DATABASE_URL=.../obada` | `obada/server/.env` |
| 0.3 | إنشاء DB `obada` على VPS | SQL |
| 0.4 | migrate + seed | `obada/` |
| 0.5 | مستودع GitHub جديد + push | `obada/` |
| 0.6 | نشر سحابة + PM2 `obada-server` | VPS |
| 0.7 | اختبار: تسجيل دخول + `/api/health/live` على 4030 | متصفح |

**معيار النجاح:** المدير يفتح النظام على نطاق/منفذ Obada ويسجّل دخولاً دون لمس CLOTEX.

---

### المرحلة 1 — الهوية البصرية ALamal-AB

**الهدف:** لا يظهر اسم CLOTEX في الواجهة.

| # | المهمة | الملفات الرئيسية (`obada/`) |
|---|--------|------------------------------|
| 1.1 | استبدال `logo.png` بشعار Alamal (AB ذهبي + DENIM&TEXTILE) | `logo.png`, `public/` |
| 1.2 | تحديث العلامة | `src/branding.ts` |
| 1.3 | عنوان المتصفح + favicon | `index.html`, `public/clotex-logo.png` → `alamal-logo.png` |
| 1.4 | ثيم ذهبي/داكن (من الشعار) | `src/theme/themeTokens.ts` |
| 1.5 | package / electron metadata | `package.json`, `metadata.json` |
| 1.6 | اسم الشركة في seed/bootstrap | `server/src/services/postActivationBootstrap.ts` |

| قبل | بعد |
|-----|-----|
| CLOTEX | **ALamal-AB** / **الامل.AB** |
| CLOTHES TEXTILE | **DENIM & TEXTILE** |
| ألوان نيلي | **ذهبي + فحمي + أبيض** |

**معيار النجاح:** شاشة الدخول والقائمة تعرض هوية Alamal فقط.

---

### المرحلة 2 — هيكل قسم التسليم (واجهة)

**الهدف:** مسار واضح قبل المنطق الكامل.

| # | المهمة |
|---|--------|
| 2.1 | عنصر قائمة **«التسليم»** |
| 2.2 | صفحة قائمة: فواتير «بانتظار التسليم» |
| 2.3 | صفحة تفاصيل طلب + زر طباعة إيصال (هيكل) |
| 2.4 | صلاحية أمين مستودع (لاحقاً) |

**ملفات جديدة مقترحة:**

```
obada/src/pages/delivery/DeliveryQueue.tsx
obada/src/pages/delivery/DeliveryDetail.tsx
obada/src/lib/api/deliveryApi.ts
obada/server/src/routes/deliveryRoutes.ts
```

---

### المرحلة 3 — استيراد شراء Excel الصين

**الهدف:** رفع ملف مثل `Roll List 336 DENIM.xls` → مخزون + محاسبة + تصنيفات.

| # | المهمة |
|---|--------|
| 3.1 | محلل DETAILED PACKING LIST (3 أعمدة متوازية) |
| 3.2 | معاينة: عدد أتواب، إجمالي م/ياردة، لوطات |
| 3.3 | تسعير متر/ياردة عند الاستيراد |
| 3.4 | إدخال تلقائي: `fabric_rolls` + فاتورة شراء + تصنيفات |
| 3.5 | باركود نظام + `supplier_roll_no` ظاهر |

**مرجع ملف:** `Roll List 336 DENIM.xls` (475 توب · 37,940 م).

---

### المرحلة 4 — فاتورة بيع بالتوب

| # | المهمة |
|---|--------|
| 4.1 | سطر الفاتورة: وحدة = **عدد الأتواب** (ليس المتر) |
| 4.2 | بعد التأكيد → حالة **IN_DELIVERY** (قسم التسليم) |
| 4.3 | لا خصم مخزون نهائي هنا |

---

### المرحلة 5 — التفنيد (Tafnid) داخل التسليم

| # | المهمة |
|---|--------|
| 5.1 | زر **تفنيد** لكل طلب تسليم |
| 5.2 | جدول: لكل توب — طول + متر/ياردة |
| 5.3 | تأكيد التسليم → خصم مخزون → إغلاق الطلب |
| 5.4 | طباعة إيصال أمين المستودع |

---

### المرحلة 6 — ما يبقى دون تغيير (تحقق فقط)

- كشف حساب عملاء
- كشف حساب موردين
- الصناديق والسندات
- التقارير العامة

---

## 6. خريطة الواجهة (ملخص)

```
تسجيل الدخول          ← شعار ALamal-AB (مرحلة 1)
القائمة الجانبية      ← + التسليم (مرحلة 2)
المشتريات             ← استيراد الصين (مرحلة 3)
المخزون               ← رقم مورد + باركود نظام (مرحلة 3)
فواتير البيع          ← بالتوب → التسليم (مرحلة 4)
التسليم               ← تفنيد + إيصال (مرحلة 5)
العملاء/الموردين/الصناديق/التقارير ← كما هي
```

---

## 7. قائمة تحقق قبل أول نشر سحابة

- [ ] المجلد `obada/` مكتمل ويعمل محلياً
- [ ] `server/.env`: `PORT=4030`
- [ ] `DATABASE_URL` ينتهي بـ `/obada`
- [ ] قاعدة `obada` مُنشأة على PostgreSQL
- [ ] `migrate.ts` نُفّذ على `obada` فقط
- [ ] مستودع GitHub منفصل
- [ ] PM2 اسم `obada-server` وليس `clotexerp-server`
- [ ] nginx منفصل أو server block جديد
- [ ] لم يُمس مشروع CLOTEX (4010/4020/fabric_erp)

---

## 8. الترتيب عند البدء بالتنفيذ (بعد موافقتك)

```
1. المرحلة 0  → 4030 + DB obada + GitHub + سحابة
2. المرحلة 1  → شعار ALamal-AB + ألوان
3. المرحلة 2  → قسم التسليم (هيكل)
4. المرحلة 3  → استيراد الصين
5. المرحلة 4  → بيع بالتوب
6. المرحلة 5  → التفنيد
```

---

## 9. وثائق المشروع (كلها داخل `obada/docs/` فقط)

| # | الوثيقة | الدور |
|---|---------|------|
| **1** | `ALAMAL_AB_OBADA_WHOLESALE_REQUIREMENTS.md` | **المتطلبات الحرفية** — شراء جملة، بيع بالتوب، تفنيد، تسليم، باركود |
| **2** | `OBADA_MASTER_SETUP_AND_IMPLEMENTATION_PLAN.md` | **خطة التنفيذ** — منفذ 4030، DB `obada`، GitHub، سحابة، مراحل 0–6 |
| **3** | `ENV_OBADA_TEMPLATE.md` | قالب `.env` لـ Obada |

**مرجع Excel نموذج:** `obada/Roll List 336 DENIM.xls` (إن وُجد في المجلد).

> **لا نرجع إلى مجلد CLOTEX الأب للتعديل أو للوثائق.** نسخة المتطلبات في `obada/docs/` هي المرجع المعتمد.

---

*جاهز للتنفيذ — كل العمل حصرياً داخل `obada/` · منفذ **4030** · قاعدة **`obada`** · هوية **ALamal-AB**.*
