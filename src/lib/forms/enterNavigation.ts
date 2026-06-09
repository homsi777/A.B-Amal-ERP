import type React from 'react';

const focusableSelector = [
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
].join(',');

export function focusNextFormControl(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Enter') return false;
  if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;
  if (event.currentTarget instanceof HTMLTextAreaElement) return false;

  const form = event.currentTarget.closest('form') ?? event.currentTarget.closest('[data-enter-scope]');
  if (!form) return false;

  const controls = Array.from(form.querySelectorAll(focusableSelector)) as HTMLElement[];
  const visibleControls = controls
    .filter((el) => el.offsetParent !== null && el.getAttribute('tabindex') !== '-1');
  const currentIndex = visibleControls.indexOf(event.currentTarget);
  if (currentIndex < 0) return false;

  event.preventDefault();
  const next = visibleControls[currentIndex + 1];
  if (next) {
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
    return true;
  }

  const submit = visibleControls.find(
    (el) => el instanceof HTMLButtonElement && (el.type === 'submit' || el.dataset.enterSubmit === 'true'),
  );
  submit?.focus();
  return Boolean(submit);
}
