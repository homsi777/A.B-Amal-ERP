import React from 'react';
import { Sparkles } from 'lucide-react';

type Props = {
  open: boolean;
  onClick: () => void;
};

export function ClotexAssistantButton({ open, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label="فتح مساعد CLOTEX"
      title="CLOTEX — مساعد الأقمشة"
      className={`relative shrink-0 rounded-xl border p-2 md:p-2.5 transition-all duration-200
        ${open
          ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft-bg)] text-[var(--ui-accent)] shadow-sm'
          : 'border-[var(--border-default)] bg-[var(--surface-header)] text-[var(--text-muted)] hover:border-[var(--ui-accent-border)] hover:bg-[var(--ui-accent-soft-bg)] hover:text-[var(--ui-accent)]'
        }`}
    >
      <Sparkles className="h-5 w-5" strokeWidth={2} />
      <span className="absolute bottom-1 start-1 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-[var(--surface-header)]" aria-hidden />
    </button>
  );
}
