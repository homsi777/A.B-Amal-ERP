# Treasury Profit V-1.1 Cost Quality Report

Date: 2026-05-17

## 1. Executive Summary

V-1.1 improves the current Treasury detailed profit report without redesigning it and without changing accounting posting.

The main result is that report rows now expose whether cost is historical, estimated from current roll cost, missing, partial, or unknown. The current Treasury UI shows a compact Arabic badge beside the cost amount.

V-1.1 also adds an optional backend-only line mode with material/fabric fields, so V-1.2 can build a fuller line/material report safely.

## 2. What V-1.1 Implemented

- Added row-level `cost_quality`, `cost_quality_label`, and `cost_warning`.
- Added backend report warnings for missing, fallback, partial cost, and voucher allocation limitation.
- Added metadata counts for historical snapshots, fallback costs, missing costs, and partial costs.
- Kept default `/api/reports/financial/profit-details` invoice-level behavior compatible.
- Added optional `detailLevel=line` mode for backend rows per sales invoice line.
- Added a small cost quality badge in the existing Treasury profit table.

## 3. Files Changed

- `server/src/services/reportServiceMore.ts`
- `server/src/services/reportTypes.ts`
- `src/lib/reports/types.ts`
- `src/pages/treasury/ProfitDetails.tsx`
- `docs/TREASURY_PROFIT_V1_1_COST_QUALITY_REPORT.md`

No database migration was added in V-1.1.

## 4. Cost Quality Classification Rules

Backend values:

- `HISTORICAL_SNAPSHOT`: cost snapshot exists and can be converted to USD/base currency.
- `CURRENT_COST_FALLBACK`: old line has no snapshot but current `fabric_rolls.unit_cost` is available.
- `MISSING_COST`: no reliable cost is available.
- `PARTIAL_COST`: some cost data exists but conversion or part of the invoice cost is incomplete.
- `UNKNOWN`: no clear classification.

Arabic UI labels:

- `تكلفة مثبتة`
- `تكلفة تقديرية`
- `تكلفة مفقودة`
- `تكلفة جزئية`
- `غير معروف`

## 5. Backend Response Changes

Default invoice-level response now includes row fields:

- `invoice_id`
- `cost_quality`
- `cost_quality_label`
- `cost_warning`

Metadata now supports:

- `missingCostCount`
- `fallbackCostCount`
- `historicalSnapshotCount`
- `partialCostCount`
- `costMethod`
- `collectionMethod`

Response can also include:

- `warnings`

## 6. UI Changes

The current Treasury profit report page was not redesigned.

The existing cost column now shows:

- cost amount
- a compact badge for cost quality

The existing warning area still displays backend `meta.note` when report completeness is partial.

## 7. detailLevel=line

Implemented as backend-only optional mode:

`GET /api/reports/financial/profit-details?detailLevel=line`

Line mode returns one row per `sales_invoice_lines` row and includes where available:

- invoice id/no/date
- customer
- payment status
- line id
- material name
- material code
- color name
- color code
- barcode
- supplier name
- warehouse name
- quantity
- unit
- sale amount
- cost amount
- gross profit
- cost quality

Line mode uses `collectionAllocationMethod = PROPORTIONAL_BY_LINE_TOTAL`. This is a managerial allocation, not exact voucher allocation.

## 8. Filters Added

Default invoice mode supports:

- `customerId`
- `paymentStatus`

Line mode additionally supports:

- `materialCode`
- `supplierId`
- `warehouseId`

UI filters were postponed to V-1.2 to avoid expanding the current page too much in this phase.

## 9. Metadata and Warnings Behavior

`dataCompleteness` remains `FULL` only when no fallback, missing, or partial cost exists.

Warnings include:

- `MISSING_COST`
- `CURRENT_COST_FALLBACK`
- `PARTIAL_COST`
- `VOUCHER_ALLOCATION_LIMITED`

The voucher allocation warning is included because collections still come from stored invoice paid/remaining values. V-1.1 does not allocate general receipt vouchers to invoices.

## 10. Tests Run

Commands to run:

- `npm run lint`
- `npm run server:check`
- `npm run test`
- `npm run server:build`
- `npm run server:bundle`
- `npm run electron:compile`

`electron:dev` / `electron:dev:stack` are long-lived workflows. As in V-1.0, `electron:compile` is used as the safe non-long-running Electron verification step.

## 11. Test Results

Results:

- `npm run lint` - passed.
- `npm run server:check` - passed.
- `npm run test` - passed, `fabricInvoiceSummary tests passed`.
- `npm run server:build` - passed and synced SQL migrations to `server-dist/db/migrations`.
- `npm run server:bundle` - passed and wrote `server-bundle/index.cjs`.
- `npm run electron:compile` - passed and wrote `electron-dist/package.json`.

Bundle verification:

- `server-bundle/index.cjs` contains `detailLevel`, `cost_quality_label`, `LINE_COST_QUALITY_WITH_SNAPSHOT_PRIORITY`, and `PROPORTIONAL_BY_LINE_TOTAL`.

Runtime API/DB verification was not performed in this session because no long-lived dev server was left running.

## 12. Manual Verification Checklist

1. Open Treasury detailed profit report.
2. Confirm the report loads with current date filters.
3. Verify rows with V-1.0 snapshots show `تكلفة مثبتة`.
4. Verify old invoices without snapshot but with roll cost show `تكلفة تقديرية`.
5. Verify missing cost rows show `تكلفة مفقودة`.
6. Call the backend with `detailLevel=line` and verify material/roll fields appear when linked data exists.
7. Confirm current invoice-level UI did not visually change except the badge inside the cost column.

## 13. Remaining Limitations

V-1.1 does not implement:

- payment allocation
- returns deduction
- collection-date filtering
- due-date filtering
- full UI filter set
- final material/grouped profit report
- retroactive mutation of old invoice costs

Old invoice fallback remains an estimate and is marked as such.

## 14. Recommended V-1.2

Recommended next phase:

1. Add UI filter controls for customer, payment status, material code, supplier, and warehouse.
2. Add a toggle or separate view for `detailLevel=line`.
3. Show material/code/color/barcode columns in line mode.
4. Keep collection allocation clearly marked as proportional.
5. Add export only after line-mode values are verified against real data.
