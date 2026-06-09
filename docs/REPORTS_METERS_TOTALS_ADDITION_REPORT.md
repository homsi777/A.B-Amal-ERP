# Reports Meters Totals Addition Report

## 1) What was added
- Treasury → Detailed Profit Report:
  - Added sold meters totals (and an estimated receivable meters share) to totals and grouped results.
  - Added per-line “quantity in meters” in line/material mode.
- Report PDF/Excel totals labeling:
  - Added Arabic labels for meter-related totals keys so exported PDF/Excel cards don’t show raw keys.

## 2) Files changed
- `server/src/services/reportServiceMore.ts`
- `src/pages/treasury/ProfitDetails.tsx`
- `src/lib/reports/printReport.ts`
- `src/lib/reports/exportReportToExcel.ts`

## 3) How meters are calculated
- Source of truth: confirmed sales invoice lines only (`sales_invoices.document_status = 'CONFIRMED'`).
- Per line:
  - If `unit = 'meter'`: meters = `quantity`.
  - If `unit = 'yard'`: meters = `quantity * 0.9144`.
- Totals:
  - `sold_meters` = sum of line meters.
  - `remaining_receivable_meters` (ذمم) = sum of `line_meters * (invoice_remaining_amount / invoice_total_amount)` when totals exist.

## 4) Reports updated
- Treasury:
  - Detailed Profit Report (`/financial/profit-details`) in both invoice mode and line/material mode.
- Inventory:
  - Verified inventory rolls report already exposes remaining/sold meters totals; only improved export label mapping.

## 5) Yard-to-meter conversion
- Uses the same project convention already used across services and SQL: `1 yard = 0.9144 meter`.
- No new conversion method was introduced.

## 6) Tests run
- `npm run lint`
- `npm run server:check`
- `npm run test`
- `npm run server:build`
- `npm run server:bundle`
- `npm run electron:compile`

## 7) Remaining limitations / notes
- “Meters in receivables (ذمم)” is a proportional allocation based on remaining amount share, not a physical remaining stock metric.
- Returns are not added unless the underlying profit report already includes them; current logic follows existing profit report behavior.
