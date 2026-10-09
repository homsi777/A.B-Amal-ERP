import React from 'react';
import { useTranslation } from 'react-i18next';

export const Treasury = () => {
  const { t } = useTranslation('treasuryMain');
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('pageTitle')}</h2>
          <p className="text-slate-500 mt-1">{t('pageSubtitle')}</p>
        </div>
        <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition">
          {t('addSafe')}
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 overflow-hidden">
        <h3 className="text-lg font-bold text-slate-900 mb-4">{t('mainSafeTitle')}</h3>
        <p className="text-slate-500 mb-4">{t('description')}</p>
        <button className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition">
          {t('editSafeData')}
        </button>
      </div>
    </div>
  );
};
