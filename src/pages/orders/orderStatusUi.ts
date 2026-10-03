import type { CustomerOrderStatus } from '../../types';
import i18n from '../../i18n/config';

const t = (key: string) => i18n.t(key, { ns: 'terminology' });

export const ORDER_STATUS_LABELS: Record<CustomerOrderStatus, string> = {
  get draft() { return t('orderStatus.draft'); },
  get pending_supply() { return t('orderStatus.pendingSupply'); },
  get partial_ready() { return t('orderStatus.partialReady'); },
  get ready_pickup() { return t('orderStatus.readyPickup'); },
  get completed() { return t('orderStatus.completed'); },
  get cancelled() { return t('orderStatus.cancelled'); },
};

export const ORDER_STATUS_FLOW: CustomerOrderStatus[] = [
  'draft',
  'pending_supply',
  'partial_ready',
  'ready_pickup',
  'completed',
  'cancelled',
];

export function statusBadgeClass(status: CustomerOrderStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-slate-100 text-slate-700 border border-slate-200';
    case 'pending_supply':
      return 'bg-amber-50 text-amber-800 border border-amber-200';
    case 'partial_ready':
      return 'bg-sky-50 text-sky-800 border border-sky-200';
    case 'ready_pickup':
      return 'bg-violet-50 text-violet-800 border border-violet-200';
    case 'completed':
      return 'bg-emerald-50 text-emerald-800 border border-emerald-200';
    case 'cancelled':
      return 'bg-rose-50 text-rose-800 border border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}
