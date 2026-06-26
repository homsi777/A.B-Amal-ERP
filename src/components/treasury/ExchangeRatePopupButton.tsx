import React, { useState } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import type { ExchangeRateDto } from '../../lib/api/exchangeRatesApi';
import { ExchangeRateQuickPanel } from './ExchangeRateQuickPanel';

export interface ExchangeRatePopupButtonProps {
  onRatesChange?: (rates: ExchangeRateDto[]) => void;
  className?: string;
  buttonClassName?: string;
}

/** زر «الصرف» يفتح بطاقة منبثقة لإدارة أسعار الصرف مقابل الدولار. */
export function ExchangeRatePopupButton({
  onRatesChange,
  className = '',
  buttonClassName = '',
}: ExchangeRatePopupButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          buttonClassName ||
          'inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition shadow-sm font-medium text-sm'
        }
      >
        <ArrowLeftRight className="w-4 h-4 text-indigo-600" />
        الصرف
      </button>

      {open && (
        <div
          className={`fixed inset-0 z-[220] flex items-center justify-center bg-black/40 p-4 ${className}`}
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exchange-rates-modal-title"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[min(90dvh,640px)] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-gradient-to-l from-indigo-50 to-white shrink-0">
              <div>
                <h3 id="exchange-rates-modal-title" className="font-bold text-lg text-slate-900">
                  أسعار الصرف مقابل الدولار
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">عدد وحدات العملة مقابل 1 دولار — مثال: 15000 ل.س = 1$</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="إغلاق"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto min-h-0 flex-1 p-1">
              <ExchangeRateQuickPanel
                embedded
                onRatesChange={onRatesChange}
              />
            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
