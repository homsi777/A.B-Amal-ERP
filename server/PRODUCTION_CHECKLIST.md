# قائمة التحقق قبل النشر (VPS)

```bash
npm run predeploy:check
npm run server:migrate
npm run audit:financial
```

## الأوامر

| الأمر | الوصف |
|--------|--------|
| `npm run server:check` | فحص TypeScript للخادم |
| `npm run lint` | فحص TypeScript للواجهة |
| `npm run test` | اختبارات الوحدة (فواتير، مرتجعات، سندات) |
| `npm run audit:financial` | تدقيق محاسبي read-only (يتطلب DATABASE_URL) |
| `npm run predeploy:check` | يشغّل check + lint + test معاً |

## تدقيق محاسبي عبر API (admin)

- `GET /api/financial-audit/full` — تقرير كامل
- `GET /api/financial-audit/invoice-consistency` — اتساق الفواتير فقط

يتطلب JWT لمستخدم `admin` أو صلاحية `settings.manage`.

## مؤجّل

- تسوية `MIXED` للمرتجعات — غير مفعّلة بعد.
