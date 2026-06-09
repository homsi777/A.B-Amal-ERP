# CLOTEX / Fabric Warehouse ERP — Deep Technical Status Report

**Generated from codebase analysis (read-only).**  
**Scope:** Electron desktop + React (Vite) + TypeScript frontend, Fastify + PostgreSQL backend, remote VPS deployment patterns.  
**Constraint respected:** This document does not change source code; it reflects the repository as analyzed.

---

## 1. Executive summary

The project is a **hybrid ERP**: substantial parts of **inventory, parties, treasury (cashboxes/vouchers), payroll, returns, labeling, imports, reports, GL (chart + journal lines), activation, and Telegram** are implemented **against PostgreSQL** via **Fastify APIs**. At the same time, several **commercially visible modules remain local-only** in the React app using **Zustand (`useStore`)** with **no matching database tables** for persistence—notably **sales/purchase invoice lists and accounting-style UI (dashboard KPIs, expenses, customer/supplier statements’ local ledger, orders)** unless extended to the API.

**Highest architectural risk:** **Two parallel truths** for stock and commercial documents—**`fabric_rolls` + movements on the server** versus **flat `inventory` + `invoices` in memory**—can diverge if users mix API-driven screens and local invoice flows.

**Operational model:** The **renderer talks to HTTP API** (`src/lib/api/client.ts`). **PostgreSQL is reached only on the server** via `DATABASE_URL` (`server/src/config/env.ts`, `server/src/db/pool.ts`). Packaged desktop runs an **embedded Fastify** on `127.0.0.1:4010` (`electron/main.ts`, `electron/embedded-backend`) while **optionally** using **SSH/plink tunnel** to Postgres per `electron/config/vps-connection.json` (`electron/tunnel/deliveryVpsTunnel.ts`).

---

## 2. Project architecture overview

### 2.1 Frontend (`src/`)

| Area | Technology | Responsibility |
|------|------------|------------------|
| SPA shell | React 18 + `react-router-dom` | Routes in `src/App.tsx`; **HashRouter in Electron prod** for `file://` compatibility |
| State (local ERP slice) | Zustand | `src/store/useStore.ts` — customers, suppliers, invoices, expenses, transactions, inventory, orders (not Postgres-backed for most entities) |
| Remote API | `fetch` wrapper | `src/lib/api/client.ts` — base URL resolution, JWT storage (sessionStorage in Electron), health/errors |
| API modules | TypeScript | `src/lib/api/*.ts` — one file per domain (customers, rolls, vouchers, finance, etc.) |
| UI / theme | Tailwind-style utilities + CSS variables | `src/theme/themeTokens.ts`, `ThemeApplier`, `layouts/DashboardLayout.tsx` |
| Auth gates | Components | `RequireAuth`, `RequireActivation`, `Login.tsx` |

### 2.2 Backend (`server/`)

| Area | Technology | Responsibility |
|------|------------|------------------|
| HTTP | Fastify | `server/src/index.ts`, `server/src/app.ts` — CORS, route registration |
| DB access | `pg` Pool | `server/src/db/pool.ts` — UTF-8 client_encoding via connection URL |
| Migrations | SQL files + `schema_migrations` | `server/src/db/migrate.ts`, `server/src/db/migrations/*.sql` |
| Auth | JWT + bcrypt | `server/src/routes/authRoutes.ts`, `server/src/middleware/auth.js` |
| Domain | Routes + services | e.g. `fabricRollRoutes.ts`, `voucherRoutes.ts`, `financeRoutes.ts`, `reportRoutes.ts` |

**Route registration inventory** (from `server/src/app.ts`):  
`/api/health*`, `/api/system`, `/api/telegram`, `/api/activation`, `/api/auth`, suppliers, customers, warehouses, warehouse-locations, fabric (categories/items/colors/variants), inventory (rolls, transfers, waste, stock-import, fabric-classification), purchases/import, labels, returns, party-logs, cashboxes, vouchers, payroll, reports, finance.

### 2.3 Desktop / packaging (`electron/`)

| File / area | Role |
|-------------|------|
| `electron/main.ts` | Window lifecycle, embedded Fastify child process, IPC, settings, CSP; documents security model (no Node in renderer) |
| `electron/preload.ts` | Safe bridge; exposes `fabricApp` (e.g. `isElectron`, `desktopApiBaseAtBoot`) |
| `electron/tunnel/deliveryVpsTunnel.ts` | **plink/SSH** tunnel + DB ping; reads **`vps-connection.json`** (`apiPublicUrl`, tunnel creds, optional `verifyPostgresViaTunnel`) |
| `electron/embedded-backend.ts` | Spawns bundled server (`server-bundle`) with env (e.g. `DATABASE_URL`, `JWT_SECRET`) |

### 2.4 Bundled / duplicate trees (not alternate products)

Observed in repo (for packaging or release): `server-bundle/`, `server-dist/`, `release/win-unpacked/...` — largely **mirrors** of migrations or build outputs. **Canonical migrations for development** are under `server/src/db/migrations/`. Treat others as **artifact risk** (stale copy) unless build pipeline always syncs them (see `npm run server:build` / `scripts/copy-server-migrations.mjs` in `package.json`).

### 2.5 Configuration & connectivity

| Concern | Location | Notes |
|---------|----------|--------|
| Server env | `server/.env` (loaded when not embedded) | `DATABASE_URL` **required**; `JWT_SECRET` required in production |
| API base (renderer) | `src/lib/api/client.ts` | Electron packaged: boot URL → localStorage → VITE → fallback `http://127.0.0.1:4010` |
| VPS public API | `vps-connection.json` (documented in tunnel module as gitignored) | Used to seed API URL; secrets not for renderer |
| Health | `GET /api/health`, `/api/health/live` | DB ping in `healthRoutes.ts` via `dbHealthCheck()` |

---

## 3. PostgreSQL / VPS integration matrix (summary)

**Rule used in this report:** If code path executes SQL through `getPool()` on an authenticated route (or login), it is **“connected to PostgreSQL”** assuming `DATABASE_URL` points at the VPS (or tunnel). If the UI only reads `useStore`, it is **local mock/state** unless bridged.

| Layer | Connected to Postgres? | Evidence |
|-------|------------------------|----------|
| Fastify routes registered in `app.ts` | **Yes** (per route) | Routes use `getPool()` or services that do |
| Zustand `useStore` | **No** | In-memory / `sessionStorage`-like persistence not in migrations |
| Embedded server in EXE | **Yes, if** `DATABASE_URL` provided at runtime | `electron` spawns backend with env |

---

## 4. Module-by-module status table

**Legend:**  
- **DB read/write:** via official API + server SQL.  
- **Local:** Zustand only.  
- **Risk:** subjective operational impact.

| Module | Frontend | Route | API | Backend | Postgres tables (primary) | DB read? | DB write? | Full CRUD? | Validation | Errors / loading | Data source | Missing / gap | Risk | Next action |
|--------|----------|-------|-----|---------|----------------------------|----------|-----------|------------|------------|------------------|-------------|---------------|------|-------------|
| Login | `Login.tsx` | `/login` | `POST /api/auth/login`, activation APIs | `authRoutes.ts` | `users`, `companies`, `roles`, `permissions`… | Yes | Yes (session bootstrap) | Login yes | Zod | Partial UI | **Real** (if API up) | Permission UX thin in UI | Low | Optional: surface permissions |
| Auth guard | `RequireAuth.tsx` | — | Token only | — | — | — | — | — | — | — | Client token | No RBAC enforcement in UI | Med | Map permissions to routes when needed |
| Activation | `RequireActivation`, `activationApi` | — | `/api/activation/*` | `activationRoutes.ts` | `activation_keys` (mig. 009+) | Yes | Yes | Varies | Yes | Partial | **Real** | — | High if misconfigured | Verify prod keys & pepper |
| Health / system | `BackendConnectionBadge`, `systemApi` | — | `/api/health`, `/api/system/*` | `healthRoutes.ts`, `systemRoutes.ts` | DB ping | Yes | No | — | — | Polling | **Real** | Does not validate every module | Low | Use before demos |
| Dashboard | `Dashboard.tsx` | `/` | **None** | — | — | No | No | — | — | — | **Local** (`useStore` inventory/customers/suppliers/orders) | KPIs not from Postgres | Med | Wire reports API or aggregates |
| Inventory (rolls list) | `Inventory.tsx` | `/inventory` | `/api/inventory/rolls`, warehouses | `fabricRollRoutes.ts`, `warehouseRoutes.ts` | `fabric_rolls`, `warehouses`… | Yes | Partial (depends on actions) | List/filter strong | Server-side | Some UI | **Real** | May not match local `useStore` | **High** | Single source of truth strategy |
| Create / edit item | `CreateItem.tsx` | `/inventory/create`, `edit/:id` | fabric items, colors, rolls APIs | multiple routes | `fabric_items`, `fabric_rolls`… | Yes | Yes | Mostly | Yes | Yes | **Mixed** — also `useStore` `inventory` / warehouses | Dual inventory model | **High** | Align or deprecate local inventory |
| Create roll | `CreateRoll.tsx` | `/inventory/rolls/new` | rolls API | `fabricRollRoutes.ts` | `fabric_rolls`, `inventory_movements` | Yes | Yes | Create | Yes | Yes | **Real** | — | Low | — |
| Roll details / move | `RollDetails.tsx` | `/inventory/rolls/:id`… | rolls, warehouses, suppliers | `fabricRollRoutes.ts` | `fabric_rolls`, movements | Yes | Yes | Varies | Yes | Yes | **Real** | — | Low | — |
| Categories | `Categories.tsx` | `/inventory/categories` | `/api/fabric/categories` | `fabricCategoryRoutes.ts` | `fabric_categories` | Yes | Yes | Yes | Yes | Yes | **Real** | — | Low | — |
| Fabric master data | `FabricMasterData.tsx` | `/inventory/fabric-master-data` | categories, colors, items, variants, suppliers | multiple | textile master tables | Yes | Yes | Yes | Yes | Yes | **Real** | Hidden nav | Low | — |
| Sticker / label printing | `StickerPrinting.tsx`, `CustomStickerPrinting.tsx` | `/inventory/labels`… | `labelsApi`, rolls | `labelPrintRoutes.ts` | print job tables (mig. 006) | Yes | Yes | Varies | Yes | Partial | **Real** / mixed | Complex flows | Med | Test printer paths |
| Print jobs | `PrintJobs.tsx` | `/inventory/print-jobs` | labels API | `labelPrintRoutes.ts` | label print schema | Yes | Read-focused | — | — | Yes | **Real** | — | Low | — |
| Warehouses | `Warehouses.tsx` | `/inventory/warehouses` | warehouses API | `warehouseRoutes.ts` | `warehouses`, `warehouse_locations` | Yes | Yes | Yes | Yes | Yes | **Real** | — | Low | — |
| Transfers | `Transfers.tsx` | `/inventory/transfers` | transfers + rolls | `inventoryTransferRoutes.ts` | rolls + movements | Yes | Yes | Workflow | Yes | Yes | **Real** | — | Med | Audit movements |
| Depreciation / damage | `Depreciation.tsx` | `/inventory/depreciation` | waste API | `inventoryWasteRoutes.ts` | waste schema (mig. 012) | Yes | Yes | Varies | Yes | Yes | **Real** | Naming vs accounting | Med | Document GL link if any |
| Stock Excel import modal | `StockExcelImportModal.tsx` | (modal) | `stockImportApi` | `stockImportRoutes.ts` | rolls + movements | Yes | Yes | Batch | Yes | Yes | **Real** | — | Med | Monitor failed rows |
| Bulk pricing | `BulkPricing.tsx` | `/inventory/bulk-pricing` | **None** | — | — | No | No | — | — | — | **Local** | No server price sync | **High** | Replace with API patch to `fabric_items` / rolls |
| Purchase Excel import | `ImportExcel.tsx` | `/purchases/import-excel` | `purchaseImportApi` | `purchaseImportRoutes.ts` | import batches (mig. 005), rolls | Yes | Yes | Pipeline | Yes | Yes | **Real** | Not a classic PO document | Med | Define PO entity if needed |
| Import batches UI | `ImportBatches.tsx` | `/purchases/import-batches` | purchase import API | `purchaseImportRoutes.ts` | batch tables | Yes | Read-heavy | — | — | Yes | **Real** | — | Low | — |
| **Sales invoices** | `Sales.tsx`, `InvoiceForm.tsx`, `InvoiceStatement.tsx` | `/invoices/sales*`, statement | **Partial** — form uses **customers/suppliers/rolls/cashboxes/vouchers** API | various + `voucherRoutes` | **No `sales_invoices` table**; vouchers + rolls yes | **Partial** | **Partial** | List CRUD **local only** | Partial | Partial | **Local invoices** + **real** rolls/cash/voucher | No invoice document in DB | **Critical** | Migrate invoices to DB or read-only sync |
| **Purchase invoices** | `Purchases.tsx`, `InvoiceForm.tsx` | `/invoices/purchases*` | Same as sales for form | — | No purchase invoice header table | **Partial** | **Partial** | **Local** | Partial | Partial | **Local** + import pipeline separate | Same | **Critical** | Same |
| Exchange invoices | `ExchangeInvoices.tsx` | `/invoices/exchange` | **None** | — | — | No | No | — | — | — | **Mock** (`useState`) | Not implemented | Med | Hide or implement |
| Return invoices | `ReturnInvoices.tsx` | `/invoices/returns` | `/api/returns` | `returnInvoiceRoutes.ts` | `return_invoices` (mig. 011) | Yes | Yes | Workflow | Yes | Yes | **Real** | Link to sales/purchase docs weak | Med | Tie to operational docs |
| Customers | `Customers.tsx` | `/customers` | `/api/customers` | `customerRoutes.ts` | `customers`, telegram link tables | Yes | Yes | Yes | Zod | Yes | **Real** | AR balance in UI may be local elsewhere | Med | Centralize AR from GL/subledger |
| Customers log | `CustomersLog.tsx` | `/customers/log` | `/api/party-logs` | `partyActivityLogRoutes.ts` | `party_activity_logs` | Yes | Read | — | — | Yes | **Real** | — | Low | — |
| Customer statement | `CustomerStatement.tsx` | `/customers/statement` | vouchers API (+ local) | `voucherRoutes.ts` | vouchers; **local** invoices/transactions | **Mixed** | **Mixed** | — | Partial | Partial | **Mixed** | Statement fabric rows from local invoices | **High** | Single AR ledger |
| Suppliers | `Suppliers.tsx` | `/suppliers` | `/api/suppliers` | `supplierRoutes.ts` | `suppliers` | Yes | Yes | Yes | Zod | Yes | **Real** | — | Low | — |
| Suppliers log | `SuppliersLog.tsx` | `/suppliers/log` | party logs | `partyActivityLogRoutes.ts` | `party_activity_logs` | Yes | Read | — | — | Yes | **Real** | — | Low | — |
| Supplier statement | `SupplierStatement.tsx` | `/suppliers/statement` | paySupplier local | — | — | No | No | — | — | — | **Local** | No AP from DB | **High** | GL/AP integration |
| Safes (cashboxes) | `Safes.tsx` | `/treasury/safes` | `/api/cashboxes` | `cashboxRoutes.ts` | `cashboxes` | Yes | Yes | Mostly | Yes | Yes | **Real** | — | Low | — |
| Treasury log | `TreasuryLog.tsx` | `/treasury/log` | cashbox movements API | via cashboxes | `cashbox_movements` | Yes | Read | — | — | Yes | **Real** | — | Low | — |
| Treasury settings | `TreasurySettings.tsx` | `/treasury/settings` | list cashboxes | `cashboxRoutes.ts` | `cashboxes` | Yes | Read | — | — | Partial | **Real** | — | Low | — |
| Payment bonds | `PaymentBonds.tsx` | `/bonds/payment` | vouchers | `voucherRoutes.ts` | `vouchers` (+ GL via service) | Yes | Yes | Create+confirm | Yes | Yes | **Real** | — | Med | Test cancel reversals |
| Collection bonds | `CollectionBonds.tsx` | `/bonds/collection` | vouchers | `voucherRoutes.ts` | `vouchers` | Yes | Yes | Create+confirm | Yes | Yes | **Real** | — | Med | — |
| Bond records | `BondRecords.tsx` | `/bonds/records` | list vouchers | `voucherRoutes.ts` | `vouchers` | Yes | Read | — | — | Yes | **Real** | — | Low | — |
| Salaries / payroll | `Salaries.tsx` | `/salaries` | `payrollApi`, cashboxes | `payrollRoutes.ts`, services | payroll tables (mig. 011, 014) | Yes | Yes | Workflow | Yes | Yes | **Real** | Complex payroll rules | Med | Regression payroll → GL |
| Reports center | `ReportsCenter.tsx` | `/reports` | `/api/reports/*`, warehouses | `reportRoutes.ts`, `reportServiceExtended.ts` | many | Yes | Mostly read | — | Server | Yes | **Real** | Some cards “structure ready” per comments | Med | Validate each report path |
| Chart of accounts | `Accounting.tsx` | `/chart-of-accounts` | `/api/finance/chart-of-accounts` | `financeRoutes.ts` | `gl_accounts`, journal data | Yes | Read-focused | — | Zod on manual post | Yes | **Real** | COA UI vs operational accounts | Med | Educate users on “operational” vs GL |
| Journal | `Journal.tsx` | `/journal` | `/api/finance/journal`, manual post | `financeRoutes.ts`, `glPostingService.ts` | `journal_entries`, `journal_lines` | Yes | Yes (manual lines) | Read + post | Yes | Yes | **Real** | Not all operational docs post correctly if local | **High** | Tie sales/purchase to GL |
| Expenses | `Expenses.tsx` | `/expenses` | **None** | — | **No expenses table** | No | No | — | — | — | **Local** | No persistence | **High** | Add expenses + GL |
| Customer orders | `CustomerOrdersPage.tsx` | `/orders` | **None** | — | No orders table in migrations | No | No | — | — | — | **Local** | No persistence | Med | Optional module |
| Manufacturing | `Manufacturing.tsx` | `/manufacturing` | **None** | — | — | No | No | — | — | — | **Mock** | Placeholder ERP screen | Low | Remove from nav or stub API |
| Partners | `Partners.tsx` | `/partners` | **None** | — | — | No | No | — | — | — | **Mock** | Duplicates customers/suppliers concept | Low | Remove/repoint |
| System settings | `SystemSettings.tsx` | `/settings` | `settingsApi` | `systemRoutes.ts` | `system_settings` | Yes | Yes | Partial | Varies | Partial | **Real** | Scope of settings | Med | Audit keys |
| Desktop settings | `DesktopSettings.tsx` | `/settings/desktop` | client URL only | — | — | — | — | — | — | — | LocalStorage | Mis-set API breaks app | **High** | Validate URL + health |
| Telegram | (linked from settings / customers) | — | `telegramApi` | `telegramRoutes.ts` | mig. 007, 008 | Yes | Varies | — | — | Partial | **Real** | Secrets on server | Med | Secure tokens |
| Unused treasury page | `Treasury.tsx` | **not routed** in `App.tsx` | — | — | — | — | — | — | — | — | Static placeholder | Dead route file | Low | Delete only with approval |

---

## 5. Accounting / ERP architecture connection report

### 5.1 What *is* architecturally solid in PostgreSQL

- **Double-entry GL schema:** `gl_accounts`, `journal_entries`, `journal_lines` with `source_type` enum including `VOUCHER`, `RETURN_INVOICE`, payroll types, `MANUAL` (`013_general_ledger_foundation.sql`).
- **Treasury operational loop:** confirming a **voucher** updates `cashbox_movements`, `cashboxes.current_balance`, party activity logs, and calls **`postVoucherToGl`** (`server/src/services/voucherCashboxService.ts`).
- **Returns:** return invoices exist in schema (`return_invoices` in `011`) with API (`returnInvoiceRoutes.ts`); GL linkage via services (pattern matches other modules).
- **Roll-level inventory:** `fabric_rolls` + immutable `inventory_movements` with typed movement reasons (`004_fabric_rolls_inventory_engine.sql`).

### 5.2 Flow analyses

#### (1) Purchase flow

| Step | Implemented? | Where | DB | Gap |
|------|--------------|-------|-----|-----|
| Create supplier | Yes | `Suppliers.tsx` + `supplierRoutes.ts` | `suppliers` | — |
| Purchase invoice (ERP document) | **No / partial** | `Purchases.tsx` + `useStore` | — | No `purchase_invoices` entity; **import pipeline** creates rolls instead |
| Receive stock | Yes | import + roll create APIs | `fabric_rolls`, `inventory_movements` | — |
| Supplier payable | **Incomplete** | Local `useStore` balances on `Purchases` screen | — | **Not subledger in Postgres** |
| Payment | Partial | `PaymentBonds` + vouchers | `vouchers`, GL | Good for cash; **not linked to a purchase invoice document** |
| Auto journal | Partial | vouchers/returns/payroll paths | `journal_entries` | Purchase invoice accrual **missing** |

**Verdict:** **Stock-in is real; AP (payable) and purchase invoice accounting are not end-to-end.**

#### (2) Sales flow

| Step | Implemented? | Where | DB | Gap |
|------|--------------|-------|-----|-----|
| Create customer | Yes | `Customers.tsx` | `customers` | — |
| Sales invoice document | **Local only** | `InvoiceForm.tsx` → `createSaleInvoice` in `useStore` | — | **No persisted sales invoice** |
| Reduce stock | **Split brain** | `useStore` decrements flat inventory **by `fabricId` match**; real stock is roll-based | `fabric_rolls` vs local | **Critical inconsistency risk** |
| Customer receivable | **Local** | `useStore` transactions (`accountId` strings like `'1102'`) | — | Not Postgres |
| Payment | Partial | `CollectionBonds` / auto voucher from invoice form when UUID party + cashbox | `vouchers` + GL | Good if used; **invoice still local** |
| Auto journal for sale | **No** (for invoice accrual) | — | — | Only voucher side robust |

**Verdict:** **UI exists, database integration for the commercial document and AR subledger is incomplete.**

#### (3) Inventory movement

| Step | Implemented? | Evidence |
|------|--------------|----------|
| Transfer | Yes | `Transfers.tsx`, `inventoryTransferRoutes.ts`, movements |
| Adjustment / damage | Yes | `Depreciation.tsx`, `inventoryWasteRoutes.ts` |
| Audit trail | Yes | `inventory_movements` immutable log |
| Link to sales invoice | **Weak / local** | Local invoice does not insert movement rows automatically in sampled `useStore` sale path |

#### (4) Cashbox / bank

| Capability | Status |
|------------|--------|
| Cashboxes + movements | **Postgres — real** |
| Bank as separate module | **Not observed** (payment_method on vouchers includes BANK but no `bank_accounts` table in reviewed migrations) |
| Expense payment | **Local expenses screen** — **not in DB** |

#### (5) Accounting flow

| Capability | Status |
|------------|--------|
| COA + balances from posted lines | **API real** (`financeRoutes.ts`, `glReportService.ts`) |
| Manual journal | **Supported** (validated lines, `postManualJournal`) |
| Operational linkage | Vouchers/returns/payroll wired; **sales/purchase invoices and local expenses not** |
| Trial balance / FS | Reports exist (operational variants in Reports Center) — **quality depends on completeness of postings** |

**Debit/credit rules:** enforced at line level (`journal_lines_dc_chk` — not both debit and credit positive on same line).

---

## 6. Connected vs remaining work (three lists)

### A) Already connected and working (server + DB, primary path)

- Authentication (`users`, JWT).
- Companies / bootstrap after activation.
- Suppliers, customers (master data).
- Warehouses, locations.
- Fabric taxonomy: categories, items, colors, variants.
- Fabric rolls, inventory movements.
- Inventory transfers, waste/damage flows (API).
- Stock import & purchase Excel import batches (pipeline).
- Label printing / print jobs (schema + API).
- Return invoices (DB + API).
- Cashboxes, cashbox movements.
- Vouchers (receipt/payment) + GL posting on confirm/cancel (service layer).
- Payroll (multiple tables, routes).
- Reports hub (reads from Postgres via `reportRoutes` / extended services).
- Finance: GL chart snapshot, journal lines, manual posting, account list bootstrap (`ensureCompanyGlCoa`).
- Activation + Telegram (with dedicated migrations).

**Evidence:** `server/src/app.ts` registrations + migrations `001`–`015` + matching `src/lib/api/*`.

### B) Partially connected

- **Invoice lifecycle:** real party/roll/cashbox APIs + optional voucher + **local** `useStore` invoice persistence.
- **Customer / supplier statements:** mix **Postgres vouchers** and **local invoices/transactions**.
- **Dashboard:** visual ERP shell fed from **local** store.
- **Create Item / Bulk pricing:** **overlap** local `inventory` and server fabric entities.
- **Some reports** labeled in UI as dependent on future sales-invoice linking (`ReportsCenter.tsx` card descriptions).

### C) Not connected (mock / local-only / missing persistence)

- **Sales list & purchase list screens** (`Sales.tsx`, `Purchases.tsx`) — **`useStore` only**.
- **Invoice statement** — reads **local** `invoices`.
- **Expenses** — **local only**; no expense table found in migrations.
- **Supplier statement payments** — `paySupplier` local pattern (from grep architecture).
- **Manufacturing, Partners, Exchange invoices** — **hardcoded React state**, no API imports.
- **`Treasury.tsx`** — static placeholder, **not in router** (dead file relative to `App.tsx`).

---

## 7. Database schema quality review

### Strengths

- Clear **multi-tenant** `company_id` on operational tables.
- **UUID PKs** with `gen_random_uuid()` consistent.
- Fabric rolls: **strong constraints** (non-negative length, unique barcode per company).
- Inventory: **movement audit** table with typed `movement_type`.
- GL: **unique source document** partial index for idempotent posting (`idx_journal_entries_source_doc`).
- Money fields generally `numeric(14,2)` / `numeric(18,2)` for GL lines — appropriate.

### Issues / gaps

1. **No first-class `sales_invoices` / `purchase_invoices` tables** matching the UI’s expectations — biggest ERP gap.
2. **No `expenses` / `ap_invoices` / `ar_invoices` subledger tables** visible in migrations — reporting relies on operational substitutes.
3. **Customer/Supplier balances:** master tables (`customers`, `suppliers`) do not show `balance` columns in `002_textile_master_data.sql`; localized ERP balances in UI may **not** reflect GL.
4. **Soft deletes:** pattern is mostly `is_active` flags — acceptable; not universal.
5. **Cross-module FK from invoice lines to rolls:** purchase data on roll uses `purchase_invoice_no` **text** on `fabric_rolls` — good hint, weak relational integrity.
6. **Duplicate artifacts:** `server-bundle`, `release` trees may drift from `server/src/db/migrations` if build sync fails.
7. **Roles:** `users.role` is `text` with default `admin`; fine-grained permissions exist in DB but **frontend enforcement** not verified.

---

## 8. UI safety and visual identity protection

### Current design system (do not redesign per stakeholder request)

- **Stack:** Utility-heavy components (Tailwind-style classnames), cards with `rounded-xl`, `border-slate-200`, `shadow-sm`.
- **Brand accent:** Indigo primary buttons (`bg-indigo-600`) across ERP screens; layout uses **sidebar + top bar** in `DashboardLayout.tsx`.
- **Theme tokens:** `src/theme/themeTokens.ts` defines **CSS variables** (`--ui-accent`, etc.) and presets: `indigo-classic`, `ocean-teal`, `amber-warm`, `ruby-professional`.
- **RTL / Arabic:** many pages `dir` attributes mixed; fonts Cairo/Tajawal/etc.

### Recommendation for future implementation

- **Only add wiring** (effects, fetches) and small text/status badges matching existing utility styles.
- **Do not** replace navigation, cards, tables, or color tokens unless a bug blocks usage.

---

## 9. Risks and bugs

| Risk | Affected files / area | Severity | Suggested fix (later) | Before delivery? |
|------|----------------------|----------|----------------------|------------------|
| Dual inventory truth (rolls vs local `inventory`) | `useStore.ts`, `Inventory.tsx`, `InvoiceForm.tsx`, roll APIs | **Critical** | Single write path through rolls API | **Yes** |
| Sales/APR without DB invoice | `Sales.tsx`, `InvoiceForm.tsx` | **Critical** | Persist invoice + lines + GL | **Yes** |
| Statements mix local & server | `CustomerStatement.tsx`, `SupplierStatement.tsx` | **High** | Derive from GL/subledger + vouchers | **Yes** |
| Local expenses | `Expenses.tsx` | **High** | Postgres `expenses` + GL | Recommended |
| Desktop API URL misconfiguration | `client.ts`, `DesktopSettings.tsx`, `vps-connection.json` | **High** | Health check + guided setup | **Yes** |
| JWT / activation secrets | `env.ts`, `activationService`, packaging | **High** | Harden prod `.env`, key rotation plan | **Yes** |
| Tunnel / plink fragility | `deliveryVpsTunnel.ts` | **Med** | Document hostkey, timeouts | If tunnel used |
| Stale duplicated migrations in bundles | `server-bundle/`, `release/` | **Med** | Automate copy in CI | **Yes** |
| Mock modules confuse users | `Manufacturing.tsx`, `Partners.tsx`, `ExchangeInvoices.tsx` | **Med** | Hide or label “Demo” | Recommended |
| Permissions not enforced in UI | `RequireAuth` only | **Med** | Route-level capability checks | If multi-user |

---

## 10. Final roadmap to finish the project “today” (practical, prioritized)

**Disclaimer:** “Finish ERP completely” in one day is unrealistic; below is **maximum safe progress** without UI redesign, ordered for **risk reduction**.

### Phase 1 — Critical database / truth fixes

| Goal | Likely files | Expected result | Risk | Test | UI unchanged? |
|------|--------------|-----------------|------|------|---------------|
| Stop divergent stock writes for sales | `InvoiceForm.tsx`, `useStore.ts`, roll API client | One authoritative mutation path | High | Sell roll in dev; verify movement row | Yes (behavior fix only) |
| Document current API URL + health in runbook | README (only if user approves docs) | Fewer misconfig incidents | Low | Manual | N/A |

### Phase 2 — Critical module integrations

| Goal | Likely files | Expected result | Risk | Test | UI unchanged? |
|------|--------------|-----------------|------|------|---------------|
| Persist minimal sales/purchase header+lines | New migration + routes + `Sales.tsx` | DB-backed invoice list | High | CRUD + print | Keep table layout |
| Align customer statement to DB | `CustomerStatement.tsx`, finance API | One AR view | Med | Compare voucher sum | Yes |

### Phase 3 — Accounting architecture linking

| Goal | Likely files | Expected result | Risk | Test | UI unchanged? |
|------|--------------|-----------------|------|------|---------------|
| Post sales/purchase to GL on confirm | `glPostingService.ts`, invoice service | Balanced journals with source | High | Trial balance report | Yes |
| Expense entity + GL | new tables, `Expenses.tsx`, finance | Real expenses | Med | JE lines | Yes |

### Phase 4 — Validation & consistency

| Goal | Likely files | Expected result | Risk | Test | UI unchanged? |
|------|--------------|-----------------|------|------|---------------|
| Roll status constraints (no negative length) | server validators | Safer stock | Med | API negative test | Yes |
| Permission guards for sensitive routes | `RequireAuth` extension | Less insider risk | Med | Login as limited user | Minimal |

### Phase 5 — Desktop EXE production checks

| Goal | Likely files | Expected result | Risk | Test | UI unchanged? |
|------|--------------|-----------------|------|------|---------------|
| Embedded server env injection | `electron/main.ts`, `embedded-backend.ts` | Stable prod DB | High | Cold start EXE | Yes |
| Verify `server-bundle` migration sync | build scripts | No schema drift | Med | `npm run server:build` | Yes |

### Phase 6 — Final testing checklist

- [ ] `GET /api/health` → `database: connected` on VPS.
- [ ] Login + activation on fresh EXE.
- [ ] Create supplier + customer → visible after restart.
- [ ] Create roll → appears in inventory → transfer → movement history populated.
- [ ] Confirm voucher → cashbox balance + GL line + party log.
- [ ] Return invoice → stock/GL behaves as designed.
- [ ] Reports: pick 3 financial + 3 inventory reports; export/print.
- [ ] Sales invoice path: **define expected behavior** (local vs DB) and test against rolls.
- [ ] Failure cases: API down → user sees existing error patterns (no white screen).

---

## 11. Recommendations for next implementation steps (after stakeholder review)

1. **Decide the commercial document source of truth:** if PostgreSQL is mandatory, **introduce `sales_invoices` / `purchase_invoices` (headers + lines)** and migrate `InvoiceForm` persistence from `useStore` without changing its visual layout.
2. **Unify inventory mutation:** every stock change should create **`inventory_movements`**; remove or quarantine **local-only** `inventory` mutations for production users.
3. **Statements:** compute balances from **GL + voucher subledger**, not from ad hoc local transactions.
4. **Remove or hide mock pages** (`Manufacturing`, `Partners`, `ExchangeInvoices`) until backend exists—**navigation-only change**, optional.
5. **Keep UI tokens and layouts**; only connect data loaders and mutations.

---

## 12. Appendix — key file index (quick navigation)

| Concern | Path |
|---------|------|
| Routes | `src/App.tsx` |
| API base / token | `src/lib/api/client.ts` |
| Local ERP state | `src/store/useStore.ts` |
| Fastify composition | `server/src/app.ts` |
| Postgres pool | `server/src/db/pool.ts` |
| Env | `server/src/config/env.ts` |
| Migrations | `server/src/db/migrations/*.sql` |
| Electron + tunnel | `electron/main.ts`, `electron/tunnel/deliveryVpsTunnel.ts` |
| Voucher → GL | `server/src/services/voucherCashboxService.ts`, `glPostingService.ts` |
| Finance API | `server/src/routes/financeRoutes.ts` |
| Reports API | `server/src/routes/reportRoutes.ts` |

---

**End of report.** Awaiting next instruction after review; **no code changes were made** in producing this document.
