# Phase 1 — Invoice notifications & duplicate-warning UX fix

## 1. Summary

- **Save feedback:** After a successful POST to create a sales/purchase invoice (draft or final), a **non-blocking toast** shows the appropriate Arabic success message, then navigation to the list runs as before. On server/network failure, a **non-blocking error toast** shows the required Arabic copy (no `window.alert`).
- **Duplicate stock line:** The warning when the same inventory roll is applied twice no longer uses the browser **`alert()`** dialog. It now uses the same **toast** system (warning), so there is **no modal, no overlay, no focus trap**, and the user can keep typing and using Enter immediately.

A shared **`ToastProvider`** was added at the dashboard layout level so toasts remain visible briefly after route changes (e.g. when leaving the invoice form for the sales list).

## 2. Files changed

| File | Change |
|------|--------|
| `src/components/NonBlockingToast.tsx` | **New:** `ToastProvider`, `useToast`, fixed top-centre stack, `pointer-events-none`, auto-dismiss (~4.2s). |
| `src/layouts/DashboardLayout.tsx` | Wraps `<Outlet />` with `ToastProvider`. |
| `src/pages/invoices/InvoiceForm.tsx` | `useToast`; duplicate-roll paths use `showToast` + `queueMicrotask`; save success/error toasts; duplicate-roll **pre-save** check uses toast instead of `alert`. |

## 3. Root cause — missing save notification

There was **no UI feedback** after a successful `postSalesInvoice` / `postPurchaseInvoice`: the code went straight to Telegram (optional) and **`navigate(...)`**, so the user saw no confirmation.

## 4. Root cause — duplicate warning blocking the form

Duplicate detection in **`applyStockToLine`** used **`window.alert(...)`**. Native alert is **synchronous and modal**: it steals focus and, in **Electron/Chromium**, can leave odd focus/pointer state after dismiss. That matches “popup disappears but cannot continue working.”

There was **no** `Dialog` / `fixed inset-0` overlay in `InvoiceForm`; the blocker was the **blocking alert**.

## 5. Shared helper

**`src/components/NonBlockingToast.tsx`** — single place for success / warning / error toasts:

- No full-screen layer (`pointer-events-none` on the stack container and each toast).
- Auto-dismiss; no OK button; no Radix/modal.

`InvoiceForm` uses **`queueMicrotask`** before `showToast` when emitting from inside a **`setItems` functional updater**, so toast state updates are not nested inside the updater synchronously.

## 6. Test commands run

```text
npm run lint
npm run server:check
npm run test
npm run server:build
```

## 7. Test results

All commands completed with **exit code 0**:

- `npm run lint` — passed  
- `npm run server:check` — passed  
- `npm run test` — `fabricInvoiceSummary` tests passed  
- `npm run server:build` — passed (migrations copy ran)

## 8. Manual test checklist

1. Open **InvoiceForm** (sales or purchases).
2. **Save draft** → toast: `تم حفظ المسودة بنجاح`; navigate to list; no overlay.
3. **Save final** → toast: `تم حفظ الفاتورة بنجاح`; same as above.
4. Pick a **stock roll** on a line, then try to **attach the same roll** on another line → warning toast; **no** alert; focus stays usable; Enter still moves between fields.
5. After warning dismisses (auto), confirm **no** invisible full-screen element and **no** `body` `pointer-events` / `overflow` changes from this feature.
6. Force a **save error** (e.g. stop API) → toast: `تعذر حفظ الفاتورة، يرجى المحاولة مرة أخرى`.
7. Arabic IME: duplicate warning should not require an extra click on OK.

## 9. Remaining / out of scope

- **تحديث الفاتورة:** There is no **edit-existing-invoice** route in the current app (only `.../new`). If a PATCH flow is added later, show `تم تحديث الفاتورة بنجاح` on that path.
- Other **`window.alert` / `alert`** calls in `InvoiceForm` (e.g. missing party, cashbox, quick cash) were **left unchanged** to stay within “save notifications + duplicate warning” scope; they can be moved to the same toast pattern later.
- Detailed API error text is no longer shown in the UI (only the generic Arabic error line per spec); check **DevTools / network** for debugging.
