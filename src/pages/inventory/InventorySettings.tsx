import React, { useState } from 'react';
import { AlertTriangle, Layers, Ruler, Save } from 'lucide-react';

const INVENTORY_LOW_STOCK_THRESHOLD_KEY = 'inventory_low_stock_threshold';
const INVENTORY_DEFAULT_UNIT_KEY = 'inventory_default_unit';

export const InventorySettings = () => {
  const [lowStockThreshold, setLowStockThreshold] = useState(() => localStorage.getItem(INVENTORY_LOW_STOCK_THRESHOLD_KEY) || '10');
  const [defaultUnit, setDefaultUnit] = useState(() => localStorage.getItem(INVENTORY_DEFAULT_UNIT_KEY) || 'meter');
  const [saveMessage, setSaveMessage] = useState('');

  const handleSaveSettings = () => {
    const parsedThreshold = Number(lowStockThreshold);
    const normalizedThreshold = Number.isFinite(parsedThreshold) ? Math.max(0, parsedThreshold) : 0;

    setLowStockThreshold(String(normalizedThreshold));
    localStorage.setItem(INVENTORY_LOW_STOCK_THRESHOLD_KEY, String(normalizedThreshold));
    localStorage.setItem(INVENTORY_DEFAULT_UNIT_KEY, defaultUnit);
    setSaveMessage('تم حفظ إعدادات المخزون بنجاح.');
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">إعدادات المخزون</h2>
          <p className="text-slate-500 mt-1">إعدادات عرض إنشاء المادة، التنبيهات، وحدود انخفاض المخزون.</p>
        </div>
      </div>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 space-y-8">
          <div className="space-y-4 pt-2">
            <h3 className="text-lg font-bold text-slate-900 border-b pb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              تنبيهات وحدود المخزون
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-end">
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700">حد تنبيه انخفاض المخزون من المادة</label>
                <input
                  type="number"
                  min="0"
                  value={lowStockThreshold}
                  onChange={(event) => {
                    setLowStockThreshold(event.target.value);
                    setSaveMessage('');
                  }}
                  className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition shadow-sm font-mono text-left"
                  dir="ltr"
                />
                <p className="text-xs text-slate-500">عند وصول كمية المادة لهذا الرقم أو أقل يظهر تنبيه انخفاض مخزون.</p>
              </div>

              <label className="flex items-center gap-2 font-medium text-slate-700 p-3 border border-slate-200 rounded-lg bg-slate-50 cursor-pointer">
                <input type="checkbox" className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4" defaultChecked />
                تفعيل تنبيهات حد إعادة الطلب
              </label>
              <label className="flex items-center gap-2 font-medium text-slate-700 p-3 border border-slate-200 rounded-lg bg-slate-50 cursor-pointer">
                <input type="checkbox" className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4" defaultChecked />
                منع البيع عند نفاد المخزون
              </label>
            </div>
          </div>

          <div className="space-y-4 pt-6 border-t border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 border-b pb-2 flex items-center gap-2">
              <Ruler className="w-5 h-5 text-indigo-500" />
              وحدات القياس الافتراضية
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-slate-700">الوحدة الأساسية للأقمشة</label>
                <select
                  value={defaultUnit}
                  onChange={(event) => {
                    setDefaultUnit(event.target.value);
                    setSaveMessage('');
                  }}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="meter">متر</option>
                  <option value="yard">ياردة</option>
                  <option value="roll">طاقة / رول</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-4 pt-6 border-t border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 border-b pb-2 flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-500" />
              سياسة التقييم وإدارة التكلفة
            </h3>
            <div className="flex flex-col sm:flex-row gap-4">
              <label className="flex items-center gap-2 font-medium text-slate-700 p-3 border border-slate-200 rounded-lg bg-slate-50 w-full sm:w-auto cursor-pointer">
                <input type="radio" name="valuation" value="fifo" className="text-indigo-600 focus:ring-indigo-500" defaultChecked />
                الوارد أولاً يصرف أولاً (FIFO)
              </label>
              <label className="flex items-center gap-2 font-medium text-slate-700 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 w-full sm:w-auto cursor-pointer">
                <input type="radio" name="valuation" value="average" className="text-indigo-600 focus:ring-indigo-500" />
                المتوسط المرجح
              </label>
            </div>
          </div>

          {saveMessage && (
            <div className="bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg p-3 text-sm font-bold">
              {saveMessage}
            </div>
          )}
        </div>

        <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end">
          <button onClick={handleSaveSettings} className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-indigo-700 transition flex items-center gap-2 shadow-sm">
            <Save className="w-4 h-4" />
            حفظ الإعدادات
          </button>
        </div>
      </section>
    </div>
  );
};
