import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { ArrowRight, Printer, Ruler, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  confirmDeliveryFulfillment,
  getDeliveryDetail,
  saveDeliveryTafnid,
  type DeliveryLineDraft,
} from '../../lib/api/deliveryApi';
import { useAuth } from '../../contexts/AuthContext';
import { canFulfillDelivery, canSaveDeliveryTafnid } from '../../lib/deliveryPermissions';
import { ApiRequestError } from '../../lib/api/client';
import { TafnidModal } from '../../components/delivery/TafnidModal';
import { AR_WHOLESALE, arDeliveryStatus } from '../../lib/i18n/arTerminology';
import { useToast } from '../../components/NonBlockingToast';

export function DeliveryFulfillment() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('delivery');
  const { showToast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [header, setHeader] = useState<Awaited<ReturnType<typeof getDeliveryDetail>>['header'] | null>(null);
  const [lines, setLines] = useState<DeliveryLineDraft[]>([]);
  const [tafnidOpen, setTafnidOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const maySaveTafnid = canSaveDeliveryTafnid(user);
  const mayFulfill = canFulfillDelivery(user);

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

  const onSaveTafnid = async (updated: DeliveryLineDraft[]) => {
    if (!id) return;
    const incomplete = updated.some((ln) => {
      const needed = ln.unit === 'توب' ? Math.max(1, Math.round(ln.rollQty)) : 1;
      const rolls = ln.rollTafnid ?? [];
      for (let seq = 1; seq <= needed; seq++) {
        const len = rolls.find((r) => r.rollSeq === seq)?.length;
        if (len == null || len <= 0) return true;
      }
      return false;
    });
    if (incomplete) {
      showToast({ type: 'warning', message: 'أدخل طول التفنيد لكل توب' });
      return;
    }
    setSaving(true);
    try {
      await saveDeliveryTafnid(id, updated);
      setLines(updated);
      setTafnidOpen(false);
      setHeader((prev) => (prev ? { ...prev, deliveryStatus: 'TAFNID_SAVED' } : prev));
      showToast({ type: 'success', message: 'تم حفظ التفنيد — بانتظار موافقة المدير' });
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر حفظ التفنيد',
      });
    } finally {
      setSaving(false);
    }
  };

  const onConfirmDelivery = async () => {
    if (!id) return;
    const incomplete = lines.some((ln) => {
      const needed = ln.unit === 'توب' ? Math.max(1, Math.round(ln.rollQty)) : 1;
      const rolls = ln.rollTafnid ?? [];
      for (let seq = 1; seq <= needed; seq++) {
        const len = rolls.find((r) => r.rollSeq === seq)?.length ?? (seq === 1 ? ln.tafnidLength : undefined);
        if (len == null || len <= 0) return true;
      }
      return false;
    });
    if (incomplete) {
      showToast({ type: 'warning', message: 'أكمل تفنيد كل توب قبل تأكيد التسليم' });
      return;
    }
    setSaving(true);
    try {
      await confirmDeliveryFulfillment(id);
      showToast({
        type: 'success',
        message: 'تم تأكيد التسليم وتأكيد الفاتورة محاسبياً وخصم المخزون',
      });
      setHeader((prev) => (prev ? { ...prev, deliveryStatus: 'FULFILLED' } : prev));
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof ApiRequestError ? e.message : 'تعذر تأكيد التسليم',
      });
    } finally {
      setSaving(false);
    }
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
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              header.deliveryStatus === 'TAFNID_SAVED'
                ? 'bg-amber-100 text-amber-900'
                : 'bg-[var(--ui-accent-soft-bg)] text-[var(--ui-nav-active-text)]'
            }`}
          >
            {arDeliveryStatus(header.deliveryStatus)}
          </span>
        </div>

        {header.deliveryStatus === 'TAFNID_SAVED' && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            تم حفظ التفنيد. ينتظر المدير مراجعة الأطوال وتأكيد التسليم لخصم المخزون.
          </p>
        )}

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
          {maySaveTafnid ? (
            <button
              type="button"
              disabled={saving || header.deliveryStatus === 'FULFILLED'}
              onClick={() => setTafnidOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--ui-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--ui-accent-hover)] disabled:opacity-50"
            >
              <Ruler className="h-4 w-4" />
              {AR_WHOLESALE.tafnidAction}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm hover:bg-[var(--surface-hover)]"
          >
            <Printer className="h-4 w-4" />
            {t('actionPrint')}
          </button>
          {mayFulfill ? (
            <button
              type="button"
              disabled={
                saving ||
                header.deliveryStatus === 'FULFILLED' ||
                header.deliveryStatus !== 'TAFNID_SAVED'
              }
              onClick={() => void onConfirmDelivery()}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--ui-accent-border)] bg-[var(--ui-accent-soft-bg)] px-4 py-2 text-sm font-medium text-[var(--ui-nav-active-text)] disabled:opacity-50"
            >
              {t('confirmDelivery')}
            </button>
          ) : null}
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
                  {(() => {
                    const needed = line.unit === 'توب' ? Math.max(1, Math.round(line.rollQty)) : 1;
                    const rolls = line.rollTafnid ?? [];
                    const filled = rolls.filter((r) => r.length != null && r.length > 0).length;
                    if (needed > 1) {
                      if (filled === 0) return '—';
                      if (filled < needed) return `${filled}/${needed} ${AR_WHOLESALE.rollUnit}`;
                      const lens = rolls
                        .filter((r) => r.length != null && r.length > 0)
                        .map((r) => r.length)
                        .join('، ');
                      return `${needed} ${AR_WHOLESALE.rollUnit}: ${lens}`;
                    }
                    return line.tafnidLength != null ? `${line.tafnidLength} ${line.unit}` : '—';
                  })()}
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
