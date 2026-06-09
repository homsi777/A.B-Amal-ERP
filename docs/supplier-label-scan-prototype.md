# Supplier Label Scan Prototype (Phase 2 - Controlled)

Date: 2026-04-29

## Known Supplier QR Format

Controlled prototype format (field-order based, not label-language based):

`ARTICLE|DESIGN|COLOR|COLOR_CODE|LOT|METERS|WEIGHT`

Expected field mapping:
1. `articleCode` / `itemName`
2. `designNumber`
3. `colorName`
4. `colorCode`
5. `lotNumber`
6. `meters`
7. `netWeight`

## Barcode Role

- Numeric scan payload is treated as `supplierBarcode` / supplier roll serial.
- Prototype behavior: if barcode is scanned after QR, it is attached to the latest scanned line.
- Supplier barcode is stored separately and is **not** used as internal roll ID.

## Example Visible Label Data

- Article Code: `VISKON KETEN`
- Design Nr: `ANKA-01`
- Colour Nr: `KASAR`
- Colour Cd: `11`
- Lot Nr: `LOT 1`
- Meters: `125,00`
- Net Weight: `35,20`
- Quality: `1`
- Barcode: `30367550`

## Example Raw Scan Payloads

- QR (raw example): `{÷ٍ،×آ ،ُلإُآ|ِآ،ِ-01|،ٌٍِِ|11|/×لإ 1|125ز00|35ز20`
- Barcode: `30367550`

## Parser Implementation

File: `src/lib/supplierLabelParser.ts`

Capabilities:
- Accept raw scan text.
- Split by `|`.
- Decimal normalization:
  - `125ز00` -> `125.00`
  - `35ز20` -> `35.20`
  - `125,00` -> `125.00`
- Preserve raw payload fields (`rawQrPayload`, `rawBarcodePayload`).
- Return structured object containing:
  - `articleCode`, `itemName`, `designNumber`, `colorName`, `colorCode`, `lotNumber`, `meters`, `netWeight`
  - `supplierBarcode`, `qualityGrade`
  - `rawQrPayload`, `rawBarcodePayload`
  - `warnings[]`

Prototype fallback:
- If payload appears encoding-corrupted, controlled fallback values are applied from known label data.
- This is explicitly temporary for prototype validation.

## Purchase Invoice Auto-Fill Workflow

File: `src/pages/invoices/InvoiceForm.tsx` (purchase mode only)

Added behavior:
1. Input area: `Scan supplier QR / Barcode`
2. On Enter:
   - Contains `|` -> QR parse
   - Numeric-only -> barcode attach to latest scanned line
3. On QR success:
   - Adds one invoice line auto-filled with parsed data:
     - Item/article, design, color, color code, lot, meters, net weight
     - quality (default `1` if needed)
     - generated internal roll ID (`TXR-2026-xxxxxx`)
4. On barcode success:
   - attaches `supplierBarcode` to same latest scanned line

## Inventory Item/Roll Create-or-Stage Behavior

Prototype staging and save logic in `InvoiceForm.tsx`:
- After QR parse: roll is staged with generated internal roll ID.
- On purchase invoice save:
  - checks for existing inventory by internal roll ID or close material+color+lot match
  - if missing: creates inventory item/roll via existing store action `addFabric`
  - if found: keeps existing and reports status

Stored roll fields include:
- `name`, `fabricCode`, `designNumber`, `colorName`, `colorCode`, `lotNumber`
- `length` (meters), `weight`
- `supplierBarcode`
- `qualityGrade`
- immutable `internalRollId` (separate from supplier barcode)

## Operator Confirmation Card

Purchase form now displays a confirmation card with:
- Parsed fields
- Raw payload(s)
- Status lines (line added, roll staged/created/found, barcode attached)
- Parser warnings

## Test Print Option

Prototype includes `Test Print Internal Label` button after staging.
- Uses existing browser print style (iframe HTML print)
- Does not force auto-print
- Intended only for quick internal-label validation

## Prototype Limits

1. This is a controlled parser for one known supplier format only.
2. Encoding corruption fallback is hard-mapped for this known label set.
3. Turkish/Windows-1254 decoding hardening is not implemented yet.
4. Production-grade parser registry, confidence scoring, and supplier profiles are pending.

## Production Hardening Remaining

- Proper encoding decode strategies (including Turkish payloads).
- Supplier-specific parser registry/versioning.
- Better duplicate detection keys and conflict UX.
- Formal schema evolution for roll-level tracking.
- End-to-end validation tests for scan -> invoice -> inventory -> label print.
