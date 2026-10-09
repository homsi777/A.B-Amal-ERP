import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, Plus, FileOutput } from 'lucide-react';

export const ExchangeInvoices = () => {
  const { t } = useTranslation('exchangeInvoices');
  const [invoices] = useState([
    { id: 'EXC-9901', date: '2023-10-25', requester: t('sampleRequester1'), warehouse: t('sampleWarehouse1'), itemsCount: 4, status: 'APPROVED' as const },
    { id: 'EXC-9900', date: '2023-10-22', requester: t('sampleRequester2'), warehouse: t('sampleWarehouse2'), itemsCount: 12, status: 'DRAFT' as const },
  ]);

  const statusLabel = (status: 'APPROVED' | 'DRAFT') => (status === 'APPROVED' ? t('statusApproved') : t('statusDraft'));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('pageTitle')}</h2>
          <p className="text-slate-500 mt-1">{t('pageSubtitle')}</p>
        </div>
        <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm font-medium">
          <Plus className="w-4 h-4" />
          <span>{t('issueExchangeInvoice')}</span>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>
          <button className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition shadow-sm font-medium">
            <Filter className="w-4 h-4" />
            <span>{t('filter')}</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-6 py-4">{t('colInvoiceNo')}</th>
                <th className="px-6 py-4">{t('colDate')}</th>
                <th className="px-6 py-4">{t('colRequester')}</th>
                <th className="px-6 py-4">{t('colWarehouse')}</th>
                <th className="px-6 py-4">{t('colItemsCount')}</th>
                <th className="px-6 py-4">{t('colStatus')}</th>
                <th className="px-6 py-4">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map(invoice => (
                <tr key={invoice.id} className="hover:bg-slate-50 transition-colors bg-white">
                  <td className="px-6 py-4 font-mono font-medium text-slate-600">{invoice.id}</td>
                  <td className="px-6 py-4 font-medium text-slate-600">{invoice.date}</td>
                  <td className="px-6 py-4 font-bold text-indigo-700">{invoice.requester}</td>
                  <td className="px-6 py-4 text-slate-700">{invoice.warehouse}</td>
                  <td className="px-6 py-4 font-bold text-slate-800">{t('itemsCountUnit', { count: invoice.itemsCount })}</td>
                  <td className="px-6 py-4">
                     <span className={`px-2 py-1 rounded text-xs font-bold ${invoice.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
                        {statusLabel(invoice.status)}
                     </span>
                  </td>
                  <td className="px-6 py-4">
                     <button className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium">
                        {t('viewDetails')}
                     </button>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                 <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">{t('noDataToShow')}</td>
                 </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
