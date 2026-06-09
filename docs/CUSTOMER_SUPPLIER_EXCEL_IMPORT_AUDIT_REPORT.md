# Customer/Supplier Excel Import Audit Report

Date: 2026-05-17

Scope: read-only code audit. No runtime database verification was performed. No application behavior, schema, or import logic was changed.

## 1. Executive Summary

The project currently has a customer statement Excel import feature, not a general customer/supplier Excel import engine.

The feature is located in the Customers page and opens `CustomerStatementImportModal`. It reads one Excel workbook in the browser, extracts a specific fixed-layout customer statement, previews sales rows, payments, returns/credits, and balance differences, then posts the parsed result to:

`POST /api/customers/import-statement`

The backend does not store the import as neutral staging data. It converts the imported customer statement into live accounting documents:

- creates or reuses a customer
- creates a confirmed sales invoice for imported sales rows
- creates confirmed receipt vouchers for imported payments
- creates cashbox movements for those receipts
- posts GL entries for sales invoices, receipt vouchers, and some imported return/credit/balance adjustment cases
- adds a party activity log entry

Supplier Excel import for old balances/payments was not found. `supplierRoutes.ts` supports CRUD and supplier statements, but there is no supplier `import-statement` endpoint and no supplier Excel import modal in the inspected code.

The highest date risk is in frontend parsing. `parseDateText()` only recognizes textual dates matching `dd/mm/yyyy`, `dd-mm-yyyy`, or `dd.mm.yyyy`. If it does not match, it silently returns today's date. Because the workbook is read with `cellDates: false` and `raw: true`, Excel serial date numbers are not reliably converted. This can explain imported payment dates appearing wrong or unrealistic.

This import can be useful operationally, but it is not accounting-safe enough as a final historical import model because it conflates imported old sales, opening balance, payments, returns, and balance adjustments into current live accounting documents without preserving a full row-level audit trail or original cell values.

## 2. Current UI Flow

Navigation:

- Main layout: `src/layouts/DashboardLayout.tsx`
- Section: `العملاء والموردون`
- Customer page route: `/customers`
- Supplier page route: `/suppliers`

Customer import entry point:

- `src/pages/Customers.tsx`
- Button label: `استيراد كشف عميل`
- Opens: `src/components/customers/CustomerStatementImportModal.tsx`

Modal flow:

1. User opens Customers page.
2. User clicks `استيراد كشف عميل`.
3. Modal asks for an Excel file and loads active cashboxes.
4. Browser reads the file using `xlsx`.
5. Modal analyzes the first worksheet.
6. User reviews customer name, statement date, sales total, payments, returns, file balance, computed balance, and warnings.
7. If payments exist, user must choose a cashbox.
8. User clicks confirm import.
9. Frontend sends parsed data to `POST /api/customers/import-statement`.

Supplier UI:

- `src/pages/Suppliers.tsx` and `src/pages/suppliers/SupplierStatement.tsx` exist.
- No supplier Excel import modal or supplier statement import button was found.

## 3. Current Backend/API Flow

Routes are registered in `server/src/app.ts`:

- `customerRoutes` under `/api/customers`
- `supplierRoutes` under `/api/suppliers`
- vouchers, cashboxes, reports, sales invoices, purchase invoices, and finance routes are also registered separately.

Customer import endpoint:

`POST /api/customers/import-statement`

Implemented in:

- `server/src/routes/customerRoutes.ts`

Main backend flow:

1. Validate body with `importStatementBody`.
2. Reject non-USD imports.
3. If payments exist, require `cashboxId`.
4. Resolve or create customer by name.
5. Build deterministic-ish import references:
   - `smartInvoiceNo = STMT-{date}-{customer}`
   - `legacyInvoiceNo = OLD-{customer}-{date}`
   - `referenceNo = STMT:{fileKey}:{customerId}:{dateKey}`
6. If a matching invoice exists, update line metadata.
7. If no matching invoice exists and sales total is positive, create a confirmed sales invoice.
8. For each payment, create and confirm a receipt voucher unless already imported.
9. For each imported return/credit row, create a posted journal entry.
10. If sheet balance differs from computed balance, create a credit journal or a debit adjustment invoice.
11. Insert a party activity log record.
12. Commit transaction.

Supplier import endpoint:

- Not found.

## 4. Excel Column Mapping

The current parser is not header-based. It assumes a fixed worksheet structure.

File parsing:

- File is read in `CustomerStatementImportModal.tsx`.
- `XLSX.read(data, { cellDates: false, cellNF: true, cellStyles: true })`
- First sheet only.
- Rows extracted with `XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true })`.

Customer name:

- First cell text containing `السيد/ة`.
- `normalizeName()` removes the prefix and normalizes spaces.

Statement/order date:

- Preferred cell: `rows[8]?.[7]`
- Fallback: first string that exactly matches `dd/mm/yyyy`, `dd-mm-yyyy`, or `dd.mm.yyyy`.

Sales lines:

- column 0: date
- column 1: material/fabric name
- column 2: quantity
- column 5: rolls count
- column 6: city
- column 7: unit price
- column 8: total
- column 10: note

A row is imported as a sale line only if:

- date exists
- material name exists
- quantity is finite and greater than zero
- total is greater than zero

Payments and returns:

- column 2: date label text
- column 4: amount
- row is considered only if column 2 includes a date-like text and amount is greater than zero
- if date label contains `مرتجع`, it is classified as return/credit
- otherwise it is classified as payment/receipt

Fixed summary cells:

- sales total: row 37 col 9 or row 43 col 5
- meters total: row 37 col 3
- rolls total: row 37 col 6
- balance: row 65 col 5 or row 66 col 5

Currency:

- Hardcoded to `USD` in frontend analysis.
- Backend rejects anything except USD.

## 5. What Data Is Imported

Customer import supports:

- customer name
- imported sales rows
- payments/receipt rows
- return/credit rows
- final sheet balance
- computed sales, payments, returns, computed balance, and balance difference

It does not import as simple customer master data only. It turns the statement into accounting-impacting documents.

Supplier import:

- Not supported by the inspected Excel import workflow.

## 6. Where Imported Data Is Stored

Customer master:

- `customers`
- Existing customer is found by case-insensitive trimmed name.
- If missing, a new customer is inserted with generated `CUS-*` code and notes saying it was added from Excel customer statement import.

Imported sales:

- `sales_invoices`
- `sales_invoice_lines`
- Confirmed via `createSalesInvoice(... confirm: true ...)`.
- Invoice notes contain the import file name and reference.
- Line `metadata` stores parsed line details such as `statementImport`, `fileName`, `rowDate`, `materialName`, `city`, `unitPrice`, `rolls`, `sourceLine`, and note.

Imported payments:

- `vouchers`
- `cashbox_movements`
- `party_activity_logs`
- `journal_entries`
- `journal_lines`

Imported return/credit rows:

- Posted directly through `insertCustomerCreditJournal()` into `journal_entries` and `journal_lines`.
- No return invoice is created for these imported return/credit rows.

Balance-difference adjustment:

- If imported sheet balance differs from computed balance:
  - negative difference creates a credit journal through `insertCustomerCreditJournal()`
  - positive difference creates an additional confirmed debit adjustment sales invoice

Import activity:

- `party_activity_logs` receives a `CUSTOMER_STATEMENT_IMPORT` record.

## 7. Customers and Suppliers Support

Customers:

- Supported through `CustomerStatementImportModal` and `/api/customers/import-statement`.

Suppliers:

- Supplier CRUD and supplier statement are supported.
- Supplier old-balance/payment Excel import was not found.
- No `importSupplierStatement` API function was found.
- No `/api/suppliers/import-statement` route was found.

Therefore the current Excel statement import is customer-only.

## 8. Opening Balance Behavior

There is no dedicated imported customer opening balance table.

The import does not clearly store a separate “opening balance” record with original Excel row evidence. Instead:

- sales rows become a confirmed sales invoice
- payments become confirmed receipt vouchers
- returns/credits become GL journal entries
- balance difference becomes either a credit journal or debit adjustment invoice

Customer statements compute opening balance dynamically as all statement rows before `fromDate`. Because imported historical data becomes invoices/vouchers/journal entries, it can affect opening balance if dated before the report period.

Accounting concern:

- This is not the same as a clean opening balance migration.
- A historical receivable with no invoice details should ideally become an opening balance journal, not necessarily a sales invoice.
- A historical old invoice should be marked as old/imported with clear source and original date.

## 9. Payment / دفعات Behavior

Payments are supported only for customer imports.

Frontend:

- Extracts payment rows from column 2 date label and column 4 amount.
- Classifies row as `payment` unless label includes `مرتجع`.

Backend:

- Creates a receipt voucher for each imported payment.
- Requires a cashbox.
- Confirms the voucher immediately.
- Creates a cashbox movement.
- Posts a GL voucher entry.

Important limitation:

- Imported payments are not allocated to specific imported sales lines or specific old invoices.
- They reduce the customer balance in statements through vouchers, but do not update the imported sales invoice `paid_amount` or `remaining_amount`.
- Therefore invoice-level payment status may remain unpaid even if the customer-level statement balance reflects receipts.

## 10. Voucher / Cashbox Behavior

For imported customer payments:

- `insertDraftVoucher()` inserts a `RECEIPT` voucher.
- `applyVoucherConfirmation()` inserts a cashbox movement, updates cashbox current balance, inserts party activity, and posts GL.
- Backend then updates voucher status to `CONFIRMED`.

Duplicate check:

- `voucherAlreadyImported()` checks same customer, date, amount, and import reference.
- It checks `reference_document_type='CUSTOMER_STATEMENT_IMPORT'` and reference number, or legacy reference by file name.

Risk:

- If the parsed date is wrong, duplicate detection may fail or create duplicate payments on the wrong date.
- If two real payments have same date and amount in the same file, the import logic may treat one as duplicate depending on reference matching behavior.

## 11. Customer/Supplier Statement Effect

Customer statement service:

- `server/src/services/partyStatementService.ts`
- `getCustomerStatement()` builds rows from:
  - confirmed sales invoices
  - confirmed receipt vouchers
  - confirmed payment vouchers to customer
  - confirmed sales returns
  - customer journal lines with source types `MANUAL`, `OPENING`, `SYSTEM`

Imported customer data appears because:

- imported sales are confirmed sales invoices
- imported payments are confirmed receipt vouchers
- imported returns/credits and credit adjustments are posted as `OPENING` journal entries with customer party lines
- imported debit balance adjustments are confirmed sales invoices

Supplier statement service:

- Supports purchase invoices, supplier payment/receipt vouchers, purchase returns.
- It does not include supplier journal opening lines in the inspected `supplierRowsQuery`.
- No supplier Excel import exists.

## 12. GL / Accounting Effect

The import affects GL.

Imported sales:

- `createSalesInvoice(... confirm: true ...)` confirms a sales invoice.
- `postSalesInvoiceToGl()` posts:
  - Debit AR
  - Credit sales revenue
  - COGS/inventory lines only if sales lines are linked to fabric rolls and costs exist

Since imported statement sales lines use `fabricRollId: null`, there is no inventory movement and no COGS. They are financial sales lines only.

Imported receipts:

- `postVoucherToGl()` posts:
  - Debit cash
  - Credit AR for customer receipt

Imported returns/credits:

- `insertCustomerCreditJournal()` posts an `OPENING` journal entry.
- It uses sales returns and AR accounts.
- Despite using `source_type='OPENING'`, the description says imported return/discount.

Balance difference:

- Credit adjustment uses `OPENING` journal.
- Debit adjustment uses a confirmed sales invoice, which posts revenue/AR.

Accounting concern:

- Different historical meanings are represented by different document types without a clean import batch/audit table.
- A balance difference can become sales revenue if positive, which may be wrong if it is actually an opening receivable.

## 13. Date Parsing Behavior

Current parser:

```ts
function parseDateText(value: unknown): string {
  const raw = String(value ?? '').replace(/مرتجع/g, '').trim();
  const match = raw.match(/(\d{1,2})[\\/.-](\d{1,2})[\\/.-](\d{4})/);
  if (!match) return new Date().toISOString().slice(0, 10);
  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  const year = match[3];
  return `${year}-${month}-${day}`;
}
```

Supported:

- `dd/mm/yyyy`
- `dd-mm-yyyy`
- `dd.mm.yyyy`
- text containing those patterns, including payment labels

Not safely supported:

- Excel serial date numbers
- real Excel date cells when `cellDates=false`
- `yyyy-mm-dd` if interpreted as day-month-year by the regex
- Arabic month names
- localized date formats
- two-digit years
- date/time objects
- invalid dates such as `35/14/2026`

Default behavior:

- If the parser cannot match the pattern, it silently returns today's date.

Original raw date:

- For sales lines, `rowDate` is stored in line metadata only after being normalized in frontend.
- For payments, `rawLabel` is stored as voucher notes.
- The original raw Excel cell value is not consistently preserved for every date cell.

## 14. Why Dates May Be Wrong

Imported dates may be wrong because:

1. Excel serial numbers are not converted.
   - The workbook is read with `cellDates: false`.
   - Raw cell values can be numbers.
   - `parseDateText(45234)` does not match the regex and becomes today's date.

2. Missing or invalid dates become today silently.
   - No row warning is produced for invalid/missing dates.
   - This can make many payments appear on the import date.

3. `yyyy-mm-dd` is unsafe.
   - The regex treats the first group as day and the second as month.
   - A value like `2026-05-10` does not match because first group expects 1-2 digits, so it becomes today.

4. Invalid numeric dates are not validated.
   - `31/99/2026` becomes `2026-99-31`.
   - Backend accepts strings and slices date portions before SQL cast; SQL may reject invalid values, but frontend preview does not clearly explain row-level cause.

5. Timezone can affect fallback today.
   - `new Date().toISOString().slice(0, 10)` uses UTC date, not local business date.
   - Near midnight, this may differ from local date.

6. Original date text is not fully preserved.
   - Without original cell text, later auditing why a date was imported incorrectly becomes difficult.

## 15. What Currently Works

- Customer statement Excel modal exists.
- User can preview parsed totals before import.
- Active cashboxes are loaded and selected.
- Backend wraps import in a transaction.
- Customer is resolved or created.
- Duplicate import checks exist for receipt vouchers.
- Imported sales can appear in customer statements.
- Imported payments can appear in customer statements.
- Imported payments affect cashbox balances.
- Imported payments affect GL.
- Imported return/credit rows affect customer statement through journal lines.
- Basic warnings exist for missing customer name, missing sale rows, sales total mismatch, rolls total mismatch, and balance difference.

## 16. What Is Incomplete

- No supplier Excel import.
- No dedicated import batch/staging table for customer statement imports.
- No row-level import audit table.
- No original Excel cell preservation.
- No robust date parser.
- No Excel serial date support.
- No invalid-date row warnings.
- No distinction between old invoice, opening balance, imported sales, and debt-only balance in the model.
- No payment allocation to specific imported invoices.
- No update to sales invoice `paid_amount` from imported payment vouchers.
- No multi-currency import despite some system multi-currency support.
- No supplier opening balance import.
- No safe preview of GL impact before committing.

## 17. What Is Accounting-Risky

High-risk items:

1. Silent date fallback to today.
   - This can create wrong voucher dates and wrong statement periods.

2. Imported old debt can become sales revenue.
   - Positive balance difference creates a sales invoice adjustment.

3. Imported returns/discounts use an `OPENING` journal source but sales return account logic.
   - This mixes concepts and may confuse audit trails.

4. Imported customer payments create real cashbox movements.
   - If the Excel file represents historical payments before system start, increasing today's cashbox balance may be wrong unless the cashbox opening balance was planned around it.

5. No payment allocation.
   - Customer statement can look correct while imported invoice payment status remains unpaid.

6. No source import batch.
   - Difficult to reverse or audit a full import safely.

7. Fixed-cell parsing.
   - A slightly different Excel layout can import wrong cells as money/date.

8. Supplier balances are not supported.
   - Manager may assume both customers and suppliers are covered because the module is named customers/suppliers.

## 18. Recommended Safe Future Design

Recommended model:

1. Add an import preview/staging layer.
   - Store file name, sheet name, import batch id, imported by, imported at.
   - Store every parsed row with original cell values and normalized values.

2. Add row classification before posting:
   - `OPENING_BALANCE`
   - `OLD_INVOICE_BALANCE`
   - `PAYMENT_RECEIPT`
   - `CUSTOMER_CREDIT`
   - `SUPPLIER_PAYABLE`
   - `SUPPLIER_PAYMENT`
   - `IGNORED/UNMAPPED`

3. Add strict date parser:
   - support Excel serial dates
   - support `dd/mm/yyyy`
   - support `yyyy-mm-dd`
   - support date objects
   - reject invalid dates with row warnings
   - do not invent dates silently
   - preserve original date text/value

4. Separate historical opening balances from cash movements.
   - If importing data before system start, use opening balance journal entries.
   - Do not create cashbox movements for old payments unless explicitly intended.

5. Add supplier import.
   - Mirror customer logic carefully but with AP direction.
   - Supplier statement should include supplier opening journal lines if opening balances are used.

6. Add import reversal.
   - A full import batch should be reversible/voidable if imported incorrectly.

7. Add accounting preview before commit.
   - Show proposed invoices, vouchers, journal entries, cashbox movements, and statement impact.

## 19. Required Future Implementation Phases

Phase 1: Evidence and parser hardening

- Add robust date parser utility with unit tests.
- Add row-level warnings for invalid dates.
- Preserve original date value and normalized date.
- Do not default to today for invalid imported dates.

Phase 2: Import staging

- Add customer/supplier statement import batch tables.
- Store original rows and normalized rows.
- Add import status: previewed, committed, failed, reversed.

Phase 3: Accounting classification

- Let the manager classify rows as opening balance, payment, old invoice, credit, or ignore.
- Add clear Arabic labels and accounting direction.

Phase 4: Customer import correction

- Keep existing customer import path but route it through staging and classification.
- Add exact audit trail from Excel row to generated document.

Phase 5: Supplier import

- Add supplier Excel statement import with AP-safe posting.
- Update supplier statement to include supplier opening/manual journal lines if needed.

Phase 6: Reversal and reporting

- Add import batch reversal/void flow.
- Add import audit report and reconciliation report.

## 20. Manual Testing Checklist

Use test files with:

1. Text date `10/05/2026`.
2. Text date `2026-05-10`.
3. Excel serial date cell.
4. Arabic text date or localized date.
5. Empty date.
6. Invalid date such as `35/14/2026`.
7. Payment row with `مرتجع`.
8. Two payments on same date with same amount.
9. Balance difference positive.
10. Balance difference negative.
11. Customer name already exists.
12. Customer name does not exist.
13. Payments with no cashbox selected.
14. USD and non-USD file indication.
15. Different worksheet layout from the expected fixed cells.

Expected future assertions:

- Invalid dates block import or produce row errors.
- Excel serial dates import correctly.
- Original date values remain auditable.
- Opening balances do not alter cashbox unless explicitly selected.
- Historical payments do not inflate current cashbox unintentionally.
- Customer statement and GL agree after commit.
- Supplier import, when added, affects AP correctly.

## 21. Needs Runtime/Database Verification

The following cannot be fully proven without running the app against real imported files and database rows:

- Whether production Excel files match the fixed cell layout.
- Whether current imported records already contain wrong voucher dates.
- Whether cashbox balances have already been affected by historical imported payments.
- Whether managers expect imported payments to affect current cashbox or only opening balance.
- Whether imported sales invoices created from old statements should be treated as revenue or opening AR.
- Whether any supplier import exists outside the inspected TypeScript frontend/backend paths.
