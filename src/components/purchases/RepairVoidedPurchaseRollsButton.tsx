import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { repairStalePurchaseInvoiceRolls } from '../../lib/api/purchaseInvoicesApi';
import { ApiRequestError } from '../../lib/api/client';
import { useToast } from '../NonBlockingToast';

type Props = {
  onRepaired?: () => void;
  className?: string;
};

export const RepairVoidedPurchaseRollsButton = ({ onRepaired, className = '' }: Props) => {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (
      !window.confirm(
        'إصلاح مخزون فواتير الشراء الملغاة/المحذوفة؟\n\nسيتم إلغاء تفعيل الأثواب المتبقية في المخزون المرتبطة بتلك الفواتير (مثل FS0000002 و FS0000003).',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await repairStalePurchaseInvoiceRolls({ invoiceNos: ['FS0000002', 'FS0000003'] });
      const { deactivated, barcodes, skippedSold } = res.data;
      if (deactivated === 0) {
        showToast({
          type: 'success',
          message: skippedSold
            ? 'لا توجد أثواب للإصلاح (قد تكون مباعة أو مُعالجة مسبقاً)'
            : 'لا توجد أثواب يتيمة — المخزون نظيف',
        });
      } else {
        const sample = barcodes.slice(0, 5).join('، ');
        const more = barcodes.length > 5 ? ` … (+${barcodes.length - 5})` : '';
        showToast({
          type: 'success',
          message: `تم إصلاح ${deactivated} ثوب${skippedSold ? ` (تُرك ${skippedSold} مباع)` : ''}: ${sample}${more}`,
        });
        onRepaired?.();
      }
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر إصلاح المخزون',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      className={`bg-amber-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-amber-600 transition font-bold text-sm shadow-sm disabled:opacity-60 ${className}`}
      title="إزالة أثواب فواتير شراء ملغاة ما زالت تظهر في المخزون"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{busy ? 'جاري إصلاح المخزون…' : 'إصلاح مخزون فواتير ملغاة'}</span>
    </button>
  );
};
