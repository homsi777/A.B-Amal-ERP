import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { DeliveryLineDraft } from '../../lib/api/deliveryApi';
import { AR_WHOLESALE } from '../../lib/i18n/arTerminology';

type Props = {
  open: boolean;
  lines: DeliveryLineDraft[];
  onClose: () => void;
  onSave: (lines: DeliveryLineDraft[]) => void | Promise<void>;
};

export function TafnidModal({ open, lines, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<DeliveryLineDraft[]>(lines);

  useEffect(() => {
    if (open) setDraft(lines.map((l) => ({ ...l })));
  }, [open, lines]);

  if (!open) return null;

  const updateLength = (index: number, value: string) => {
    const n = value === '' ? undefined : Number(value);
    setDraft((prev) =>
      prev.map((row, i) =>
        i === index ? { ...row, tafnidLength: Number.isFinite(n) ? n : undefined } : row,
      ),
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-3xl rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-heading)]">{AR_WHOLESALE.tafnid}</h2>
            <p className="text-sm text-[var(--text-muted)]">تحديد {AR_WHOLESALE.rollLength} لكل بند مباع</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-[var(--surface-hover)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-auto px-5 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-default)] text-[var(--text-muted)]">
                <th className="py-2 text-right font-medium">#</th>
                <th className="py-2 text-right font-medium">البند</th>
                <th className="py-2 text-right font-medium">{AR_WHOLESALE.rollsCount}</th>
                <th className="py-2 text-right font-medium">{AR_WHOLESALE.rollLength}</th>
              </tr>
            </thead>
            <tbody>
              {draft.map((line, i) => (
                <tr key={line.lineIndex} className="border-b border-[var(--border-subtle)]">
                  <td className="py-3 text-[var(--text-muted)]">{line.lineIndex}</td>
                  <td className="py-3 font-medium text-[var(--text-heading)]">{line.description}</td>
                  <td className="py-3">
                    {line.rollQty} {AR_WHOLESALE.rollUnit}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-28 rounded-lg border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-1.5"
                        value={line.tafnidLength ?? ''}
                        onChange={(e) => updateLength(i, e.target.value)}
                        placeholder="0"
                      />
                      <span className="text-[var(--text-muted)]">{line.unit}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={() => void onSave(draft)}
            className="rounded-lg bg-[var(--ui-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--ui-accent-hover)]"
          >
            حفظ التفنيد
          </button>
        </div>
      </div>
    </div>
  );
}
