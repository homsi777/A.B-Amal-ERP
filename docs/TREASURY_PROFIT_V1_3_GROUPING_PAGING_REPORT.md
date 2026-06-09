# Treasury Profit V-1.3 Grouping and Paging Report

Date: 2026-05-17

## 1. Executive Summary

V-1.3 adds managerial grouping and paging to the existing Treasury detailed profit report without changing accounting logic.

The report now supports grouping by customer, material, supplier, or invoice date, and adds page/pageSize controls to avoid loading large result sets into the frontend. Existing invoice-summary and line/material modes remain intact.

No payment allocation, returns deduction, due-date filtering, collection-date filtering, sales confirmation logic, GL posting, or historical cost snapshot behavior was changed.

## 2. What V-1.3 Implemented

- Added `groupBy=none|customer|material|supplier|date` support to `GET /api/reports/financial/profit-details`.
- Added backend `groups` response data with managerial totals.
- Added a UI control labeled `تجميع حسب`.
- Added a grouped summary table above the detailed rows when grouping is selected.
- Added paging controls with page size options `50`, `100`, and `200`.
- Kept detailed invoice and line/material rows available below the grouped summary.

## 3. Files Changed

- `server/src/services/reportServiceMore.ts`
- `server/src/services/reportTypes.ts`
- `src/lib/reports/types.ts`
- `src/pages/treasury/ProfitDetails.tsx`
- `docs/TREASURY_PROFIT_V1_3_GROUPING_PAGING_REPORT.md`

## 4. Backend Query Parameters Added

Endpoint kept:

`GET /api/reports/financial/profit-details`

V-1.3 adds:

- `groupBy`
- `page`
- `pageSize`

Supported `groupBy` values:

- `none`
- `customer`
- `material`
- `supplier`
- `date`

Existing filters remain:

- `fromDate`
- `toDate`
- `detailLevel=invoice|line`
- `customerId`
- `paymentStatus`
- `materialCode` in line mode
- `supplierId` in line mode
- `warehouseId` in line mode

## 5. GroupBy Behavior

Default:

- `groupBy=none`
- Existing report behavior is preserved.

Invoice mode:

- Supports grouping by `customer` and `date`.
- Material/supplier grouping is not meaningful at invoice-header level, so the UI switches to line/material mode when the user chooses material or supplier grouping.

Line/material mode:

- Supports grouping by `customer`, `material`, `supplier`, and `date`.
- Uses the existing V-1.2 line-level data and proportional collected/remaining allocation.

## 6. Group Totals Calculation Method

Group summaries are calculated in the backend from the full filtered dataset, not only from the current page.

Each group includes:

- `sales_amount`
- `cost_amount`
- `gross_profit`
- `paid_amount`
- `remaining_amount`
- `realized_profit`
- `receivable_profit`
- `invoice_count`
- `line_count`
- `missing_cost_count`
- `fallback_cost_count`
- `historical_snapshot_count`
- `partial_cost_count`

In line/material mode, collected and remaining amounts still use:

`PROPORTIONAL_BY_LINE_TOTAL`

This is a managerial distribution by line value. It is not exact receipt voucher allocation.

## 7. UI Grouping Controls

The Treasury profit report now includes:

- `تجميع حسب`
- `بدون تجميع`
- `العميل`
- `الخامة`
- `المورد`
- `التاريخ`

When grouping is active, the page shows `ملخص التجميع` above the detailed rows.

Grouped table columns:

- `المجموعة`
- `عدد الفواتير`
- `عدد البنود`
- `إجمالي البيع`
- `إجمالي التكلفة`
- `الربح`
- `المحصل`
- `المتبقي`
- `جودة التكلفة`

Cost quality counts are shown as compact badges:

- `مثبتة`
- `تقديرية`
- `مفقودة`
- `جزئية`

## 8. Paging Behavior

Paging applies to detailed rows.

UI controls added:

- previous page
- next page
- current page indicator
- total pages when backend total is available
- page size selector: `50`, `100`, `200`

Default page size remains:

`100`

The backend already enforces the shared maximum report page size through `pageParams`.

## 9. Warning and Metadata Behavior

Existing warnings remain visible:

- missing cost
- current cost fallback
- partial cost
- voucher allocation limitation

When line mode and grouping are active, the UI also explains:

`المحصل والمتبقي في التجميع محسوبان بناءً على التوزيع النسبي حسب قيمة البنود، وليس تخصيص سندات قبض دقيق.`

Backend metadata now includes:

- `groupBy`
- `groupingScope=FILTERED_FULL_RESULT` when grouping is produced

## 10. Tests Run

Commands run:

- `npm run lint`
- `npm run server:check`
- `npm run test`
- `npm run server:build`
- `npm run server:bundle`
- `npm run electron:compile`

## 11. Test Results

Results:

- `npm run lint` - passed.
- `npm run server:check` - passed.
- `npm run test` - passed, `fabricInvoiceSummary tests passed`.
- `npm run server:build` - passed and synced SQL migrations to `server-dist/db/migrations`.
- `npm run server:bundle` - passed and wrote `server-bundle/index.cjs`.
- `npm run electron:compile` - passed and wrote `electron-dist/package.json`.

`npm run electron:dev` and `npm run electron:dev:stack` were not left running because they start long-lived desktop development sessions. The non-long-running Electron compile workflow passed.

## 12. Manual Verification Checklist

Recommended manual checks:

1. Open Treasury detailed profit report.
2. Confirm invoice mode loads by default.
3. Switch to line/material mode.
4. Confirm line rows still show material, code, color, barcode, supplier, and warehouse.
5. Choose grouping by customer.
6. Choose grouping by material.
7. Choose grouping by supplier.
8. Choose grouping by date.
9. Test customer, material code, supplier, warehouse, and payment status filters with grouping.
10. Test previous/next page.
11. Test page size `50`, `100`, and `200`.
12. Verify missing/fallback/proportional allocation warnings remain visible when relevant.

Runtime database verification was not performed in this implementation session.

## 13. Remaining Limitations

V-1.3 does not implement:

- exact receipt voucher allocation
- returns deduction
- due-date filtering
- collection-date filtering
- export/print
- retroactive correction of old invoice costs

Supplier grouping depends on available supplier traceability through the line/roll/material joins. Rows without supplier are grouped under the empty/unknown supplier label.

## 14. Recommended V-1.4

Recommended next phase:

1. Add export/print only after grouped totals are verified against real database samples.
2. Add returns handling after confirming reliable links to original sales invoice lines.
3. Add exact payment allocation only after business rules are approved.
4. Add optional drill-down from grouped rows to filtered line rows if the manager needs faster navigation.
5. Add runtime comparison tests against real invoices with known cost, payment, and material data.
