import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { DeliveryLineDraft } from '../../lib/api/deliveryApi';
import { AR_WHOLESALE } from '../../lib/i18n/arTerminology';

type Props = {
  open: boolean;
  lines: DeliveryLineDraft[];
  onClose: () => void;
  onSave: (lines: DeliveryLineDraft[]) => void | Promise<void>;
};

type LineDraft = {
  lineNo: number;
  description: string;
  rollQty: number;
  unit: string;
  tafnidUnit: 'meter' | 'yard';
  lengths: (number | undefined)[];
  visibleCount: number;
};

function rollsNeeded(unit: string, rollQty: number): number {
  if (unit === 'توب' || unit === 'roll') return Math.max(1, Math.round(rollQty));
  return 1;
}

function buildLineDrafts(source: DeliveryLineDraft[]): LineDraft[] {
  return source.map((line) => {
    const needed = rollsNeeded(line.unit, line.rollQty);
    const lengths: (number | undefined)[] = Array.from({ length: needed }, (_, i) => {
      const seq = i + 1;
      const saved = line.rollTafnid?.find((r) => r.rollSeq === seq)?.length;
      if (saved != null && saved > 0) return saved;
      if (seq === 1 && line.tafnidLength != null && line.tafnidLength > 0) return line.tafnidLength;
      return undefined;
    });
    const filled = lengths.filter((v) => v != null && v > 0).length;
    const visibleCount = Math.min(needed, Math.max(1, filled + (filled < needed ? 1 : 0)));
    return {
      lineNo: line.lineNo,
      description: line.description,
      rollQty: line.rollQty,
      unit: line.unit,
      tafnidUnit: line.tafnidUnit ?? 'meter',
      lengths,
      visibleCount,
    };
  });
}

function toDeliveryLines(drafts: LineDraft[], source: DeliveryLineDraft[]): DeliveryLineDraft[] {
  return source.map((line) => {
    const draft = drafts.find((d) => d.lineNo === line.lineNo);
    if (!draft) return line;
    const needed = rollsNeeded(draft.unit, draft.rollQty);
    const rollTafnid = Array.from({ length: needed }, (_, i) => ({
      rollSeq: i + 1,
      length: draft.lengths[i],
    }));
    return { ...line, rollTafnid, tafnidLength: draft.lengths[0], tafnidUnit: draft.tafnidUnit };
  });
}

function isLineComplete(draft: LineDraft): boolean {
  const needed = rollsNeeded(draft.unit, draft.rollQty);
  for (let i = 0; i < needed; i++) {
    const v = draft.lengths[i];
    if (v == null || !Number.isFinite(v) || v <= 0) return false;
  }
  return true;
}

const inputRefKey = (lineNo: number, rollIndex: number) => `${lineNo}-${rollIndex}`;

export function TafnidModal({ open, lines, onClose, onSave }: Props) {
  const [drafts, setDrafts] = useState<LineDraft[]>([]);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (open) {
      const next = buildLineDrafts(lines);
      setDrafts(next);
      window.setTimeout(() => {
        const first = next.find((d) => !isLineComplete(d)) ?? next[0];
        if (!first) return;
        const idx = first.lengths.findIndex((v) => v == null || v <= 0);
        const focusIdx = idx >= 0 ? idx : 0;
        inputRefs.current[inputRefKey(first.lineNo, focusIdx)]?.focus();
      }, 50);
    }
  }, [open, lines]);

  const allComplete = useMemo(() => drafts.every(isLineComplete), [drafts]);

  if (!open) return null;

  const updateLength = (lineNo: number, rollIndex: number, value: string) => {
    const n = value === '' ? undefined : Number(value);
    setDrafts((prev) =>
      prev.map((row) => {
        if (row.lineNo !== lineNo) return row;
        const next = [...row.lengths];
        next[rollIndex] = Number.isFinite(n) && (n as number) > 0 ? (n as number) : undefined;
        return { ...row, lengths: next };
      }),
    );
  };

  const revealNext = (lineNo: number, rollIndex: number) => {
    const needed = rollsNeeded(
      drafts.find((d) => d.lineNo === lineNo)?.unit ?? 'توب',
      drafts.find((d) => d.lineNo === lineNo)?.rollQty ?? 1,
    );
    if (rollIndex >= needed - 1) return;
    setDrafts((prev) =>
      prev.map((row) => {
        if (row.lineNo !== lineNo) return row;
        return { ...row, visibleCount: Math.min(needed, Math.max(row.visibleCount, rollIndex + 2)) };
      }),
    );
    window.setTimeout(() => {
      inputRefs.current[inputRefKey(lineNo, rollIndex + 1)]?.focus();
    }, 0);
  };

  const onRollKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    lineNo: number,
    rollIndex: number,
    value: string,
  ) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const n = value === '' ? NaN : Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    revealNext(lineNo, rollIndex);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-heading)]">{AR_WHOLESALE.tafnid}</h2>
            <p className="text-sm text-[var(--text-muted)]">
              أدخل طول كل توب — اضغط Enter للانتقال للتوب التالي
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-[var(--surface-hover)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="space-y-6">
            {drafts.map((line) => {
              const needed = rollsNeeded(line.unit, line.rollQty);
              const filled = line.lengths.filter((v) => v != null && v > 0).length;
              return (
                <section
                  key={line.lineNo}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card-muted)] p-4"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-[var(--text-heading)]">{line.description}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        بند #{line.lineNo} — {needed} {AR_WHOLESALE.rollUnit}
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--ui-accent-soft-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--ui-nav-active-text)]">
                      {filled}/{needed}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {Array.from({ length: line.visibleCount }, (_, rollIndex) => (
                      <label key={rollIndex} className="block text-xs">
                        <span className="mb-1 block text-[var(--text-muted)]">
                          {AR_WHOLESALE.rollUnit} {rollIndex + 1}
                        </span>
                        <input
                          ref={(el) => {
                            inputRefs.current[inputRefKey(line.lineNo, rollIndex)] = el;
                          }}
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-input)] px-2.5 py-2 text-sm"
                          value={line.lengths[rollIndex] ?? ''}
                          onChange={(e) => updateLength(line.lineNo, rollIndex, e.target.value)}
                          onKeyDown={(e) =>
                            onRollKeyDown(e, line.lineNo, rollIndex, e.currentTarget.value)
                          }
                          placeholder=""
                          aria-label={`طول ${AR_WHOLESALE.rollUnit} ${rollIndex + 1}`}
                        />
                      </label>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-5 py-4">
          <p className="text-xs text-[var(--text-muted)]">
            {allComplete ? 'اكتمل التفنيد لكل الأتواب' : 'أكمل طول كل توب ثم احفظ'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={!allComplete}
              onClick={() => void onSave(toDeliveryLines(drafts, lines))}
              className="rounded-lg bg-[var(--ui-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--ui-accent-hover)] disabled:opacity-50"
            >
              حفظ التفنيد
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
