export type DeliveryCountdownTone = 'none' | 'overdue' | 'urgent' | 'soon' | 'ok' | 'done';

export type DeliveryCountdown = {
  days: number;
  label: string;
  tone: DeliveryCountdownTone;
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** عداد الأيام المتبقية لموعد التوريد */
export function orderDeliveryCountdown(
  expectedDate: string | undefined,
  status?: string,
): DeliveryCountdown | null {
  if (!expectedDate?.trim()) return null;
  if (status === 'completed' || status === 'cancelled') {
    return { days: 0, label: status === 'completed' ? 'مُسلّمة' : 'ملغاة', tone: 'done' };
  }

  const expected = startOfDay(new Date(`${expectedDate.slice(0, 10)}T12:00:00`));
  if (Number.isNaN(expected.getTime())) return null;

  const today = startOfDay(new Date());
  const days = Math.round((expected.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) {
    return { days, label: `${Math.abs(days)} يوم متأخر`, tone: 'overdue' };
  }
  if (days === 0) return { days, label: 'اليوم', tone: 'urgent' };
  if (days <= 3) return { days, label: `${days} يوم`, tone: 'urgent' };
  if (days <= 7) return { days, label: `${days} يوم`, tone: 'soon' };
  return { days, label: `${days} يوم`, tone: 'ok' };
}

export function deliveryCountdownClass(tone: DeliveryCountdownTone): string {
  switch (tone) {
    case 'overdue':
      return 'bg-rose-100 text-rose-800 border-rose-200';
    case 'urgent':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'soon':
      return 'bg-amber-100 text-amber-900 border-amber-200';
    case 'ok':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'done':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-slate-100 text-slate-500 border-slate-200';
  }
}
