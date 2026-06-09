# Phase 1 — Duplicate fabric identity fix (invoice lines)

## 1. Summary of fix

Invoice duplicate detection no longer treats **material/fabric name alone** as identity. Stock auto-fill from the first-column field only runs when the typed or datalist-selected value matches a **strict inventory key** (barcode, roll number, internal roll id, QR code token, or server roll UUID)—not item name, design code, or color code by themselves.

On apply and on save, duplicates are detected using:

- **Same `fabricRollId` / roll UUID** (`internalRollId` when it is a UUID), or  
- **Same barcode** (line barcodes vs stock barcode), or  
- **Composite key** (material + design + color fields + roll + warehouse + price) when the line has meaningful identity but no UUID/barcode bucket, or  
- **Per-line unique bucket** when only a bare material name (and no other identity fields) is present—so multiple “name-only” lines are never falsely merged.

**Non-blocking** warning toasts on duplicate roll/barcode when applying stock are preserved; save still **blocks** only when two lines resolve to the **same save duplicate key** (true duplicate identity).

## 2. Files changed

| File | Change |
|------|--------|
| `src/lib/invoiceLineDuplicateIdentity.ts` | **New** — `normalizeInvoiceIdentityToken`, `lineHasMeaningfulFabricIdentity`, `buildInvoiceSaveDuplicateKey`, `incomingStockConflictsWithLine`, `INVOICE_LINE_UUID_RE`. |
| `src/pages/invoices/InvoiceForm.tsx` | Replaced broad `findStockMatch` with `findStockMatchStrictIdentity`; unified `applyStockToLine` duplicate check via `incomingStockConflictsWithLine` (sales and purchases); save uses `buildInvoiceSaveDuplicateKey` for all invoice types; datalist `value` prefers barcode / roll / id before display name; Arabic toast copy updated. |

## 3. Root cause of wrong duplicate detection

`findStockMatch` treated **item name** and other descriptive fields (e.g. `internal_code`, `color_code`) as exact-match keys. Typing the same display name as an existing roll (e.g. “كتان”) often resolved to the **same** `FabricRollDto` row, so `applyStockToLine` assigned the **same** `internalRollId` (UUID) to another line. The duplicate guard then correctly flagged a UUID collision—but for the **wrong** reason (name-driven auto-fill), blocking legitimate lines that only shared a human-readable name.

## 4. New duplicate identity rule

| Situation | Rule |
|-----------|------|
| Line has UUID `internalRollId` | Duplicate iff another line has the same UUID (price ignored—same physical roll). |
| Line has supplier / raw barcode | Duplicate iff same normalized barcode on another line. |
| No UUID/barcode but other identity filled | Duplicate iff **full composite** matches: normalized material name, design code, color code, color name, roll number, warehouse, and unit price. |
| Only material name (no design/color/roll/barcode/uuid) | Each line gets a **unique** key (`i:<lineId>`)—no false duplicate. |

**Auto-fill from inventory:** only when the control value equals a strict field on a stock row (barcode, roll ref, id, etc.), never name-only.

## 5. Examples now allowed

- Same material name **كتان**, same design **100**, **أبيض / 2** vs **أسود / 5**, different rolls **R001** vs **R002** → different composite (and different UUID/barcode if loaded from API).
- Same name, different roll/barcode.
- Same name and color, different rolls (unless UUID/barcode collision).
- Multiple lines with only the same text name and no other identity fields.

## 6. Examples still warned / blocked

**While editing (non-blocking toast, stock not applied again):**

- Applying a stock row whose **UUID** already exists on another line.
- Applying a stock row whose **barcode** already matches another line’s barcode fields.

**On save (toast + return, no POST):**

- Two lines with the same save duplicate key per the table above (e.g. duplicate UUID, duplicate barcode, or identical composite when no UUID/barcode bucket applies).

## 7. Test commands run

```text
npm run lint
npm run server:check
npm run test
npm run server:build
```

## 8. Test results

| Command | Result |
|---------|--------|
| `npm run lint` | Pass (exit 0) |
| `npm run server:check` | Pass (exit 0) |
| `npm run test` | Pass — `fabricInvoiceSummary tests passed` |
| `npm run server:build` | Pass (exit 0); migrations copied to `server-dist/db/migrations` |

## 9. Manual test checklist

1. Open **sales** invoice form.  
2. **Line 1:** material كتان, design 100, color أبيض / code 2, roll R001, 50 m, price 2.00 (manual or from stock if available).  
3. **Line 2:** same material كتان, design 100, color أسود / code 5, roll R002, 30 m, price 2.20.  
   - **Expected:** allowed; **no** duplicate warning from name alone.  
4. Second line: same name, **different** roll/barcode from line 1.  
   - **Expected:** allowed.  
5. Second line: **same** roll UUID or **same** barcode as an existing line, then try save.  
   - **Expected:** duplicate handling per rules; edit-time toast non-blocking; save blocked if two lines share the same save key.  
6. **Enter** through line fields and add row.  
   - **Expected:** navigation unchanged.  
7. Save **draft** and **final** with valid lines.  
   - **Expected:** success toasts; persistence unchanged aside from stricter duplicate validation.

## 10. Remaining risks

- **Datalist selection** now commits the **identity** string (barcode / roll / id) into the first column when that is what fills `value`; visibility of that cell may show codes instead of Arabic names unless the user types freely.  
- **Composite** identity includes **price** for non-UUID/non-barcode lines; two manual lines with the same roll label and color but **different** prices are **not** save-duplicates (acceptable for “soft” roll labels; real API rolls should carry UUID).  
- **Design/color codes** are no longer used to auto-pick stock on blur—users must use barcode/roll/id or pick from datalist by identity—reducing accidental wrong-roll fill.
