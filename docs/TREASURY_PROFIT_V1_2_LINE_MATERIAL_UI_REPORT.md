# Treasury Profit V-1.2 Line/Material UI Report

Date: 2026-05-17

## 1. Executive Summary

V-1.2 adds the safe UI layer for the Treasury detailed profit report line/material mode.

The existing Treasury page remains the same page and keeps the current visual style. Users can now switch between invoice summary and line/material details, apply basic filters, and see material, code, color, barcode, supplier, and warehouse fields in line mode.

No accounting posting, sales confirmation, old invoice data, payment allocation, or returns logic was changed.

## 2. What V-1.2 Implemented

- Added `طريقة العرض` selector:
  - `ملخص الفواتير`
  - `تفصيل حسب الخامة`
- Added top filters:
  - `من تاريخ`
  - `إلى تاريخ`
  - `العميل`
  - `حالة الدفع`
  - `كود الخامة`
  - `المورد`
  - `المستودع`
- Added `تحديث` and `مسح` controls.
- Added line/material table rendering when `detailLevel=line`.
- Kept invoice table rendering when `detailLevel=invoice`.
- Kept cost quality badges visible in both modes.
- Added calm warning display from backend `warnings` and `meta.note`.

## 3. Files Changed

- `src/pages/treasury/ProfitDetails.tsx`
- `server/src/services/reportServiceMore.ts`
- `docs/TREASURY_PROFIT_V1_2_LINE_MATERIAL_UI_REPORT.md`

## 4. UI Filters Added

The page now loads lightweight lookup lists through existing APIs:

- customers from `listCustomers({ status: 'active', pageSize: 200 })`
- suppliers from `listSuppliers({ status: 'active', pageSize: 200 })`
- warehouses from `listWarehouses({ status: 'active' })`

Filters:

- Date filters apply in both modes.
- Customer applies in both modes.
- Payment status applies in both modes.
- Material code applies in line mode.
- Supplier applies in line mode.
- Warehouse applies in line mode.

Supplier, warehouse, and material code controls are disabled in invoice mode to avoid implying unsupported invoice-summary filtering.

## 5. detailLevel Behavior

Default:

`detailLevel=invoice`

This preserves the existing invoice summary behavior.

Line/material mode:

`detailLevel=line`

The frontend sends this to the same endpoint:

`GET /api/reports/financial/profit-details`

## 6. Line/Material Table Columns

Line mode displays:

- التاريخ
- رقم الفاتورة
- العميل
- حالة الدفع
- الخامة
- كود الخامة
- اللون
- الباركود
- المورد
- المستودع
- الكمية
- الوحدة
- إجمالي البيع
- إجمالي التكلفة
- الربح
- المحصل
- المتبقي
- جودة التكلفة

Missing values display as `-`.

## 7. Backend Query Parameters Used

Frontend sends:

- `fromDate`
- `toDate`
- `detailLevel`
- `customerId`
- `paymentStatus`
- `materialCode` in line mode
- `supplierId` in line mode
- `warehouseId` in line mode
- `pageSize=100`

## 8. Backend Changes

V-1.2 made a small backend summary improvement for line mode by calculating:

- proportional collected amount total
- proportional remaining amount total
- proportional realized profit
- proportional receivable profit

This does not implement exact payment allocation. It only supports line-mode managerial display using the existing V-1.1 proportional method.

## 9. Warning and Metadata Behavior

Warnings are displayed above the summary cards.

Possible warnings:

- missing cost
- current cost fallback
- partial cost
- voucher allocation limitation

When line mode is selected, the UI also shows:

`المحصل والمتبقي موزعان نسبياً حسب قيمة البند.`

## 10. Tests Run

Commands to run:

- `npm run lint`
- `npm run server:check`
- `npm run test`
- `npm run server:build`
- `npm run server:bundle`
- `npm run electron:compile`

`electron:dev` / `electron:dev:stack` are long-lived workflows. The non-long-running verification remains `electron:compile`.

## 11. Test Results

Results:

- `npm run lint` - passed.
- `npm run server:check` - passed.
- `npm run test` - passed, `fabricInvoiceSummary tests passed`.
- `npm run server:build` - passed and synced SQL migrations to `server-dist/db/migrations`.
- `npm run server:bundle` - passed and wrote `server-bundle/index.cjs`.
- `npm run electron:compile` - passed and wrote `electron-dist/package.json`.

Bundle verification:

- `server-bundle/index.cjs` contains `detailLevel`, `PROPORTIONAL_BY_LINE_TOTAL`, and proportional paid/remaining calculations.

Runtime DB/API verification was not performed because no long-lived dev server was left running.

## 12. Manual Verification Checklist

1. Open Treasury detailed profit report.
2. Verify invoice summary mode loads by default.
3. Switch to `تفصيل حسب الخامة`.
4. Verify rows show material, code, color, barcode, supplier, and warehouse where linked.
5. Filter by customer.
6. Filter by payment status.
7. Filter by material code in line mode.
8. Filter by supplier in line mode.
9. Filter by warehouse in line mode.
10. Verify cost quality badges remain visible.
11. Verify warnings display calmly without blocking modals.
12. Return to invoice summary mode and confirm table remains stable.

## 13. Remaining Limitations

V-1.2 does not implement:

- exact receipt voucher allocation
- returns deduction
- export/print
- collection-date or due-date filters
- retroactive correction of old invoice costs

Runtime DB/API verification was not performed at report creation time.

## 14. Recommended V-1.3

Recommended next phase:

1. Add export/print after line mode is verified with real data.
2. Add paging controls if report rows exceed the first 100 rows.
3. Add optional grouping by customer/material/date.
4. Add returns handling only after source return links are verified.
5. Add payment allocation model only after business rules are approved.
