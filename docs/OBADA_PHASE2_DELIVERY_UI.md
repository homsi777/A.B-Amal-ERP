# المرحلة 2 — واجهة التسليم والهوية (عربي فقط)

**التاريخ:** 2026-06-12  
**الحالة:** واجهة أولية — بدون ترجمة تركية

## ما نُفّذ

| البند | الملفات |
|-------|---------|
| ثيم ALamal الذهبي | `src/theme/themeTokens.ts` — `alamal-denim` |
| مصطلحات جملة | `src/lib/i18n/arTerminology.ts` — `AR_WHOLESALE` |
| قسم التسليم | `src/pages/delivery/DeliveryQueue.tsx` |
| تنفيذ + تفنيد | `src/pages/delivery/DeliveryFulfillment.tsx` |
| نافذة تفنيد | `src/components/delivery/TafnidModal.tsx` |
| API مؤقت | `src/lib/api/deliveryApi.ts` (فواتير مؤكدة) |
| قائمة علوية | `DashboardLayout` — رابط `/delivery` |
| نصوص عربية | `src/locales/ar/delivery.json` |

## القادم (المرحلة 3+)

- جداول `delivery_orders` في PostgreSQL
- فاتورة بيع بوحدة **توب**
- مستورد Excel الصين
- خصم مخزون بعد تأكيد التسليم
