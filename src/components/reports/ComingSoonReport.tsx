import React from 'react';
import { useTranslation } from 'react-i18next';
import { FileWarning } from 'lucide-react';

interface Props {
  title?: string;
  accounting?: boolean;
}

export const ComingSoonReport = ({ title, accounting }: Props) => {
  const { t } = useTranslation('reportsMain');
  return (
    <div className="flex flex-col items-center justify-center min-h-[280px] rounded-xl border border-amber-100 bg-amber-50/50 p-8 text-center">
      <FileWarning className="w-14 h-14 text-amber-500 mb-4" />
      <p className="text-lg font-bold text-slate-900">{title ?? t('comingSoon.defaultTitle')}</p>
      <p className="text-sm text-slate-600 mt-3 max-w-md leading-relaxed">
        {accounting
          ? t('comingSoon.accountingNotice')
          : t('comingSoon.genericNotice')}
      </p>
    </div>
  );
};
