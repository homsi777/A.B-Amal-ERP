import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { PackageCheck, Search, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { listDeliveryQueue, type DeliveryQueueItem } from '../../lib/api/deliveryApi';
import { useAuth } from '../../contexts/AuthContext';
import { arDeliveryStatus } from '../../lib/i18n/arTerminology';

export function DeliveryQueue() {
  const { t } = useTranslation('delivery');
  const { canAccessPath } = useAuth();
  const canCreateSalesInvoice = canAccessPath('/invoices/sales/new');
  const [rows, setRows] = useState<DeliveryQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listDeliveryQueue(search);
      setRows(data.filter((r) => r.deliveryStatus !== 'FULFILLED'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل طلبات التسليم');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 300);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[var(--ui-accent)]">
            <Truck className="h-6 w-6" />
            <h1 className="text-2xl font-bold text-[var(--text-heading)]">{t('title')}</h1>
          </div>
          <p className="max-w-2xl text-sm text-[var(--text-muted)]">{t('subtitle')}</p>
        </div>
        <span className="rounded-full border border-[var(--ui-accent-border)] bg-[var(--ui-accent-soft-bg)] px-3 py-1 text-xs text-[var(--ui-nav-active-text)]">
          {t('phaseNote')}
        </span>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-input)] py-2.5 pr-10 pl-4 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-sm">
        {loading ? (
          <p className="p-8 text-center text-[var(--text-muted)]">جاري التحميل…</p>
        ) : error ? (
          <p className="p-8 text-center text-red-600">{error}</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <PackageCheck className="h-12 w-12 text-[var(--text-muted)]" />
            <p className="font-medium text-[var(--text-heading)]">{t('empty')}</p>
            <p className="text-sm text-[var(--text-muted)]">{t('emptyHint')}</p>
            {canCreateSalesInvoice ? (
              <Link
                to="/invoices/sales/new"
                className="mt-2 rounded-lg bg-[var(--ui-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--ui-accent-hover)]"
              >
                إنشاء فاتورة بيع
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-[var(--border-default)] bg-[var(--surface-card-muted)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">{t('colInvoice')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('colDate')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('colCustomer')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('colRolls')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('colAmount')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('colStatus')}</th>
                  <th className="px-4 py-3 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-hover)]">
                    <td className="px-4 py-3 font-medium text-[var(--text-heading)]">{row.invoiceNo}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {row.invoiceDate
                        ? format(new Date(`${row.invoiceDate}T12:00:00`), 'dd MMM yyyy', { locale: ar })
                        : '—'}
                    </td>
                    <td className="px-4 py-3">{row.customerLabel}</td>
                    <td className="px-4 py-3">{row.rollCount || '—'}</td>
                    <td className="px-4 py-3">
                      {row.totalAmount.toLocaleString('ar-SY', { minimumFractionDigits: 2 })} {row.currencyCode}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          row.deliveryStatus === 'TAFNID_SAVED'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-[var(--ui-accent-soft-bg)] text-[var(--ui-nav-active-text)]'
                        }`}
                      >
                        {arDeliveryStatus(row.deliveryStatus)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/delivery/${row.id}`}
                        className="rounded-lg border border-[var(--ui-accent-border)] bg-[var(--ui-accent-soft-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-accent)] hover:bg-[var(--ui-accent-soft-bg-strong)]"
                      >
                        {t('actionOpen')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
