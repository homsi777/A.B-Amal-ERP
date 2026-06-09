# Treasury Detailed Profit Report Audit

Read-only audit for: `كشف الأرباح التفصيلي` / Treasury detailed profit report.

Date of audit: 2026-05-17  
Scope: codebase inspection only. No runtime database verification was performed. No implementation changes were made.

---

## 1. Executive Summary

The current `كشف الأرباح التفصيلي` is a real API-backed report, not mocked UI data. It is located under Treasury at `/treasury/profit-details` and calls `GET /api/reports/financial/profit-details`.

The report currently works at **confirmed sales invoice header level**. It displays invoice date, invoice number, customer, sales amount, paid amount, remaining receivable, cost amount, gross profit, realized profit, and receivable profit. It uses `sales_invoices`, `sales_invoice_lines`, `customers`, and `fabric_rolls`.

The largest accounting risk is cost calculation. Current report cost is calculated from the **current** `fabric_rolls.unit_cost` joined through `sales_invoice_lines.fabric_roll_id`. Sales invoice lines do not store a cost snapshot at sale time. If a roll cost changes after confirmation, historical profit can be recalculated incorrectly. Missing roll cost is treated as zero, which can overstate profit.

Collections are only as accurate as `sales_invoices.paid_amount` and `remaining_amount`. The report does not allocate general receipt vouchers to invoices. Auto-generated receipt voucher from invoice confirmation is linked indirectly through `sales_invoices.payment_voucher_id` and voucher `reference_document_no`, but later manual vouchers are customer-level unless separately referenced. There is no inspected FIFO/manual allocation table for invoice-level collections.

The report is directionally useful, but it is not yet the full business report required by management because it lacks line/material/fabric detail, supplier/warehouse filters, payment status display, due date, returns adjustment, collection-date filtering, missing-cost warnings, and safe historical costing.

---

## 2. Current Business Meaning of the Existing Report

Current meaning:

- It is an invoice-level gross profit report for confirmed sales invoices.
- It converts invoice totals, paid amounts, and remaining amounts to USD/base amount using stored USD columns or fallback exchange-rate conversion.
- It estimates cost from linked fabric rolls and invoice line quantities.
- It splits gross profit proportionally into:
  - `realized_profit` = paid share of gross profit.
  - `receivable_profit` = remaining receivable share of gross profit.

Important limitation:

This is not a full cashbox/treasury movement report, and it is not a fully reliable historical margin report unless roll unit costs are immutable after sale or cost snapshots exist elsewhere. The inspected schema does not show sales line cost snapshot fields.

---

## 3. Current Frontend Flow

Evidence:

- Navigation item: `src/layouts/DashboardLayout.tsx` contains `كشف الأرباح التفصيلي` pointing to `/treasury/profit-details`.
- Route: `src/App.tsx` maps `treasury/profit-details` to `ProfitDetails`.
- Component: `src/pages/treasury/ProfitDetails.tsx`.
- API caller: `fetchUnifiedReport('/financial/profit-details', { fromDate, toDate, pageSize: 100 })`.

Current UI flow:

1. User opens Treasury menu.
2. User clicks `كشف الأرباح التفصيلي`.
3. Router renders `ProfitDetails`.
4. Component initializes `fromDate` to first day of current month and `toDate` to today.
5. On first render, it loads the report once.
6. User can change date inputs and click `تحديث`.
7. UI displays summary cards and a table.

It is inside the Treasury section.

---

## 4. Current Backend/API Flow

Evidence:

- Backend route registration: `server/src/routes/reportRoutes.ts`.
- Endpoint: `GET /api/reports/financial/profit-details`.
- Handler calls `reportProfitDetails(req.user!.companyId, q(req))`.
- Implementation: `server/src/services/reportServiceMore.ts`, function `reportProfitDetails`.

Current endpoint:

```text
GET /api/reports/financial/profit-details
```

Current query parameters used by implementation:

- `fromDate`
- `toDate`
- `page`
- `pageSize`

Current endpoint does not support:

- `customerId`
- `supplierId`
- `materialId`
- `materialCode`
- `colorId`
- `warehouseId`
- `paymentStatus`
- `currencyCode`
- `dateType`
- `groupBy`

Calculations are done in the backend SQL, not in the frontend.

---

## 5. Current Database Tables and Fields Used

Directly used by `reportProfitDetails`:

- `sales_invoices`
  - `id`
  - `invoice_date`
  - `invoice_no`
  - `customer_id`
  - `currency_code`
  - `total_amount`
  - `paid_amount`
  - `remaining_amount`
  - `total_amount_usd`
  - `paid_amount_usd`
  - `remaining_amount_usd`
  - `exchange_rate_to_usd`
  - `document_status`
  - `company_id`

- `sales_invoice_lines`
  - `invoice_id`
  - `company_id`
  - `fabric_roll_id`
  - `quantity`
  - `unit`

- `fabric_rolls`
  - `id`
  - `company_id`
  - `unit_cost`

- `customers`
  - `id`
  - `company_id`
  - `name`

Important nearby tables available but not used by this report:

- `fabric_items`
- `fabric_colors`
- `fabric_item_variants`
- `warehouses`
- `suppliers`
- `vouchers`
- `cashbox_movements`
- `return_invoices`
- `return_invoice_lines`
- `journal_entries`
- `journal_lines`
- `inventory_movements`
- `purchase_invoices`
- `purchase_invoice_lines`
- `exchange_rates`

---

## 6. Current Filters and UI Columns

Frontend filters in `ProfitDetails.tsx`:

- From date: `fromDate`
- To date: `toDate`
- Refresh button

Backend filters in `reportProfitDetails`:

- `si.company_id = $1`
- `si.document_status = 'CONFIRMED'`
- `si.invoice_date >= fromDate`
- `si.invoice_date <= toDate`

Current table columns:

- `التاريخ`
- `رقم الفاتورة`
- `العميل`
- `البيع`
- `المحصل`
- `المتبقي ذمم`
- `التكلفة`
- `الربح الكلي`
- `ربح محصل`
- `ربح مع الذمم`

Current summary cards:

- `البيع الكلي`
- `التكلفة الكلية`
- `الربح الكلي`
- `ربح متبق مع الذمم`

Missing from UI:

- payment status
- invoice status
- due date
- currency column in rendered table, despite backend selecting `currency_code`
- exchange rate
- material/fabric name
- material/fabric code
- color
- color code
- roll/barcode
- supplier
- warehouse
- collection voucher reference
- collection date
- profit margin
- missing-cost warning

---

## 7. Current Calculation Logic

Backend SQL:

- CTE `line_costs`:
  - Groups by `sales_invoice_lines.invoice_id`.
  - Converts yards to meters with `quantity * 0.9144`.
  - Multiplies quantity in meters by `COALESCE(fabric_rolls.unit_cost, 0)`.

- CTE `invoice_profit`:
  - Reads confirmed `sales_invoices`.
  - Joins `customers`.
  - Joins computed `line_costs`.
  - Converts sales/paid/remaining to USD using stored USD fields first, then fallback conversion.

Computed row values:

- `sales_amount`
- `paid_amount`
- `remaining_amount`
- `cost_amount`
- `gross_profit = sales_amount - cost_amount`
- `realized_profit = paid_amount / sales_amount * gross_profit`
- `receivable_profit = remaining_amount / sales_amount * gross_profit`

This is invoice-level. It is not line-level or material-level.

---

## 8. Cost Calculation Audit

### 8.1 Does sales invoice line store cost snapshot?

No cost snapshot was found in `sales_invoice_lines` creation schema or migration.

`sales_invoice_lines` stores:

- sale quantity
- unit
- unit price
- discounts/tax
- line total
- USD sale values
- metadata
- roll/item/variant/warehouse references

It does not store:

- `unit_cost`
- `cost_price`
- `cost_amount`
- `total_cost`
- `unit_cost_usd`

`unit_cost_usd` exists on `purchase_invoice_lines`, not `sales_invoice_lines`.

### 8.2 Where does current report cost come from?

The current report uses:

```text
sales_invoice_lines.fabric_roll_id -> fabric_rolls.unit_cost
```

It multiplies the sold quantity by `fabric_rolls.unit_cost`.

### 8.3 Accounting risk

This is high risk for historical profit:

- If `fabric_rolls.unit_cost` changes after sale, historical report profit changes.
- If roll cost is missing, cost becomes zero.
- If sale line has no `fabric_roll_id`, cost becomes zero.
- If fabric roll is deleted or reference is null, cost becomes zero.
- If old imported invoices did not create line-level roll links, cost is incomplete.

Historical profit should not be recomputed from current mutable inventory cost. It should use a cost snapshot captured at confirmation time.

### 8.4 Does confirmation capture cost anywhere?

`confirmSalesInvoice` reads `fabric_rolls.unit_cost` into `linesForCogs` and posts GL COGS through `postSalesInvoiceToGl`. However, inspected code does not persist the same cost snapshot onto `sales_invoice_lines`.

The GL journal can contain historical COGS amounts, but the current detailed profit report does not read journal lines. It rereads roll unit cost.

### 8.5 Missing cost behavior

Missing cost is treated as zero via `COALESCE(fr.unit_cost, 0)`. The report does not flag missing cost. This can make gross profit appear too high.

---

## 9. Sales / Receivables / Collection Audit

### 9.1 Where are customer payments stored?

Payments can exist in:

- `sales_invoices.paid_amount`, `paid_amount_usd`
- `sales_invoices.remaining_amount`, `remaining_amount_usd`
- `sales_invoices.payment_status`
- `sales_invoices.payment_voucher_id`
- `vouchers` with `voucher_type='RECEIPT'`, `party_type='CUSTOMER'`
- `cashbox_movements` created from confirmed vouchers
- `party_activity_logs` created during voucher confirmation

### 9.2 Are receipt vouchers linked to invoice IDs?

Partially.

When confirming a sales invoice with paid amount, `confirmSalesInvoice` creates a receipt voucher with:

- `referenceDocumentType: 'SALE_INVOICE'`
- `referenceDocumentNo: invoice_no`
- `sales_invoices.payment_voucher_id = voucher id`

Manual vouchers support `reference_document_type` and `reference_document_no`, but voucher confirmation does not update `sales_invoices.paid_amount` or allocate to invoice lines in inspected code.

### 9.3 Is there invoice-level allocation logic?

No dedicated invoice-payment allocation table was found in inspected files.

No FIFO allocation service was found for mapping later customer receipts to open invoices.

Therefore:

- Initial paid amount at invoice confirmation can be represented.
- Later receipt vouchers may affect customer-level balance/party log/GL.
- Later receipt vouchers do not necessarily update invoice-level `paid_amount` and `remaining_amount`.

Needs runtime/database verification for whether any external workflow updates sales invoice balances after manual receipt vouchers.

### 9.4 Can the report show collected amount per invoice accurately?

Only if `sales_invoices.paid_amount_usd` and `remaining_amount_usd` are maintained accurately by all payment workflows.

Based on inspected code, the report cannot safely claim accurate per-invoice collections from general vouchers because voucher allocation is not implemented in this report.

### 9.5 Cash and credit sales

Current model supports:

- cash/paid at confirmation via `paid_amount`
- partial paid via `payment_status = partial`
- unpaid via `payment_status = unpaid`

But the report does not display `payment_status`.

---

## 10. Date Filtering Audit

Current date filter:

- `invoice_date >= fromDate`
- `invoice_date <= toDate`

Supported:

- invoice date filter

Not supported:

- collection/receipt date filter based on `vouchers.voucher_date`
- cashbox movement date filter based on `cashbox_movements.movement_at`
- due date filter
- date type selector

Due date:

- No `due_date` field was found in `sales_invoices` migration.
- No payment terms field was found in `sales_invoices` migration.

Display:

- Frontend slices `invoice_date` to first 10 chars, so it displays date-only.
- Backend returns `invoice_date::text`.

Recommendation:

- Keep date-only display for business reports.
- Add explicit `dateType=invoiceDate|collectionDate|dueDate` only after collection allocation and due-date fields exist.

---

## 11. Material / Fabric Grouping Audit

The required manager view needs material/fabric profit. Current report does not provide it.

Available links:

- `sales_invoice_lines.fabric_roll_id`
- `sales_invoice_lines.fabric_item_id`
- `sales_invoice_lines.variant_id`
- `sales_invoice_lines.warehouse_id`
- `fabric_rolls.item_id`
- `fabric_rolls.color_id`
- `fabric_rolls.variant_id`
- `fabric_rolls.supplier_id`
- `fabric_rolls.warehouse_id`
- `fabric_rolls.barcode`
- `fabric_items.name`
- `fabric_items.internal_code`
- `fabric_colors.name_ar/name_tr/color_code`

Current report does not join:

- `fabric_items`
- `fabric_colors`
- `warehouses`
- `suppliers`
- `purchase_invoice_lines`

Can material grouping be implemented accurately?

Yes, mostly, if sales invoice lines are consistently linked to either `fabric_roll_id` or `fabric_item_id`. Best accuracy is through `fabric_roll_id`, because it gives roll/barcode/color/supplier/warehouse. If a line only has description and no IDs, it can only be reported as unclassified.

Supplier traceability:

- `fabric_rolls.supplier_id` exists and is direct.
- `purchase_invoice_lines.fabric_roll_id` also exists and can provide purchase document context.
- Current report does not use either.

Warehouse traceability:

- `sales_invoice_lines.warehouse_id` exists.
- `fabric_rolls.warehouse_id` exists.
- Current report does not use either.

---

## 12. Supplier / Customer Filter Audit

Current customer support:

- Backend joins customer name.
- UI displays customer name.
- Backend does not accept `customerId`.
- UI does not provide customer selector.

Current supplier support:

- Fabric roll has `supplier_id`.
- Purchase invoice has `supplier_id`.
- Current profit report does not join supplier data.
- No supplier filter exists.

Required later:

- `customerId`
- `supplierId`
- `materialId`
- `materialCode`
- `colorId`
- `warehouseId`

---

## 13. Multi-Currency Audit

Multi-currency exists.

Evidence:

- `exchange_rates` table exists.
- `sales_invoices` has `currency_code`, `exchange_rate_to_usd`, and USD fields.
- `sales_invoice_lines` has USD sale fields.
- `vouchers` and `cashbox_movements` have `exchange_rate_to_usd` and `amount_usd`.

Current report behavior:

- Uses `total_amount_usd`, `paid_amount_usd`, `remaining_amount_usd` when available.
- Fallback converts original amount to USD using `amount / exchange_rate_to_usd`.
- Displays all money as `USD` in frontend.
- Backend selects `currency_code`, but frontend does not display it.

Risks:

- Cost from `fabric_rolls.unit_cost` is assumed compatible with USD. `fabric_rolls.currency_code` exists, but the report does not convert roll cost currency.
- If roll unit cost is in non-USD, current profit can be wrong.
- Mixed-currency invoices are summarized in USD only, but original currency context is hidden.

Recommended:

- Use USD/base totals for summary.
- Display original currency and exchange rate per invoice.
- Store or compute `cost_amount_usd` using historical cost currency/rate.

---

## 14. Returns / Cancellations Audit

### 14.1 Cancelled/void invoices

Current report uses only:

```text
si.document_status = 'CONFIRMED'
```

Therefore DRAFT and VOIDED sales invoices are excluded.

### 14.2 Returns

Return infrastructure exists:

- `return_invoices`
- `return_invoice_lines`
- `original_sales_invoice_id`
- `original_sales_invoice_line_id`
- `return_fulfillment_status`
- return stock service
- return GL posting/reversal

Current profit report does not join or deduct returns.

Current impact:

- Sales returns are not deducted from sales/profit in `reportProfitDetails`.
- Return fulfillment status is not displayed.
- Returned quantities are not deducted from material/line profit.
- Returned COGS reversal is not considered.

This is a material gap for correct business profit.

---

## 15. What Currently Works

- Report is reachable from Treasury menu.
- Route is wired.
- Frontend uses real API data.
- Backend has a dedicated endpoint.
- Uses authenticated company scope.
- Filters by invoice date.
- Uses confirmed sales invoices only.
- Excludes draft/voided sales invoices.
- Shows invoice number and customer.
- Shows sales, paid, remaining, cost, gross profit.
- Uses USD/base invoice fields if present.
- Supports pagination internally through unified report payload.
- Shows date-only in UI.

---

## 16. What Is Incomplete

- No line/material/fabric detail.
- No material grouping.
- No customer filter.
- No supplier filter.
- No material/color/warehouse filters.
- No payment status column.
- No invoice status column.
- No due date/payment terms.
- No collection voucher/date references.
- No collection-date filtering.
- No returns deduction.
- No missing-cost warning.
- No cost snapshot at sale line level.
- No margin percentage.
- No original currency display.
- No cost currency conversion.
- No group totals by customer/material/date.

---

## 17. What Is Wrong or Risky

High-risk items:

1. Historical cost is derived from current `fabric_rolls.unit_cost`.
2. Missing cost is silently treated as zero.
3. Non-USD roll costs may be treated as USD.
4. Later customer receipts may not update invoice paid/remaining values.
5. No invoice allocation model was found for general vouchers.
6. Returns are ignored.
7. Report metadata marks `dataCompleteness: 'FULL'`, but business completeness is not full.
8. `realized_profit` is proportional profit, not actual cash profit by cost recovery. It may be acceptable as a managerial approximation but should be named and documented carefully.

---

## 18. Exact Data Gaps Preventing Correct Report

Blocking gaps:

- `sales_invoice_lines` lacks cost snapshot fields.
- No inspected `sales_invoice_payment_allocations` table.
- No inspected due date/payment terms fields on `sales_invoices`.
- No current profit report joins material/color/supplier/warehouse tables.
- No current profit report joins returns.
- No current profit report reads journal COGS as historical source.
- No missing-cost diagnostics in response.

Needs runtime/database verification:

- Whether all active sales invoice lines are reliably linked to `fabric_roll_id`.
- Whether any external process updates `sales_invoices.paid_amount` after manual customer receipt vouchers.
- Whether `fabric_rolls.unit_cost` is always stored in USD in production data.
- Whether existing confirmed invoices have nonzero USD fields after multi-currency migration.

---

## 19. Recommended Correct Business Definition

Correct report definition:

The detailed profit report should be based on confirmed sales invoices and should distinguish:

- invoice sales value
- historical cost of sold materials
- gross profit
- collected amount
- remaining receivables
- payment status
- material/fabric line details
- customer
- supplier/source where available
- currency and base-currency totals
- returns/cancellations effect

Gross profit is not the same as cash collected. The report should clearly separate:

- `grossProfit = netSales - historicalCost`
- `collectedAmount`
- `remainingReceivable`
- `cashRealizedProfit` only if allocation rules are clearly defined

If cost is missing, the report should show `costMissing=true` and not pretend profit is reliable.

---

## 20. Recommended Backend Endpoint Design

Do not replace the current endpoint abruptly. Add or evolve safely:

```text
GET /api/treasury/detailed-profit-report
```

Recommended query parameters:

- `dateFrom`
- `dateTo`
- `dateType=invoiceDate|collectionDate|dueDate`
- `customerId`
- `supplierId`
- `materialId`
- `materialCode`
- `colorId`
- `warehouseId`
- `paymentStatus=paid|partial|unpaid`
- `currencyCode`
- `groupBy=invoice|material|customer|supplier|date`
- `includeReturns=true|false`
- `showMissingCostOnly=true|false`
- `page`
- `pageSize`

Possible compatibility:

- Keep `/api/reports/financial/profit-details` as current route.
- Add a new endpoint for corrected business report or version it through `mode=detailed`.

---

## 21. Recommended Response Shape

Recommended response:

```ts
{
  ok: true,
  report: {
    title: "كشف الأرباح التفصيلي",
    generatedAt: string,
    filtersApplied: {...},
    summary: {
      totalSalesUsd: string,
      totalCostUsd: string,
      totalGrossProfitUsd: string,
      totalCollectedUsd: string,
      totalRemainingReceivablesUsd: string,
      missingCostLines: number,
      returnedSalesUsd: string
    },
    groups: [
      {
        groupKey: string,
        groupLabel: string,
        totals: {...}
      }
    ],
    rows: [
      {
        invoiceId: string,
        invoiceNo: string,
        invoiceDate: string,
        dueDate: string | null,
        customerId: string,
        customerName: string,
        paymentStatus: "paid" | "partial" | "unpaid",
        documentStatus: "CONFIRMED",
        currencyCode: string,
        exchangeRateToUsd: string,
        lineId: string | null,
        materialId: string | null,
        materialName: string | null,
        materialCode: string | null,
        colorName: string | null,
        colorCode: string | null,
        fabricRollId: string | null,
        barcode: string | null,
        warehouseId: string | null,
        warehouseName: string | null,
        supplierId: string | null,
        supplierName: string | null,
        quantity: string,
        unit: string,
        saleUnitPrice: string,
        saleLineTotal: string,
        saleLineTotalUsd: string,
        costUnitPriceUsd: string | null,
        costTotalUsd: string | null,
        costSource: "sales_line_snapshot" | "journal_cogs" | "current_roll_cost" | "missing",
        grossProfitUsd: string | null,
        marginPercent: string | null,
        collectedAmountUsd: string | null,
        remainingAmountUsd: string | null,
        collectionRefs: string[],
        warnings: string[]
      }
    ],
    warnings: [
      { code: "MISSING_COST", count: number, message: string }
    ],
    meta: { page, pageSize, total, dataCompleteness }
  }
}
```

---

## 22. Recommended UI Design Without Redesigning

Keep current Treasury style.

Add top filters:

- invoice date from/to
- date type
- customer
- material/fabric
- material code
- color
- supplier
- warehouse
- payment status
- currency

Keep summary cards:

- إجمالي المبيعات
- إجمالي التكلفة
- إجمالي الربح
- المحصل
- الذمم المتبقية
- عدد بنود تكلفة مفقودة

Keep detailed table, but add columns:

- رقم الفاتورة
- تاريخ الفاتورة
- العميل
- حالة الدفع
- الخامة
- كود الخامة
- اللون
- كود اللون
- الباركود
- الكمية
- سعر البيع
- إجمالي البيع
- تكلفة الوحدة
- إجمالي التكلفة
- الربح
- المحصل
- المتبقي
- مرجع السند

Date display should remain date-only for business users.

---

## 23. Recommended Accounting Rules

1. Use confirmed sales invoices only.
2. Exclude drafts and voided invoices.
3. Use net sales from invoice line/header stored values.
4. Use historical cost snapshot if available.
5. If historical cost snapshot is not available, prefer GL COGS posted at confirmation over current roll cost.
6. If neither cost snapshot nor GL COGS is reliable, flag missing cost.
7. Do not silently treat missing cost as zero for profit.
8. Do not recalculate old invoices from new roll prices.
9. Do not infer invoice-level collections from customer-level vouchers without allocation.
10. Separate gross profit from collected cash.
11. Deduct confirmed sales returns when `includeReturns=true`.
12. Use USD/base currency for totals and show original currency context.

---

## 24. Required Future Implementation Phases

Phase 1: Evidence and data verification

- Query production/dev DB for sales invoice line link coverage.
- Count lines with null `fabric_roll_id`.
- Count lines with missing/zero cost.
- Compare GL COGS totals against report cost totals.
- Verify whether manual vouchers update invoice paid/remaining.

Phase 2: Safe cost source

- Add cost snapshot fields to sales invoice lines for future invoices, or build report from historical GL COGS.
- Do not mutate old invoices.
- Add report warnings for old invoices without historical cost.

Phase 3: Payment allocation

- Add invoice payment allocation model, or document that only invoice stored paid/remaining is supported.
- Link receipt vouchers to invoice IDs, not only invoice numbers.
- Support partial allocation across invoices.

Phase 4: Material-level report

- Join lines to rolls/items/colors/warehouses/suppliers.
- Add line-level and grouped views.
- Add filters.

Phase 5: Returns and currency

- Deduct confirmed linked sales returns.
- Convert costs and returns to base currency consistently.
- Display original currency and base totals.

Phase 6: UI and export

- Extend current Treasury UI without redesign.
- Add export/print only after report values are verified.

---

## 25. Testing Checklist for Future Implementation

Use scenarios:

- Confirmed cash sale, one roll, USD.
- Confirmed credit sale, unpaid.
- Confirmed partial sale with paid amount.
- Manual receipt after invoice confirmation.
- Receipt allocated to multiple invoices.
- Sale in non-USD currency.
- Roll cost in non-USD currency.
- Sale line with missing fabric roll.
- Sale line with missing cost.
- Partial roll sale.
- Full roll sale.
- Sales return linked to original invoice line.
- Voided invoice.
- Draft invoice.
- Mixed materials/colors in one invoice.
- Multiple suppliers/source rolls in one invoice.
- Customer filter.
- Material code filter.
- Warehouse filter.
- Payment status filter.
- Date filter by invoice date.
- Collection date filter after allocation exists.

Expected assertions:

- Draft/voided invoices excluded.
- Gross profit equals sale minus historical cost.
- Missing cost flagged.
- Returns deducted only when requested/defined.
- Customer-level voucher not falsely assigned to invoice without allocation.
- USD/base totals match stored USD fields or documented conversion.

---

## 26. Remaining Risks

- Current report may be accepted by users as accurate profit, while cost source is mutable.
- Existing historical invoices may lack enough cost evidence for exact retroactive material profit.
- If vouchers are already used as customer-level payments, retroactive invoice allocation may require business rules.
- Multi-currency cost conversion needs a clear source currency and historical exchange rate.
- Returns may require a business decision: show original sales, net sales after returns, or both.
- Runtime/database verification is still needed before implementation because code inspection cannot prove data completeness in live rows.

---

## 27. Current UI Questions Answered

1. Location: Treasury menu, `كشف الأرباح التفصيلي`.
2. Route/component: `/treasury/profit-details`, `ProfitDetails`.
3. Inside Treasury: yes.
4. Filters: from date, to date.
5. Columns: date, invoice no, customer, sales, collected, remaining, cost, gross profit, realized profit, receivable profit.
6. Totals: total sales, total cost, total gross profit, receivable profit.
7. Shows sales invoices: yes, confirmed sales invoice headers.
8. Shows invoice lines/materials: no.
9. Shows cost: yes, estimated from roll unit cost.
10. Shows gross profit: yes.
11. Shows collected amount: yes, from invoice stored paid amount.
12. Shows remaining receivables: yes, from invoice stored remaining amount.
13. Shows payment status: no.
14. Shows customer: yes.
15. Shows supplier: no.
16. Shows material/fabric: no.
17. Date display: date-only in UI.
18. Arabic labels: yes.
19. Preserves current UI style: yes, same cards/table style.
20. Data source: real API data, not local/mock.

---

## 28. Current API Questions Answered

1. Dedicated endpoint: yes.
2. Path: `/api/reports/financial/profit-details`.
3. Query params: `fromDate`, `toDate`, `page`, `pageSize`.
4. Date filters: invoice date only.
5. Customer/material/supplier filters: no.
6. Tables queried: `sales_invoices`, `sales_invoice_lines`, `fabric_rolls`, `customers`.
7. Confirmed invoices only: yes.
8. Draft/void excluded: yes.
9. Cost source: current `fabric_rolls.unit_cost`, not line cost snapshot.
10. Profit level: invoice header level.
11. Collected/remaining: yes, from invoice stored amounts.
12. Voucher joins: no.
13. Partial payments: reflected only if invoice stored paid/remaining is updated.
14. Multi-currency: partial USD support for invoice amounts; cost conversion risk remains.
15. Returns: not handled.
16. Missing cost: treated as zero, no warning.
17. Calculation technology: SQL CTEs.
18. Frontend/backend: backend calculates; frontend formats/displays.

---

## 29. Final Assessment

The current report is a useful first version but should not be treated as the final managerial detailed profit report. It needs a safer cost source, line/material expansion, payment allocation clarity, returns handling, and richer filters before it fully matches the requested business meaning.

