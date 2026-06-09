# MULTI-CURRENCY EXCHANGE RATE SYSTEM (USD Base) — Report

## 1) Summary
تم تنفيذ دعم تعدد العملات مع **USD كعملة أساس محاسبية**، مع دعم العملات:
- USD — الدولار الأمريكي
- SYP — الليرة السورية
- TRY — الليرة التركية
- EGP — الجنيه المصري

النظام يسمح بتحديد سعر الصرف من الإعدادات، ويخزن لكل مستند مالي:
- بيانات العملة الأصلية (currency_code + exchange_rate_to_usd + المبالغ الأصلية)
- بيانات الأساس بالدولار (حقول *_usd)

قاعدة التحويل المعتمدة (حاسمة محاسبياً):
- `exchange_rate_to_usd` = عدد وحدات العملة مقابل 1 USD
- `amount_usd = amount_original / exchange_rate_to_usd`

لا يتم إعادة احتساب مستندات قديمة بصمت عند تغيير سعر الصرف لاحقاً، لأن كل مستند يحتفظ بسعر الصرف المستخدم وقت الإنشاء/التأكيد.

## 2) Migration Added
- [018_exchange_rates_multi_currency_usd_base.sql](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/server/src/db/migrations/018_exchange_rates_multi_currency_usd_base.sql)
  - إنشاء جدول `exchange_rates`
  - Seed افتراضي لكل شركة: USD=1 (base) + SYP/TRY/EGP
  - إضافة أعمدة `exchange_rate_to_usd` وحقول `*_usd` إلى المستندات الأساسية (فواتير/مرتجعات/سندات/حركات صناديق/مناقلات)
  - Backfill محافظ لحقول USD عندما تكون قيمها صفرية/فارغة في بيانات قديمة (بدون تغيير المبالغ الأصلية)

## 3) Exchange Rates Table Design
جدول `exchange_rates` يحتوي (بشكل مختصر):
- company_id
- currency_code (USD/SYP/TRY/EGP)
- currency_name_ar / currency_name_en / currency_symbol
- exchange_rate_to_usd (numeric)
- is_base / is_active
- timestamps

قاعدة هامة:
- USD دائمًا `exchange_rate_to_usd = 1` ولا يمكن تعطيله.

## 4) Backend Exchange Rate API
ملفات:
- [exchangeRateRoutes.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/server/src/routes/exchangeRateRoutes.ts)
- [exchangeRateService.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/server/src/services/exchangeRateService.ts)

Endpoints:
- `GET /api/exchange-rates`
- `GET /api/exchange-rates/:currencyCode`
- `PUT /api/exchange-rates/:currencyCode`

السلوك:
- يتم ضمان وجود العملات الافتراضية للشركة عبر `ensureDefaultExchangeRates`.
- يتم التحقق من دعم العملة + صحة سعر الصرف + منع تغيير USD عن 1.

## 5) Settings UI Behavior (Exchange Rates)
تم إضافة إدارة أسعار الصرف ضمن الإعدادات بنفس الستايل الحالي (بدون إعادة تصميم).
السلوك:
- عرض العملات الأربعة
- تعديل سعر صرف SYP/TRY/EGP فقط
- منع تغيير USD عن 1 (واجهة + خادم)
- استخدام Toast غير حاجب (Non-blocking)

## 6) Invoice Currency Behavior
### 6.1 Invoice Form
يدعم اختيار عملة الفاتورة وتعبئة سعر الصرف تلقائياً من الإعدادات، مع السماح بتعديل سعر الصرف على مستوى المستند فقط.
عند الحفظ/التأكيد:
- تُرسل القيم الأصلية كما هي
- تُرسل أيضاً قيم USD المحسوبة وفق: `amount / rate`

### 6.2 Invoice Statement / Print View
تم تحديث كشف الفاتورة (بدون تغيير التصميم) لعرض:
- العملة
- سعر الصرف مقابل الدولار
- الإجمالي/المدفوع/المتبقي بالعملة الأصلية
- وعند كون العملة غير USD: عرض إجماليات USD أيضاً

ملف:
- [InvoiceStatement.tsx](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/pages/invoices/InvoiceStatement.tsx)

## 7) Voucher Currency Behavior
السندات تحتوي:
- `currency_code`
- `exchange_rate_to_usd`
- `amount` (بالعملة)
- `amount_usd` (بالدولار)

قاعدة أمان مهمة:
- عملة السند يجب أن تطابق عملة الصندوق المحدد، لمنع خلط الأرصدة.

## 8) Cashbox / Treasury Behavior
### 8.1 Cashbox Movements
تم توسيع سجل الحركات لعرض:
- المبلغ بالعملة + العملة
- سعر الصرف
- المبلغ بالدولار

ملفات:
- [cashboxRoutes.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/server/src/routes/cashboxRoutes.ts)
- [cashboxesApi.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/lib/api/cashboxesApi.ts)
- [TreasuryLog.tsx](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/pages/treasury/TreasuryLog.tsx)

### 8.2 Cashbox Transfers
حفظ `amount_usd` و`exchange_rate_to_usd` للمناقلة موجود على مستوى الخادم.
تحويل بين صندوقين بعملتين مختلفتين لا يتم تفعيله بصمت (يُفضّل إبقاؤه محجوباً حتى تعريف قواعد تحويل آمنة كاملة).

## 9) GL / Accounting Behavior
تم اعتماد USD كأساس للترحيل إلى القيود:
- يتم استخدام قيم `*_usd` للمبالغ عند الترحيل.
- لا يتم ترحيل العملة الأصلية إلى GL في هذه المرحلة.
- هذا يحافظ على اتساق القيود مع USD كعملة أساس.

## 10) Statements / Reports Behavior
تم تحديث منطق كشف الحساب على الخادم ليحسب الرصيد الرسمي بالدولار (USD) عبر:
- فواتير: `total_amount_usd`
- سندات: `amount_usd`
- مرتجعات: `total_amount_usd`

وفي الواجهة:
- عرض مبلغ الصف بالعملة الأصلية (مدين/دائن + العملة)
- عرض أعمدة USD (مدين/دائن/رصيد) كأساس رسمي

ملفات:
- [partyStatementService.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/server/src/services/partyStatementService.ts)
- [CustomerStatement.tsx](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/pages/customers/CustomerStatement.tsx)
- [SupplierStatement.tsx](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/pages/suppliers/SupplierStatement.tsx)

## 11) Conversion Formula Used
المعادلة الوحيدة المستخدمة:
- `usd = original / exchange_rate_to_usd`

أمثلة:
- 1,500,000 SYP / 15000 = 100 USD
- 750,000 SYP / 15000 = 50 USD

## 12) Files Created
لا توجد ملفات جديدة أساسية ضمن هذه المرحلة الأخيرة (عدا هذا التقرير).

## 13) Files Modified (Key)
Frontend:
- [InvoiceStatement.tsx](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/pages/invoices/InvoiceStatement.tsx)
- [invoiceDbMappers.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/lib/invoiceDbMappers.ts)
- [types/index.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/types/index.ts)
- [telegramInvoice.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/lib/telegramInvoice.ts)
- [ReturnInvoices.tsx](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/pages/ReturnInvoices.tsx)
- [returnsApi.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/lib/api/returnsApi.ts)
- [TreasuryLog.tsx](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/pages/treasury/TreasuryLog.tsx)
- [cashboxesApi.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/lib/api/cashboxesApi.ts)
- [partyStatementsApi.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/lib/api/partyStatementsApi.ts)
- [CustomerStatement.tsx](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/pages/customers/CustomerStatement.tsx)
- [SupplierStatement.tsx](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/src/pages/suppliers/SupplierStatement.tsx)

Backend:
- [exchangeRateRoutes.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/server/src/routes/exchangeRateRoutes.ts)
- [voucherRoutes.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/server/src/routes/voucherRoutes.ts)
- [cashboxRoutes.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/server/src/routes/cashboxRoutes.ts)
- [partyStatementService.ts](file:///c:/Users/Homsi/Desktop/نظام-إدارة-مستودعات-الأقمشة-(erp)/server/src/services/partyStatementService.ts)

## 14) Test Commands Run
- `npm run lint` ✅
- `npm run server:check` ✅
- `npm run test` ✅
- `npm run server:build` ✅

ملاحظة: هذه الأوامر لا تحتاج اتصال DB مباشر.

## 15) Test Results
- جميع الأوامر أعلاه نجحت بدون أخطاء.

## 16) Manual Test Checklist
### Settings
1. افتح الإعدادات → أسعار الصرف.
2. تحقق أن USD = 1 ولا يقبل التغيير أو التعطيل.
3. اضبط: SYP=15000, TRY=32, EGP=50.
4. احفظ وأعد التحميل.

### Sales Invoice
1. أنشئ فاتورة USD وتأكد `total_usd = total`.
2. أنشئ فاتورة SYP بقيمة 1,500,000 وسعر 15000.
3. تحقق أن الإجمالي بالدولار = 100.
4. احفظ/أكد وتحقق أن كشف الفاتورة يعرض العملة وسعر الصرف وإجماليات USD.

### Purchase Invoice
نفس خطوات فاتورة البيع.

### Vouchers
1. أنشئ سند قبض SYP بمبلغ 750,000 وسعر 15000.
2. تحقق `amount_usd = 50`.
3. جرّب اختيار صندوق USD مع سند SYP: يجب أن يُرفض برسالة عملة السند لا تطابق عملة الصندوق.

### Treasury Log
1. افتح سجل حركة الصناديق.
2. تحقق ظهور الأعمدة: سعر الصرف + المبلغ بالدولار.

### Statements
1. افتح كشف حساب عميل/مورد لديه مستندات بعملة غير USD.
2. تحقق عرض المبلغ بالعملة + أعمدة USD كأساس.

## 17) What Is Fully Completed
- جدول أسعار الصرف + API + واجهة الإعدادات
- تخزين العملة وسعر الصرف وقيم USD للمستندات الرئيسية
- كشف الفاتورة يعرض العملة وسعر الصرف وإجماليات USD (بدون إعادة تصميم)
- سجل الخزينة يعرض amount_usd وسعر الصرف
- كشف الحساب يعتمد USD كأساس رسمي ويعرض العملة الأصلية في الجدول

## 18) Partial / Intentionally Blocked
- تشغيل `electron:dev` و`electron:dev:stack` لم يتم التحقق منه داخل هذه الجولة (يتطلب تشغيل بيئة Electron وربما اتصال DB حسب إعداداتكم).
- المناقلات بين صندوقين بعملتين مختلفتين غير مفعلة تلقائياً (قرار أمان محاسبي).

## 19) Remaining Risks
- في حال وجود مستندات قديمة لا تحتوي قيم USD (قبل التحديث)، قد تظهر `—` لبعض حقول USD في العرض؛ لا يتم إعادة احتسابها بدون سعر صرف معروف.
- أي تقارير مالية إضافية خارج كشف الحساب/سجل الخزينة قد تحتاج اعتماد حقول USD صراحةً إذا كانت تفترض عملة واحدة.

## 20) Recommended Next Steps
1. تشغيل `npm run electron:dev` أو `npm run electron:dev:stack` على جهاز التشغيل والتحقق من عدم وجود أخطاء.
2. مراجعة أي تقرير مالي إضافي (إن وجد) لضمان الاعتماد على قيم USD كأساس.
3. إذا أردتم دعم مناقلات متعددة العملات بين صناديق مختلفة العملة: إضافة تدفق “تحويل صريح” مع مدخلات (مبلغ من/إلى + معدلات لكل عملة) وتخزين `from_amount/to_amount/amount_usd`.

