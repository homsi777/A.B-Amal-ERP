import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, Plus, Handshake, Users, Building2, Phone } from 'lucide-react';

export const Partners = () => {
  const { t } = useTranslation('partners');
  const [partners] = useState([
    { id: 'CUST-0012', name: t('samplePartner1.name'), type: 'CUSTOMER' as const, email: 'contact@alrowad.com', phone: '0501234567', tag: t('samplePartner1.tag'), outstanding: 125000 },
    { id: 'VEND-0044', name: t('samplePartner2.name'), type: 'SUPPLIER' as const, email: 'sales@goldenfab.com', phone: '0559876543', tag: t('samplePartner2.tag'), outstanding: -45000 },
    { id: 'PART-0089', name: t('samplePartner3.name'), type: 'STRATEGIC_PARTNER' as const, email: 'logistics@fastship.com', phone: '0112345678', tag: t('samplePartner3.tag'), outstanding: 0 },
  ]);

  const typeLabel = (type: 'CUSTOMER' | 'SUPPLIER' | 'STRATEGIC_PARTNER') => {
    if (type === 'CUSTOMER') return t('partnerType.customer');
    if (type === 'SUPPLIER') return t('partnerType.supplier');
    return t('partnerType.strategicPartner');
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('pageTitle')}</h2>
          <p className="text-slate-500 mt-1">{t('pageSubtitle')}</p>
        </div>
        <button className="bg-rose-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-rose-700 transition shadow-sm font-medium">
          <Plus className="w-4 h-4" />
          <span>{t('createNewPartner')}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition">
           <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center">
             <Handshake className="w-6 h-6" />
           </div>
           <div>
             <p className="text-sm text-slate-500">{t('totalPartners')}</p>
             <p className="text-2xl font-bold text-slate-900">3,492</p>
           </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition">
           <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center">
             <Users className="w-6 h-6" />
           </div>
           <div>
             <p className="text-sm text-slate-500">{t('activeCustomers')}</p>
             <p className="text-2xl font-bold text-slate-900">2,105</p>
           </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition">
           <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
             <Building2 className="w-6 h-6" />
           </div>
           <div>
             <p className="text-sm text-slate-500">{t('approvedSuppliers')}</p>
             <p className="text-2xl font-bold text-slate-900">843</p>
           </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500 shadow-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition shadow-sm font-medium">
              <Filter className="w-4 h-4" />
              <span>{t('filterByTypeTags')}</span>
            </button>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {partners.map((partner, idx) => (
             <div key={idx} className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-lg transition-shadow cursor-pointer relative group">
                <div className="absolute top-4 left-4">
                   <span className={`px-2 py-1 text-xs font-bold rounded-full border
                      ${partner.type === 'CUSTOMER' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                        partner.type === 'SUPPLIER' ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                      {typeLabel(partner.type)}
                   </span>
                </div>
                <div className="flex items-start gap-4">
                   <div className="w-14 h-14 bg-rose-100 rounded-xl flex items-center justify-center text-rose-600 font-bold text-xl shrink-0 group-hover:scale-110 transition-transform">
                      {partner.name.substring(0, 1)}
                   </div>
                   <div className="pt-1">
                      <h3 className="font-bold text-slate-900 text-lg leading-tight mb-1 max-w-[80%]">{partner.name}</h3>
                      <p className="text-sm text-slate-500 mb-4">{partner.tag}</p>
                   </div>
                </div>

                <div className="space-y-2 mt-2 pt-4 border-t border-slate-100 text-sm">
                   <div className="flex items-center gap-2 text-slate-600">
                      <Phone className="w-4 h-4 text-slate-400" />
                      <span className="font-mono font-medium">{partner.phone}</span>
                   </div>
                   <div className="flex items-center justify-between mt-2">
                      <span className="text-slate-500">{t('outstandingBalance')}</span>
                      <span className={`font-bold ${partner.outstanding > 0 ? 'text-emerald-600' : partner.outstanding < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                         {Math.abs(partner.outstanding).toLocaleString()} {partner.outstanding < 0 ? t('owedByThem') : partner.outstanding > 0 ? t('owedToThem') : ''} $
                      </span>
                   </div>
                </div>
             </div>
          ))}
        </div>
      </div>
    </div>
  );
};
