# Textile Roll Labeling Phase 1 Discovery + Implementation Alignment

Date: 2026-04-29  
Repository: `c:\Users\Homsi\Desktop\نظام-إدارة-مستودعات-الأقمشة-(erp)`

## Scope and Constraints

- This report is discovery-first (no Phase 2 scanning implementation).
- Current UX and current auto print behavior must be preserved.
- Findings below are based on the current checked-in code in this repo.

---

## 1) Current Inventory Structure

### Main routes and pages

- `src/App.tsx`
  - Inventory routes:
    - `/inventory` -> `Inventory` (`src/pages/Inventory.tsx`)
    - `/inventory/create` -> `CreateItem` (`src/pages/inventory/CreateItem.tsx`)
    - `/inventory/edit/:id` -> `CreateItem`
    - `/inventory/settings` -> `InventorySettings` (`src/pages/inventory/InventorySettings.tsx`)
    - plus related inventory pages (`BulkPricing`, `Warehouses`, `Transfers`, `Depreciation`, `Categories`)

- `src/layouts/DashboardLayout.tsx`
  - Inventory navigation section and submenu entries.

### Components/services/libs involved

- Inventory page logic/UI: `src/pages/Inventory.tsx`
- Item create/edit + label printing: `src/pages/inventory/CreateItem.tsx`
- Inventory settings (thresholds/units): `src/pages/inventory/InventorySettings.tsx`
- Excel import parsing + mapping: `src/lib/excelInventoryImport.ts`
- State/data layer: `src/store/useStore.ts` (Zustand)
- Domain types: `src/types/index.ts`

### APIs

- No dedicated inventory label backend API exists in this repo.
- Existing server middleware in `vite.config.ts` is for Telegram invoice messaging/PDF only (`/api/telegram/invoice`), not inventory label printing.

### Database tables involved

Current implementation is in-memory Zustand state (no SQL table layer in this repo for inventory labels).

- Effective data collections in state:
  - `inventory` (array of `FabricItem`)
  - `warehouses`
  - `categoryTree`

If your production runtime has DB tables outside this repo, they are not represented here in current source.

---

## 2) Current Item Creation Flow

### Where new items are created

- `src/pages/inventory/CreateItem.tsx`
  - `handleSave()` is the save entrypoint.
  - On create: calls `addFabric(payload)` from store.
  - On edit: calls `updateFabric(editingItem.id, payload)`.

### Available fields in UI/payload (current)

From `CreateItem` + `FabricItem`:

- `name`
- `fabricCode`
- `colorName`
- `colorCode`
- `barcode` (manual or generated)
- `lengthType` (`meter|yard`)
- `length`
- `rollWidth` (+ width unit UI helper)
- `weight` (+ computed from multiplier)
- `warehouseId`
- `costPrice`
- `sellingPrice`
- `imageUrl` (optional)
- compatibility fields on save:
  - `yards`, `meters`, `rollNumber`, `type`, `minStockLevel`, `status`

### What happens on save

In `handleSave()`:

1. Validation (`name` and `fabricCode` required).
2. Build payload.
3. Create or update via Zustand action.
4. On create, resets quick-entry fields (length/weight/barcode), shows success message, focus returns to length input.
5. Auto label printing executes only when `autoPrint === true`.

### Where auto print is triggered

- `src/pages/inventory/CreateItem.tsx`
  - `if (autoPrint) { printLabel(); }` inside `handleSave()`.

---

## 3) Current Label Printing Flow

### Files handling label printing

- Primary: `src/pages/inventory/CreateItem.tsx`
  - `printLabel()` builds a temporary hidden iframe and writes HTML label content.

No separate print service, no printer driver abstraction, no queue manager.

### How print jobs are generated

- HTML is written into iframe document (`doc.write(...)`).
- CSS contains:
  - `@page { size: 10cm 8cm; margin: 0; }`
  - `body { width: 10cm; height: 8cm; ... }`
- Print invoked via `iframe.contentWindow?.print()`.
- iframe removed after timeout.

### How printer selection works

- There is no in-app printer selection logic.
- Browser/system print subsystem decides target printer.

### Silent print behavior (actual current behavior)

- Current flow is browser `window.print()` style via iframe.
- This is **not** Electron silent printing (`webContents.print({ silent: true })`) and not raw device command printing.
- Whether print dialog appears depends on browser/environment policy; code itself does not enforce true silent mode.

### Printing technology type

- HTML/CSS browser print.
- Not ESC/POS.
- Not raw command/ZPL/EPL/TSPL.
- Not PDF-based label print.
- Not Electron native print API in this repository.

### Label size configuration

- Hardcoded in `CreateItem.printLabel()` CSS:
  - `@page size 10cm x 8cm`
  - body width/height also `10cm` x `8cm`.

---

## 4) Current Batch Printing Flow

### Selected/all inventory label print locations

- No current code path found for:
  - single-item print button from inventory list,
  - print selected items,
  - print all inventory labels,
  - inventory settings batch print actions.

`InventorySettings.tsx` currently manages stock threshold/default unit only.

### Item filtering and batching

- Inventory filtering exists for display/search/reporting in `Inventory.tsx`.
- No label batch job generation logic exists.

### Performance risks (if batch is added on current pattern)

If implemented using same iframe-per-label approach without controls:

- Browser print dialog spam / blocked popups.
- High memory spikes for large batches.
- No retry, no progress, no cancel, no idempotency.
- No chunking/throttling safeguards.

---

## 5) Current Label Data Mapping

### Fields printed now (actual label template)

`CreateItem.printLabel()` currently prints:

- Item name (header)
- Fabric code
- Color name
- Color code
- Length + unit
- Weight (KG)
- Barcode text as `*${barcode}*` + barcode value line

### Barcode/QR/PDF417 support in label output

- Printed label currently renders barcode as plain text with asterisks (font-based visual), not a generated barcode symbology image.
- No QR image rendering in label template.
- No PDF417 generation.

### Fields existing in model but not printed

Available in model/payload but not on current label:

- `warehouseId` (warehouse name resolution not printed)
- `rollWidth`
- `costPrice`, `sellingPrice`
- `imageUrl`
- `qrCode` (generated in store as `QR-${id}`)
- batch fields (`batches`, `batchNumber`, etc. when used)
- `minStockLevel`, `status`

### Textile target fields status (available vs missing)

Requested textile fields vs current status:

- Company/brand name: missing in label template (company data exists elsewhere in settings page, not mapped here)
- Item name: available
- Article code: partially available (`fabricCode`)
- Design number: missing dedicated field
- Color name: available
- Color code: available
- Lot number: missing dedicated field (closest: optional batch structures, not integrated in CreateItem flow)
- Roll number: partially available (currently set as `rollNumber: fabricCode` on save, no separate user entry)
- Meters: available
- Net weight: available (`weight`)
- Quality grade: missing
- Internal barcode or QR: partially available (barcode text present, `qrCode` exists in state but not printed)
- Optional supplier barcode value: not modeled separately (single `barcode` field only)
- Optional notes: missing dedicated field for item label

---

## 6) Gap Analysis for Textile Roll Labels

### What is already good

- 10x8 cm sizing is already explicitly coded.
- Auto print trigger after save exists and is easy for operator workflow.
- Core textile identifiers exist (`name`, `fabricCode`, color fields, length, weight, barcode).
- Backward compatibility fields already present (`meters/yards/rollNumber`).

### What is missing for stable warehouse-grade roll labels

- True printer abstraction/config (device profile, printer target, test print).
- Reliable symbology generation (Code128/QR/PDF417 as real machine-readable graphics).
- Explicit textile roll fields (lot, roll no, grade, supplier barcode, notes).
- Batch/selected/all print flows and safeguards.
- Label preview and print diagnostics.
- Multi-language (Arabic/English) template strategy.

### Must improve before Phase 2 scanning

- Define canonical internal ID strategy per roll and enforce uniqueness.
- Add structured fields for lot/roll/supplier code (not overloaded in `barcode`).
- Move label composition to reusable template module (without changing existing trigger behavior).
- Add printer profile storage and compatibility test path.

### Risks and edge cases

- Current barcode is not guaranteed scanner-readable.
- Browser print pipeline may vary per machine/driver.
- Current roll number behavior (`rollNumber = fabricCode`) can cause duplicates.
- No persisted print logs/audit trail.

---

## 7) Proposed Phase 1 Implementation Plan (Backward-Compatible)

### Plan principle

Keep current `CreateItem` auto-print path working, then progressively route it through a shared label service while preserving existing UX.

### Step plan

1. **Stabilize Data Contract (no UX break)**
   - Extend `FabricItem` with optional textile fields:
     - `articleCode`, `designNumber`, `lotNumber`, `rollNumber` (real separate), `qualityGrade`, `supplierBarcode`, `labelNotes`, `brandName`.
   - Keep existing fields and fallback behavior unchanged.

2. **Extract Label Template Layer**
   - Create a reusable `renderInventoryLabelHtml(item, options)` utility.
   - Preserve exact size `10cm x 8cm`.
   - Keep current `CreateItem` call site, but call utility.

3. **Barcode/QR Strategy**
   - Internal code policy:
     - keep/store one canonical internal code per roll (e.g., Code128-safe string).
   - Render real machine-readable symbols (Code128 + optional QR).
   - Keep current text barcode visible as fallback line.

4. **Printer Compatibility (Xprinter XP-480B + generic)**
   - Add inventory print settings model:
     - label size preset (`10x8` default),
     - print density/margins,
     - barcode scale,
     - preferred printer name (optional).
   - Add test-print screen/button in Inventory Settings.
   - Keep browser print path first; add printer profile compatibility notes for XP-480B media/driver setup.

5. **Silent Print Safety**
   - Do not remove current auto-print toggle.
   - Add guardrails:
     - preflight validation (required fields before print),
     - print error message + retry.
   - If true silent mode is required later, implement Electron-specific path behind capability detection, not replacing browser path.

6. **Batch Printing Safeguards**
   - Add selected/all print from inventory list/settings:
     - chunked jobs (e.g., 20–50 labels/chunk),
     - progress UI,
     - cancel/stop,
     - optional skip invalid labels.
   - Keep single-item flow intact.

7. **Preview/Test Print**
   - Add “Preview Label” and “Test Print” buttons.
   - Preview uses same HTML template to avoid drift.

8. **Arabic/English Support**
   - Template locale option (`ar`, `en`, `dual`) with stable layout constraints.

9. **Future-Ready for Phase 2**
   - Store supplier code/raw payload fields now as optional metadata.
   - Keep internal roll identifier immutable once created.

---

## 8) Phase 2 Preparation Notes (No Implementation Yet)

For Phase 2 scanning readiness, prepare architecture only:

1. **Supplier QR/PDF417 scanning inputs**
   - Define accepted input sources (camera, HID scanner, file).
   - Normalize raw scanned string and preserve original payload.

2. **External label parsing**
   - Parser registry by supplier format/version.
   - Parse confidence + field-level validation.

3. **Auto-fill purchase invoice**
   - Map parsed fields to purchase line schema.
   - Require operator confirmation before commit.

4. **Create missing item/roll/lot**
   - Deterministic upsert rules:
     - match by supplier code + lot + roll when available,
     - otherwise controlled create flow.

5. **Post-invoice internal label generation**
   - After purchase invoice save, generate internal roll labels from canonical internal fields.
   - Keep supplier code as reference metadata (do not replace internal ID).

---

## File-Specific Evidence Index

- Routing/inventory module:
  - `src/App.tsx`
  - `src/layouts/DashboardLayout.tsx`
- Item creation + auto print + label size:
  - `src/pages/inventory/CreateItem.tsx`
- Inventory settings:
  - `src/pages/inventory/InventorySettings.tsx`
- Inventory UI and data display/search:
  - `src/pages/Inventory.tsx`
- Data model:
  - `src/types/index.ts`
- State actions / generated IDs / QR code generation:
  - `src/store/useStore.ts`
- Excel import -> fabric item mapping:
  - `src/lib/excelInventoryImport.ts`
- Non-inventory print middleware (Telegram invoice PDF only):
  - `vite.config.ts`

