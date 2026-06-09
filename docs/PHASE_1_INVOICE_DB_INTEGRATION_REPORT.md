# PHASE 1 — Invoice DB Integration Report

**Date:** 2026-05-04  
**Scope:** Sales and purchase invoice persistence in PostgreSQL, API routes, frontend wiring (no UI redesign).

---

## 1. Summary of implemented changes

- Added **migration `016_sales_purchase_invoices.sql`** (and copy under **`server-bundle/db/migrations/`**) for `sales_invoices`, `sales_invoice_lines`, `purchase_invoices`, `purchase_invoice_lines`, GL `journal_entries` source types, and idempotent GL account seeds (`GL_INVENTORY`, `GL_SALES_REVENUE`, `GL_COGS`).
- Implemented **sales and purchase invoice services** (Zod validation, CRUD on drafts, **confirm** with transactions, **void** for sales with stock restore metadata; purchase void reverses GL per existing service logic).
- Registered **Fastify routes**: `/api/sales-invoices` and `/api/purchase-invoices` in **`server/src/app.ts`**.
- Added frontend API wrappers:**`src/lib/api/salesInvoicesApi.ts`**, **`src/lib/api/purchaseInvoicesApi.ts`**, and **`src/lib/invoiceDbMappers.ts`**.
- **Sales / Purchases list pages** load rows from the API (search debounced); display uses `invoice_no` where applicable.
- **Invoice form** persists via POST to the API (`confirm: true` on final save). **Removed duplicate client-side voucher creation** when the backend confirm flow already creates/confirms receipt/payment vouchers. **Removed local Zustand `addFabric` usage on save** for purchase lines (DB is source of truth for posted stock).
- **Invoice statement** loads by UUID from sales then purchase API, with **Zustand fallback** for legacy local ids.
- **Customer / supplier statements** merge **CONFIRMED** invoices from the API (with per-invoice detail fetch for lines) with **legacy local-only** invoices (non-UUID ids) to avoid silent mixing of DB UUID rows with old local ids at the same id shape.

---

## 2. Files created

| File |
|------|
| `server/src/routes/purchaseInvoiceRoutes.ts` |
| `server-bundle/db/migrations/016_sales_purchase_invoices.sql` |
| `src/lib/invoiceDbMappers.ts` |
| `src/lib/api/salesInvoicesApi.ts` |
| `src/lib/api/purchaseInvoicesApi.ts` |
| `docs/PHASE_1_INVOICE_DB_INTEGRATION_REPORT.md` (this file) |

*(Migration `server/src/db/migrations/016_sales_purchase_invoices.sql` was introduced in the same phase; path confirmed in repo.)*

---

## 3. Files modified (high level)

- `server/src/app.ts` — register sales and purchase invoice routes.
- `server/src/services/salesInvoiceService.ts` — `DbQuery` type for list/detail; fixed `getSalesInvoiceById` line query variable.
- `server/src/services/purchaseInvoiceService.ts` — `DbQuery` for list/detail; import order.
- `server/src/routes/salesInvoiceRoutes.ts` — remove unused import; pass `getPool()` without incorrect cast.
- `src/pages/Sales.tsx` — API list + loading/error.
- `src/pages/Purchases.tsx` — API list + loading/error.
- `src/pages/invoices/InvoiceForm.tsx` — API save; party UUID required; removed duplicate voucher + local purchase `addFabric` on save; removed dead helpers.
- `src/pages/invoices/InvoiceStatement.tsx` — API-first load for UUID ids.
- `src/pages/customers/CustomerStatement.tsx` — merge DB CONFIRMED sales + legacy local sales.
- `src/pages/suppliers/SupplierStatement.tsx` — merge DB CONFIRMED purchases + legacy local purchases.

---

## 4. New database tables

- `sales_invoices`, `sales_invoice_lines`
- `purchase_invoices`, `purchase_invoice_lines`

(Plus constraint/index changes on `journal_entries` as defined in migration 016.)

---

## 5. New API endpoints

**Sales:** `GET/POST /api/sales-invoices`, `GET/PUT/DELETE /api/sales-invoices/:id`, `POST /api/sales-invoices/:id/confirm`, `POST /api/sales-invoices/:id/void`

**Purchases:** `GET/POST /api/purchase-invoices`, `GET/PUT/DELETE /api/purchase-invoices/:id`, `POST /api/purchase-invoices/:id/confirm`, `POST /api/purchase-invoices/:id/void`

All require authentication per existing `authenticateRequest` pattern.

---

## 6. Sales flow (UI → API → DB → inventory → accounting)

1. User fills **InvoiceForm** (sales) and saves draft or final.
2. `POST /api/sales-invoices` with camelCase payload; **draft** stays `DRAFT`; **final** sets `confirm: true`.
3. On confirm, service validates rolls, writes **partial/sale** **`inventory_movements`**, updates **`fabric_rolls`**, stores line **metadata.inventory** for void restore, posts **GL** (`SALES_INVOICE`) when totals allow, and if **paid_amount > 0** creates/confirms a **RECEIPT** voucher (cashbox required) without a second voucher from the client.

---

## 7. Purchase flow (UI → API → DB → inventory → accounting)

1. `POST /api/purchase-invoices` with lines; confirm on final.
2. **Inventory:** For lines with **`fabric_roll_id`**, confirm tags **`purchase_invoice_no`** on the roll and inserts **`PURCHASE_RECEIPT`** movement linked to **`PURCHASE_INVOICE`**. Lines without a roll get GL/document only (no movement).
3. **GL:** `PURCHASE_INVOICE` posting per `postPurchaseInvoiceToGl`. **Payment:** optional **PAYMENT** voucher on paid amount.

**Important:** Purchase **does not** auto-create new `fabric_rolls` from free-typed invoice lines in this phase. New stock should enter via roll creation / import flows already in the product.

---

## 8. Fully completed

- PostgreSQL tables and migration 016 (+ bundle copy).
- Backend services and routes for sales/purchase invoices.
- Frontend API clients and list/detail usage on main screens.
- Invoice form **server persistence** and removal of **double voucher** creation on success path.
- Sales list / purchase list **DB-backed** primary source.
- Customer/supplier statements **prefer CONFIRMED DB invoices** for UUID parties with explicit legacy merge rule.
- `npm run lint`, `npm run server:check`, `npm run test` — **passed** (see §11).

---

## 9. Partially completed

- **Purchase stock:** Only lines that reference an existing **`fabric_roll_id`** participate in inventory movements; Excel/local import workflows that only touched Zustand are unchanged.
- **Walk-in / empty party:** Form now **requires a UUID customer/supplier** to save to the API (no “نقدي سريع” empty selection for DB save).
- **GL for edge cases:** Cash sales without AR substitution, complex tax/discount split accounts — not redesigned beyond existing COA keys.

---

## 10. Could not be completed safely (without further schema/UX work)

- **Automatic migration** of old browser/Zustand-only invoices into PostgreSQL (risky; not attempted).
- **Full purchase receiving** (creating rolls from invoice lines) without duplicating fabric-roll business rules already owned by roll/import modules.
- **Nullable customer** for walk-in while keeping clean AR/cash GL split — would need product decision + GL rules.

---

## 11. Exact test commands run

```bash
npm run lint
npm run server:check
npm run test
```

---

## 12. Test results

- **`npm run lint`** — exit 0  
- **`npm run server:check`** — exit 0  
- **`npm run test`** — `fabricInvoiceSummary tests passed`  

*Migration apply against a live PostgreSQL instance was not run in this session; run `npm run server:migrate` on your target DB when deploying.*

---

## 13. Remaining risks

- **Duplicate id semantics:** Legacy local invoice ids (`INV-*` / random) vs UUID DB ids — statements merge only non-UUID locals to avoid clashes.
- **Statements N+1:** Customer/supplier statements fetch list then **one GET per invoice** for lines; may be slow for very large histories (acceptable for Phase 1; can add `includeLines` later).
- **Voucher + GL interaction:** Assumes backend voucher confirm and invoice GL posting are consistent with finance module expectations; needs finance UAT.
- **Purchase without roll ids:** Confirmed invoices may post GL without inventory movement — operators must understand limits.

---

## 14. Recommended next tasks

1. Run **migration 016** on staging/production and smoke-test create/confirm/void.
2. Add optional **`GET /api/sales-invoices`** (and purchase) **`includeLines`** or a batched statement endpoint to remove N+1.
3. Define **walk-in customer** master record or nullable `customer_id` + cash GL path.
4. Integrate **purchase line → roll creation** via existing fabric-roll APIs where product owners confirm rules.
5. **Excel import** path: optionally persist imported batches as `purchase_invoices` instead of only Zustand.

---

## Visual / UX note

**No intentional UI redesign:** Layout and styling classes on touched pages were preserved; list pages gained only standard loading/error rows consistent with existing typography.
