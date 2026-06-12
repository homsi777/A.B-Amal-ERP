# Obada — المرحلة 3: جملة + تسليم + استيراد الصين

## ما أُضيف

### قاعدة البيانات (`034_obada_wholesale_delivery.sql`)
- وحدة `roll` في `sales_invoice_lines`
- `sales_invoices.delivery_status` (`IN_DELIVERY` / `FULFILLED`)
- جدول `delivery_fulfillment_lines` للتفنيد

### الخادم
- `POST/GET /api/delivery/*` — قائمة التسليم، التفاصيل، حفظ التفنيد، تأكيد التسليم
- تأكيد فاتورة البيع: **لا خصم مخزون** → `delivery_status = IN_DELIVERY`
- التسليم: خصم FIFO من أتواب الخامة بعد التفنيد
- توسيع Excel الصين (`chinaPackingListExpand`) + `source_type = CHINA_PACKING_LIST`
- باركود نظام دائماً لاستيراد الصين؛ `supplier_roll_ref` من رقم التوب

### الواجهة
- فاتورة بيع: عمود «عدد الأتواب» + `unit: roll`
- التسليم: ربط API حقيقي (تفنيد + تأكيد)
- المخزون: تسمية «باركود النظام» و«رقم توب المورد»

## النشر

```bash
cd ~/obada && git fetch origin main && git reset --hard origin/main && OBADA_SKIP_SEED=1 ./scripts/deploy-vps.sh
```

ثم على الخادم: `npm run server:migrate` (يُشغَّل تلقائياً ضمن deploy إن وُجد).
