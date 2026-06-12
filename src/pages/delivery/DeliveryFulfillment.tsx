import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { ArrowRight, Printer, Ruler, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getDeliveryDetail, type DeliveryLineDraft } from '../../lib/api/deliveryApi';
import { TafnidModal } from '../../components/delivery/TafnidModal';
import { AR_WHOLESALE, arDeliveryStatus } from '../../lib/i18n/arTerminology';
import { useToast } from '../../components/NonBlockingToast';

export function DeliveryFulfillment() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('delivery');
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [header, setHeader] = useState<Awaited<ReturnType<typeof getDeliveryDetail>>['header'] | null>(null);
  const [lines, setLines] = useState<DeliveryLineDraft[]>([]);
  const [tafnidOpen, setTafnidOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    void getDeliveryDetail(id)
      .then((res) => {
        setHeader(res.header);
        setLines(res.lines);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'تعذر تحميل تفاصيل التسليم');
        setHeader(null);
        setLines([]);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const onSaveTafnid = (updated: DeliveryLineDraft[]) => {
    setLines(updated);
    setTafnidOpen(false);
    showToast({ type: 'success', message: 'تم حفظ أطوال التفنيد محلياً — ربط الخادم قادم' });
  };

  const onConfirmDelivery = () => {
    showToast({ type: 'warning', message: t('confirmPending') });
  };

  if (loading) {
    return <p className="p-8 text-center text-[var(--text-muted)]">جاري التحميل…</p>;
  }

  if (error || !header) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-red-600">{error ?? 'الطلب غير موجود'}</p>
        <Link to="/delivery" className="mt-4 inline-block text-[var(--ui-accent)]">
          {t('backToQueue')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <Link to="/delivery" className="inline-flex items-center gap-1 text-sm text-[var(--ui-accent)] hover:underline">
        <ArrowRight className="h-4 w-4" />
        {t('backToQueue')}
      </Link>

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[var(--ui-accent)]">
              <Truck className="h-5 w-5" />
              <h1 className="text-xl font-bold text-[var(--text-heading)]">{t('fulfillment')}</h1>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              فاتورة {header.invoiceNo} — {header.customerLabel}
            </p>
          </div>
          <span className="rounded-full bg-[var(--ui-accent-soft-bg)] px-3 py-1 text-xs font-medium text-[var(--ui-nav-active-text)]">
            {arDeliveryStatus(header.deliveryStatus)}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <dt className="text-[var(--text-muted)]">التاريخ</dt>
            <dd className="font-medium">
              {header.invoiceDate
                ? format(new Date(`${header.invoiceDate}T12:00:00`), 'dd MMM yyyy', { locale: ar })
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">{AR_WHOLESALE.rollsCount}</dt>
            <dd className="font-medium">{header.rollCount || lines.length}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">الإجمالي</dt>
            <dd className="font-medium">
              {header.totalAmount.toLocaleString('ar-SY', { minimumFractionDigits: 2 })} {header.currencyCode}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTafnidOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--ui-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--ui-accent-hover)]"
          >
            <Ruler className="h-4 w-4" />
            {AR_WHOLESALE.tafnidAction}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm hover:bg-[var(--surface-hover)]"
          >
            <Printer className="h-4 w-4" />
            {t('actionPrint')}
          </button>
          <button
            type="button"
            onClick={onConfirmDelivery}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--ui-accent-border)] bg-[var(--ui-accent-soft-bg)] px-4 py-2 text-sm font-medium text-[var(--ui-nav-active-text)]"
          >
            {t('confirmDelivery')}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)]">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border-default)] bg-[var(--surface-card-muted)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 text-right">#</th>
              <th className="px-4 py-3 text-right">{t('lineMaterial')}</th>
              <th className="px-4 py-3 text-right">{t('lineRollQty')}</th>
              <th className="px-4 py-3 text-right">{t('lineLength')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.lineIndex} className="border-b border-[var(--border-subtle)]">
                <td className="px-4 py-3 text-[var(--text-muted)]">{line.lineIndex}</td>
                <td className="px-4 py-3 font-medium">{line.description}</td>
                <td className="px-4 py-3">
                  {line.rollQty} {AR_WHOLESALE.rollUnit}
                </td>
                <td className="px-4 py-3">
                  {line.tafnidLength != null ? `${line.tafnidLength} ${line.unit}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TafnidModal open={tafnidOpen} lines={lines} onClose={() => setTafnidOpen(false)} onSave={onSaveTafnid} />
    </div>
  );
}
