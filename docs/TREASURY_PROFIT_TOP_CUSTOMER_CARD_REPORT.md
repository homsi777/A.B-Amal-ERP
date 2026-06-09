# Treasury Profit Report — Top Customer Card Report

## 1) What was added
- Added a small managerial insight card in Treasury → Detailed Profit Report:
  - "أكثر زبون يشتري"
  - Shows: customer name, total sales, sold meters, invoice count, remaining receivables.
- Card is clickable and opens a non-blocking details modal with:
  - sales, cost, profit, paid, remaining
  - sold meters
  - last purchase date
  - top material
  - top 5 invoices summary

## 2) Files changed
- `server/src/services/reportServiceMore.ts`
- `server/src/services/reportTypes.ts`
- `src/lib/reports/types.ts`
- `src/pages/treasury/ProfitDetails.tsx`

## 3) How top customer is calculated
- Data source: confirmed sales invoices only (`sales_invoices.document_status = 'CONFIRMED'`).
- Customer ranking metric: highest total sales amount (USD) within the current report filters.
- Meters calculation:
  - meter: `quantity`
  - yard: `quantity * 0.9144`
- Receivables meters (ذمم) is a proportional allocation:
  - `line_meters * (invoice_remaining_amount / invoice_total_amount)`

## 4) Filters affecting the result
- Date range: fromDate/toDate
- Payment status
- Customer filter (if set, the top customer will naturally be that customer)
- Material code
- Supplier
- Warehouse

## 5) Click details behavior
- Clicking the card opens a lightweight modal using existing styling.
- No alert dialogs.
- Modal can be closed via the close button or clicking the background.

## 6) Tests run
- `npm run lint`
- `npm run server:check`
- `npm run test`
- `npm run server:build`
- `npm run server:bundle`
- `npm run electron:compile`

## 7) Remaining limitations
- “Meters in receivables (ذمم)” is an estimated proportional allocation by remaining amount share, not a stock-remaining metric.
- Top material is derived from the filtered invoice lines; it may be `—` if material info is missing on some lines.
