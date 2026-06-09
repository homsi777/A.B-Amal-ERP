# PHASE 1 — Fixes: Enter Navigation + Invoice Statement Payment / Party Details

**Date:** 2026-05-04  

---

## 1. Summary of fixes

1. **InvoiceForm:** Enter navigation in fabric line rows now uses **explicit field order** (`data-invoice-field-index`), skips hidden columns, respects **IME/composition**, and continues to **الوزن (KG)** then optionally **سعر المتر** in the **summary** table when it is open (matching group by material + design + price). Last field falls through to **next row** or **add row**. Summary price inputs use **Enter** → existing `focusNextFormControl` to continue in the form. Discount field participates in enter-scope navigation.
2. **InvoiceStatement:** **Customer/supplier name** comes from **`partyDisplayName`** populated from API header (`customer_name` / `supplier_name`) with Zustand lookup as secondary fallback — **no default "Cash customer / supplier"** when a party id exists without a local store match. **Payment** block (when amounts are visible) shows status, inferred **sale terms** (cash vs credit/partial), **Paid**, **Remaining**, and **Total** with currency.

---

## 2. Files changed

| File | Change |
|------|--------|
| `src/pages/invoices/InvoiceForm.tsx` | `collectInvoiceLineNavInputs`, `handleInvoiceLineEnter`, `data-invoice-item-row` / field indices, summary price `data-*` + Enter handler, discount `focusNextFormControl` |
| `src/pages/invoices/InvoiceStatement.tsx` | `partyDisplayName` priority, `paymentStatusLabel` / `saleTermsLabel`, extra `InfoBox` rows for payment amounts |
| `src/types/index.ts` | Optional `partyDisplayName` on `Invoice` |
| `src/lib/invoiceDbMappers.ts` | `numFromDb`, map `customer_name`/`supplier_name` → `partyDisplayName`, safer numeric mapping for lines |
| `docs/PHASE_1_FIXES_ENTER_AND_STATEMENT_REPORT.md` | This report |

---

## 3. Root cause — Enter navigation

- Row cells **العرض / GSM** are **hidden** but inputs still lived in the DOM; relying on **unordered** `querySelectorAll('input')` and **`indexOf`/`===`** across re-renders could fail to advance consistently from **المتر** to the next visible field.
- There was **no editable سعر المتر in the line row**; price is in the **collapsible summary** grid. After **KG**, focus needed an explicit path to **summary price** (when open) before the **next row**.
- **Composition** (Arabic IME) could interfere if Enter is handled during `isComposing`.

---

## 4. Root cause — statement party / payment

- **API detail** already returned `customer_name` / `supplier_name` via SQL JOIN, but **`mapSalesInvoiceDetailToInvoice` / purchase** did not map them onto the **Invoice** object used by the UI.
- **InvoiceStatement** resolved the party **only** from **Zustand** `customers` / `suppliers`, which are often **empty** in DB-first flows → fallback always became **"Cash customer / supplier"**.
- **Paid / remaining** values could be weakly parsed from PostgreSQL **`numeric`** strings; **`numFromDb`** normalizes. The **UI** only showed a single **Payment** word without amounts.

---

## 5. Backend fields

- **No backend or route changes** were required: `GET` detail queries already selected `customer_name` / `supplier_name`.

---

## 6. Frontend mapper / types

- **`Invoice.partyDisplayName?: string`** — set from `header.customer_name` or `header.supplier_name` when present.
- **List row mappers** also set `partyDisplayName` for consistency.
- **`mapLineToInvoiceItem`**: `quantity`, `unitPrice`, `line_total` via **`numFromDb`**.

---

## 7. Test commands run

```bash
npm run lint
npm run server:check
npm run test
npm run server:build
```

---

## 8. Test results

All completed with **exit code 0**.

---

## 9. Manual test (expected)

Not run in CI; please verify locally:

1. Sales invoice line: **Enter** moves **material → … → meters → KG → (summary price if section open) → next row**.
2. **Arabic input**: Enter not consumed mid-composition.
3. Statement for DB UUID invoice: **real customer name**, **Partial** + **paid/remaining/total** in **USD** (or invoice currency).
4. **إخفاء المبالغ** still hides the financial `InfoBox` group including payment amounts.

---

## 10. Remaining risks

- **Sale terms** (`Credit / Deferred`, etc.) are **inferred** from paid vs total totals — **`saleType` from the form is not stored** on `sales_invoices` in Phase 1. To show persisted “آجل/نقدي”, a future DB column + payload would be needed.
- **Payment method** is not on invoice tables; not shown unless added server-side later.
- If **summary** is **collapsed**, Enter from **KG** skips price and goes to **next row** (by design).
- Group match for summary price uses **material + design + price per meter** to support multiple price buckets.
