# Phase 1 — Smart roll data completion from sales invoice

## 1. Summary of implemented behavior

On **Sales Invoice** only, when a line references a real fabric roll UUID (`internalRollId`), the form can **fill missing physical data** on that roll in PostgreSQL:

- **`length_m`** when it is missing, null, or **≤ 0** (Excel imports often store `0`).
- **`actual_weight_kg`** when it is null, empty, or **≤ 0**.
- **`calculated_weight_kg`** is recomputed when length is set, if `width_cm` and `gsm` allow `calcWeight`.

Updates run **without** inserting `inventory_movements` rows and **without** touching cost, supplier, warehouse, or accounting fields.

Triggers:

- **Enter** on the meters (`length`) or **weight** field: PATCH if needed → success toast → normal focus advance.
- **Blur** on those fields: same PATCH logic, success toast on apply, errors on blur suppressed to avoid noise (network issues surface on save).
- **Save (draft or final)**: safety pass attempts completion for all lines with `toastOnError: true`; on PATCH failure save aborts; then validates that rolls have length when selling quantity &gt; 0; on **final** save, blocks if invoice quantity exceeds roll `length_m`.

## 2. Files changed

| File | Change |
|------|--------|
| `server/src/routes/fabricRollRoutes.ts` | `PATCH /:id/missing-fields` + validation helpers; transaction + row lock; no movement records. |
| `src/lib/api/fabricRollsApi.ts` | `completeMissingRollFields(rollId, payload)`. |
| `src/pages/invoices/InvoiceForm.tsx` | `syncMissingRollPhysicalFromInvoiceLine`, Enter/blur wiring for indices 5–6, save preflight + qty vs stock check for final. |

## 3. Backend endpoint/service

- **Route:** `PATCH /api/inventory/rolls/:id/missing-fields`
- **Auth:** `authenticateRequest` (company from JWT).
- **Body:** `{ "lengthMeters"?: number, "weightKg"?: number }` — at least one required; values must be **positive** (Zod).
- **Success:** `{ ok: true, applied: true, message: "تم تحديث بيانات الرول في المخزون", data: <full roll DTO> }`
- **Errors:** `sendError` with Arabic `message` (404 missing roll, 400 validation / overwrite blocked).

No new service file; logic lives in `fabricRollRoutes.ts` next to existing roll CRUD.

## 4. Allowed fields updated from invoice

- `fabric_rolls.length_m`
- `fabric_rolls.calculated_weight_kg` (derived when length is applied)
- `fabric_rolls.actual_weight_kg`
- `fabric_rolls.updated_at` (automatic)

## 5. Forbidden fields protected

Not read and not written by this endpoint: `unit_cost`, `currency_code`, `supplier_id`, `warehouse_id`, `purchase_invoice_no`, `batch_no`, financial columns, status, barcode, roll identity, GL, movements, customers, payables.

## 6. Overwrite protection

- **Length:** If `length_m` is **already &gt; 0** (epsilon), reject with: `لا يمكن تعديل طول الرول من الفاتورة لأنه موجود مسبقاً في المخزون`.
- **Weight:** If `actual_weight_kg` is **already set and &gt; 0**, reject with: `لا يمكن تعديل وزن الرول من الفاتورة لأنه موجود مسبقاً في المخزون`.

Invoice line values then behave as **sold quantity** only; final save compares quantity to existing roll length.

## 7. Enter navigation integration

- Indices **5** (meters) and **6** (weight): `preventDefault`, `await` sync, then **`advanceInvoiceLineFocus`** (same logic as before for next field, summary, next row, new row).
- **IME:** `isComposing` still gates Enter.
- Other fields unchanged.

## 8. Final save safety

1. After duplicate-line checks, **sales** runs patch pass for all active lines (`both` fields, no success toast).
2. If any PATCH returns **`error`**, save stops (toast already shown).
3. For each line with roll UUID: roll must exist in accumulated list; if quantity &gt; 0, roll length must no longer be “missing” (≤ 0).
4. If `status === 'final'`, quantity must not exceed `length_m` (client guard aligned with server sale logic).

## 9. Test commands run

```text
npm run lint
npm run server:check
npm run test
npm run server:build
```

## 10. Test results

All completed with **exit code 0** (see latest run after fixing Zod flatten typing).

- `fabricInvoiceSummary tests passed`

## 11. Manual test checklist

1. Use/import a roll with `length_m = 0` or null-like and missing `actual_weight_kg`.
2. Sales invoice: select roll, enter meters, **Enter** → toast “تم تحديث بيانات الرول في المخزون”, focus advances.
3. Enter weight if missing → same.
4. **Draft save** → no 400 from incomplete roll after sync.
5. **Final save** (with confirm) → invoice saves; stock movement unchanged conceptually.
6. Roll that **already has length** → enter different meters on line → inventory length **unchanged**; final save **blocked** if quantity &gt; stock length.
7. Duplicate fabric identity behaviour unchanged (name vs roll/barcode).
8. Electron dev stack not modified (same scripts).

## 12. Remaining risks / future recommendations

- **Blur** errors are muted (`toastOnError: false`) so transient failures may only appear on save.
- **Concurrent edits:** two users completing the same roll — last write wins on non-conflicting fields; overwrite rules still apply.
- **calculated vs actual weight:** only `actual_weight_kg` is user-filled from the invoice weight column; calculated weight updates from length/width/GSM when length is patched.
- **No `updated_by_user_id`** on `fabric_rolls` in schema; only `updated_at` is set.
- Optional later: batch endpoint, or silent refetch of roll list after PATCH for large grids.
