# Arabic UI terminology cleanup — report

## 1. Summary

User-visible English business and print labels were replaced with centralized, professional Arabic ERP wording. A single module (`src/lib/i18n/arTerminology.ts`) holds statement labels plus helpers for payment progress, sale terms (نقدي / آجل), document status mapping, and explicit accounting debit/credit helpers for future use. Invoice statement, sales/purchase lists, Telegram/PDF exports, roll labels, and related screens were updated **without** changing schemas, APIs, routes, layout, or calculations.

## 2. Files changed

| Area | File |
|------|------|
| Terminology hub (new) | `src/lib/i18n/arTerminology.ts` |
| Invoice statement / print | `src/pages/invoices/InvoiceStatement.tsx` |
| Invoice form tables | `src/pages/invoices/InvoiceForm.tsx` |
| Sales / purchase lists (payment badges) | `src/pages/Sales.tsx`, `src/pages/Purchases.tsx` |
| Return invoices (status display) | `src/pages/ReturnInvoices.tsx` |
| Navigation labels | `src/layouts/DashboardLayout.tsx` |
| Sticker / label print | `src/components/labels/LabelCard.tsx` |
| Roll details | `src/pages/inventory/RollDetails.tsx` |
| Customer/supplier PDF header | `src/lib/pdfExport.ts` |
| Telegram invoice message + HTML | `src/lib/telegramInvoice.ts` |
| This report | `docs/ARABIC_UI_TERMINOLOGY_CLEANUP_REPORT.md` |

## 3. Translation / mapping helpers

- **`AR_INVOICE_STATEMENT`** — static labels for كشف الفاتورة (headers, signatures, summary titles).
- **`arPaymentProgressFromInvoice`** — مدفوع / غير مدفوع / مدفوع جزئياً from amounts.
- **`arSaleTermsFromInvoice`** — نقدي / آجل / آجل مع دفعة جزئية (no use of English “Credit” for this path).
- **`arCashPartyFallbackLabel`** — عميل / مورد نقدي when there is no party id.
- **`arInvoicePaymentStatusCode`** — maps `Invoice['status']` (`paid` / `partial` / `unpaid`) to Arabic for badges and Telegram.
- **`arDocumentStatus`** — maps uppercase lifecycle enums (`DRAFT`, `CONFIRMED`, `CANCELLED`, …) for UI; unknown values fall back to the raw string.
- **`arAccountingDebitSide` / `arAccountingCreditSide`** — مدين / دائن for accounting context only (not wired everywhere; reserved for consistent future use).

## 4. Examples of replaced terms

| Before (user-visible) | After |
|------------------------|--------|
| Fabric Invoice / Packing List | فاتورة أقمشة / قائمة تعبئة |
| Paid / Partial / Unpaid (statement) | مدفوع / مدفوع جزئياً / غير مدفوع |
| Cash / Paid in full; Credit / Deferred | نقدي / مدفوع بالكامل؛ آجل؛ آجل مع دفعة جزئية |
| Order Nr, Meters, Net Weight (labels) | رقم الأمر، الأمتار، الوزن الصافي |
| FABRIC WAREHOUSE MANAGEMENT (PDF header) | إدارة مستودعات الأقمشة |
| Invoice status in Telegram (`paid`) | مدفوع (via mapper) |
| KG column headers (several places) | الوزن / إجمالي الوزن / كغ where shown with numbers |

## 5. How “Credit” was handled

- **Payment / sale terms** (invoice statement, Telegram narrative): deferred settlement is labeled **آجل**, never “Credit”. Partial deferral: **آجل مع دفعة جزئية**.
- **Accounting**: the UI already uses **مدين** and **دائن** in `Journal.tsx`. The terminology file exposes **`arAccountingCreditSide()` → دائن** and **`arAccountingDebitSide()` → مدين** so “credit” in a GL sense is never mixed with “آجل”.

## 6. Test commands run

```text
npm run lint
npm run server:check
npm run test
npm run server:build
```

## 7. Test results

All commands completed successfully (exit code 0). `fabricInvoiceSummary` tests passed.

## 8. Manual UI review checklist

1. **Sales** — table loads; payment badges show مدفوع / مدفوع جزئياً / غير مدفوع.
2. **Purchases** — same badges.
3. **InvoiceForm** — line grid headers; وزن column and totals.
4. **InvoiceStatement** — print view: Arabic headers, group subtotals, signatures أعدّها / سلّمها / استلمها.
5. **CustomerStatement / SupplierStatement** — PDF export header subtitle Arabic (sample export).
6. **Treasury / bonds** — quick scan for any new English (no code changes there in this pass).
7. **Journal** — debit/credit columns still مدين / دائن.
8. **Inventory / RollDetails** — GSM row label.
9. **Reports** — spot-check (no string changes in this pass beyond PDF/Telegram).
10. **Settings** — unchanged; placeholders may still show Latin examples where technical.

## 9. English terms intentionally kept

- **Currency codes** (USD, SAR, TRY) and **monetary symbols** in column titles like `الإجمالي ($)` where they encode the display currency convention.
- **GSM** in **وزن المتر المربع (GSM)** — industry-standard unit acronym after Arabic explanation.
- **Brand strings** from `BRAND` (name/tagline) where they are product identity, not generic ERP words.
- **`ERP`** badge on the printed statement header (small brand mark).
- **Server/API error messages** passed through `e.message` may still be English if the backend returns English.
- **Database-backed** account names, party names, and descriptions remain as stored.
- **Comment blocks** and **ASCII art** inside `LabelCard.tsx` source still illustrate the legacy English mill label layout; only rendered UI text was translated.

## 10. Risks and follow-up

- **`arDocumentStatus`** returns the raw value for unknown statuses; if new enums appear, extend the mapper.
- **Wide sweep** of every `src/pages/**/*.tsx` line was not done; remaining English may exist on low-traffic screens (e.g. some reports, import wizards, or rare error toasts). A follow-up grep for Latin placeholder text and `<th>` English in `reports/` and `purchases/` is recommended.
- **Telegram `caption`** still says `فاتورة بيع PDF` / `فاتورة شراء PDF` — “PDF” is a format marker; change if product policy requires full Arabic file-type wording.
