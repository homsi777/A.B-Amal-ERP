# Treasury Profit V-1.0 Cost Snapshot Report

Date: 2026-05-17

## 1. Executive Summary

V-1.0 adds the accounting foundation for historical cost snapshots on future confirmed sales invoice lines.

The change does not implement the full detailed Treasury profit report. It only ensures that new confirmed sales invoice lines can preserve the cost basis from the confirmation moment, so future profit reporting does not depend only on mutable `fabric_rolls.unit_cost`.

## 2. Exact Problem Fixed in V-1.0

Before this change, `GET /api/reports/financial/profit-details` calculated cost by joining `sales_invoice_lines.fabric_roll_id` to the current `fabric_rolls.unit_cost`.

That meant old profit could change if the roll cost changed after sale. Also, missing cost could be hidden as zero cost.

V-1.0 fixes the foundation for new confirmations by storing cost snapshot fields directly on `sales_invoice_lines`.

## 3. Files Changed

- `server/src/db/migrations/030_sales_invoice_line_cost_snapshot.sql`
- `server-bundle/db/migrations/030_sales_invoice_line_cost_snapshot.sql`
- `server-dist/db/migrations/030_sales_invoice_line_cost_snapshot.sql`
- `server/src/services/salesInvoiceService.ts`
- `server/src/services/reportServiceMore.ts`
- `server/src/services/reportTypes.ts`
- `src/lib/reports/types.ts`
- `src/pages/treasury/ProfitDetails.tsx`
- `docs/TREASURY_PROFIT_V1_COST_SNAPSHOT_REPORT.md`

## 4. Migration Name and Fields Added

Migration:

`030_sales_invoice_line_cost_snapshot.sql`

Added nullable fields to `sales_invoice_lines`:

- `cost_unit_price`
- `cost_total`
- `cost_currency_code`
- `cost_exchange_rate_to_usd`
- `cost_unit_price_usd`
- `cost_total_usd`
- `cost_source`
- `cost_snapshot_at`
- `cost_missing`

The migration also adds a safe check constraint for allowed `cost_source` values and supporting indexes for item/cost diagnostics.

Existing invoice lines are not updated.

## 5. How Cost Snapshot Is Captured

During `confirmSalesInvoice`, each line with a linked `fabric_roll_id` locks and reads the roll row.

For that confirmation moment, the service reads:

- `fabric_rolls.unit_cost`
- `fabric_rolls.currency_code`
- sold quantity converted to meters using the existing `quantityToMeters` logic

If cost is valid, the service stores:

- original unit cost
- original total cost
- cost currency
- exchange rate to USD when available
- USD unit cost
- USD total cost
- `cost_source = FABRIC_ROLL_AT_CONFIRMATION`
- `cost_snapshot_at = now()`
- `cost_missing = false` when USD conversion is available

## 6. How Missing Cost Is Handled

If roll cost is missing, invalid, or not positive, the service stores:

- `cost_source = MISSING`
- `cost_missing = true`
- cost amount fields as `NULL`

The implementation does not pretend missing cost is a real zero cost.

If original cost exists but USD conversion is not available, original cost fields are stored and the line is marked incomplete for USD reporting.

## 7. How Old Invoices Are Handled

Old confirmed invoices are not mutated.

Old lines keep null snapshot fields. The current profit endpoint still works by falling back to the previous current-roll-cost behavior when no snapshot exists.

The endpoint now exposes metadata:

- `missingCostCount`
- `fallbackCostCount`
- `costMethod`
- `dataCompleteness`
- `note`

If fallback or missing costs exist, `dataCompleteness` is `PARTIAL`, not `FULL`.

## 8. Current Profit Endpoint Adjustment

Endpoint kept:

`GET /api/reports/financial/profit-details`

The response shape remains compatible with the current Treasury UI.

Cost priority is now:

1. `sales_invoice_lines.cost_total_usd` when a valid snapshot exists.
2. `sales_invoice_lines.cost_total / cost_exchange_rate_to_usd` when snapshot has original amount and rate.
3. Existing fallback: current `fabric_rolls.unit_cost`.

This is a compatibility bridge only. It is not a final detailed profit report.

## 9. GL Posting Compatibility Notes

The existing sales confirmation and GL posting flow remains in place.

The same confirmation loop that prepares COGS now also saves the line cost snapshot. No duplicate stock movements or duplicate journal entries were added.

For USD cost snapshots, COGS uses the USD unit cost where available. When USD conversion is unavailable, the previous unit-cost behavior remains the fallback so confirmation does not fail solely because the snapshot is incomplete.

## 10. Tests Run

Commands run:

- `npm run server:check` - passed
- `npm run lint`
- `npm run test`
- `npm run server:build`
- `npm run server:bundle`
- `npm run electron:compile`

`npm run electron:dev` / `npm run electron:dev:stack` were not left running because they start a long-lived desktop development session. The Electron compile step passed, which verifies the Electron TypeScript/copy stage used by those workflows.

## 11. Test Results

Results:

- `npm run server:check` - passed.
- `npm run lint` - passed.
- `npm run test` - passed, `fabricInvoiceSummary tests passed`.
- `npm run server:build` - passed and synced SQL migrations to `server-dist/db/migrations`.
- `npm run server:bundle` - passed and synced SQL migrations to `server-bundle/db/migrations`.
- `npm run electron:compile` - passed and wrote `electron-dist/package.json`.

## 12. Manual Verification Checklist

Recommended manual checks:

1. Confirm a new sales invoice for a roll with `unit_cost`.
2. Verify the related `sales_invoice_lines` row has snapshot fields populated.
3. Change `fabric_rolls.unit_cost` after confirmation.
4. Verify the stored line snapshot remains unchanged.
5. Confirm a sale where roll cost is missing or zero.
6. Verify `cost_source = MISSING` and `cost_missing = true`.
7. Open Treasury detailed profit report and verify it still loads.
8. Verify old invoices without snapshot still appear using fallback metadata.

## 13. Remaining Limitations

V-1.0 does not implement:

- line-level detailed profit UI
- material/supplier/warehouse filters
- returns deduction
- payment voucher allocation
- due-date or collection-date filtering
- retroactive historical cost reconstruction

Old invoices using fallback current roll cost are still estimates, not historical facts.

## 14. Next Recommended Phase V-1.1

Recommended V-1.1 scope:

1. Add visible cost quality badges in the Treasury profit report.
2. Add line/material-aware backend rows without changing accounting logic.
3. Add filters for customer, material code, supplier, warehouse, and payment status.
4. Keep old invoice fallback clearly marked.
5. Do not implement payment allocation or returns until their source links are verified.
