# Deep Popup Freeze Root Cause Fix Report

## 1. Exact Root Cause Found

The invoice workflow still had blocking native `alert()` calls for validation and save-precondition messages. In Electron, those native blocking dialogs can leave the renderer visually open but interaction focus/pointer state unreliable after dismissal, which matches the reported symptom: the popup closes, but the app cannot be clicked or typed in until restart.

The app already had a non-blocking toast provider, but it needed hardening:

- no manual close button existed
- no defensive cleanup ran after toast dismissal
- no cleanup restored accidental `pointer-events`, `overflow`, `inert`, or `aria-hidden` state if an older popup path left it behind

The audit also found additional simple message alerts outside invoices, mainly statement/export/import warnings. Those were converted to the same non-blocking toast path.

## 2. Files Audited

- `src/pages/invoices/InvoiceForm.tsx`
- `src/components/NonBlockingToast.tsx`
- `src/layouts/DashboardLayout.tsx`
- `src/components/statements/BatchStatementExportModal.tsx`
- `src/pages/customers/CustomerStatement.tsx`
- `src/pages/suppliers/SupplierStatement.tsx`
- `src/pages/Purchases.tsx`
- `src/pages/purchases/ImportBatches.tsx`
- `src/lib/pdfExport.ts`
- Broad search across `src/components`, `src/pages`, `src/layouts`, and `src/lib` for `Dialog`, `Modal`, `Toast`, `overlay`, `fixed inset-0`, `pointer-events`, `document.body.style`, `inert`, `aria-hidden`, `createPortal`, `setTimeout`, `alert`, and `confirm`.

## 3. Files Changed

- `src/components/NonBlockingToast.tsx`
- `src/pages/invoices/InvoiceForm.tsx`
- `src/components/statements/BatchStatementExportModal.tsx`
- `src/pages/customers/CustomerStatement.tsx`
- `src/pages/suppliers/SupplierStatement.tsx`
- `src/pages/Purchases.tsx`
- `src/pages/purchases/ImportBatches.tsx`
- `src/lib/pdfExport.ts`
- `docs/DEEP_POPUP_FREEZE_ROOT_CAUSE_FIX_REPORT.md`

## 4. Components Using Blocking Messages Incorrectly

These message-only flows used `alert()` and were converted:

- invoice save precondition: missing registered customer/supplier
- invoice save precondition: missing cashbox for a paid confirmed invoice
- batch statement export empty-data and failure messages
- customer statement PDF/Telegram/voucher validation and success/failure messages
- supplier statement PDF/Telegram/payment validation and success/failure messages
- purchase Excel import/read/empty/confirmation warnings
- import batch cancel failure message
- PDF export helper error alerts

Legitimate form modals remain as modals. `confirm()` remains only where a real user decision is needed, such as canceling/deleting/committing partial data.

## 5. New / Standardized Toast Behavior

`NonBlockingToast` is now the standard non-blocking message path:

- toast layer is rendered through a body portal
- full toast layer uses `pointer-events: none`
- only the small toast card uses `pointer-events: auto`
- toast has manual close button
- toast auto-dismisses
- no overlay is rendered
- no focus trap is used
- no body scroll lock is applied
- no app root inerting is applied

## 6. Lingering Overlay / Focus / Body Lock Fix

Added defensive cleanup in `NonBlockingToast`:

- restores `document.body.style.pointerEvents` if it is stuck as `none`
- restores `document.documentElement.style.pointerEvents` if stuck as `none`
- restores `body/html overflow` if stuck as `hidden`
- removes accidental `inert` from app roots
- removes accidental `aria-hidden="true"` from app roots
- cleanup runs when a toast is shown, after auto-dismiss, when all toasts close, and on provider unmount

No arbitrary app overlays are removed globally. The cleanup is intentionally limited to interaction locks that should never be owned by simple toast messages.

## 7. Invoice Notifications Converted

In `InvoiceForm`, simple invoice messages now use `showToast()`:

- duplicate invoice line warnings
- missing roll data warnings
- roll physical-data update success/failure
- quantity greater than stock warning
- missing registered customer/supplier warning
- missing cashbox warning
- invoice save failure
- draft saved success
- final invoice saved success

No invoice message now uses `alert()` or a full-screen modal.

## 8. Test Commands Run

- `npm run lint`
- `npm run server:check`
- `npm run test`
- `npm run server:build`

## 9. Test Results

- `npm run lint`: passed
- `npm run server:check`: passed
- `npm run test`: passed, `fabricInvoiceSummary tests passed`
- `npm run server:build`: passed, migrations copied to `server-dist/db/migrations`

Additional static checks:

- `rg "window\\.alert|alert\\(" src`: no matches after the fix
- `NonBlockingToast` toast layer remains `pointer-events-none`
- no `document.body.style.pointerEvents` mutation remains outside the defensive toast cleanup

## 10. Manual Stress Test Results

Live Electron manual stress testing was not run in this coding pass because the task was handled by code audit and command validation only.

Static/manual-equivalent checks completed:

- invoice message code paths no longer call native `alert()`
- toast DOM has no full-screen blocking overlay
- toast container cannot capture page clicks
- toast close button is limited to the toast card
- defensive cleanup restores stale interaction locks after toast lifecycle

Recommended live verification remains:

1. Open Sales Invoice form.
2. Trigger duplicate/material/roll warnings repeatedly.
3. Save draft and final invoices.
4. Trigger validation errors.
5. Confirm typing, dropdowns, Enter navigation, and save buttons still work after each toast.

## 11. Remaining Risks

- Real form modals still use full-screen overlays by design. They are not used for simple notifications, but a bug inside a form modal could still leave an overlay if a future change introduces broken close state.
- `window.confirm()` still exists for destructive or irreversible choices. This is intentional, but it is still a blocking browser/Electron primitive.
- No browser automation test currently exercises the full invoice form after repeated toast cycles.

## 12. Recommendation To Prevent Future Regressions

- Do not use `alert()` for application messages.
- Do not use modal overlays for save/error/validation status.
- Use `useToast()` for all simple notifications inside `DashboardLayout`.
- Keep destructive confirmations separate and explicit.
- Add a future lint rule or code review check blocking `alert(` in `src`.
- If UI tests are introduced, add a regression test that asserts:
  - no full-screen overlay is rendered for toast messages
  - toast viewport has `pointer-events: none`
  - `document.body.style.pointerEvents !== "none"`
  - app root does not have `inert`
  - Enter navigation still works after repeated toasts
