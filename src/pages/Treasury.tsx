import React from 'react';

export const Treasury = () => {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">الخزينة</h2>
          <p className="text-slate-500 mt-1">إدارة الخزائن النقدية</p>
        </div>
        <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition">
          إضافة خزينة
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 overflow-hidden">
        <h3 className="text-lg font-bold text-slate-900 mb-4">الخزينة الرئيسية</h3>
        <p className="text-slate-500 mb-4">يتم هنا عرض اسم الخزينة والبيانات الأساسية وتعديلها (بدون بيانات مالية مباشرة كما طلبت).</p>
        <button className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 transition">
          تعديل بيانات الخزينة
        </button>
      </div>
    </div>
  );
};
