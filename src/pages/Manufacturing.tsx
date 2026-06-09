import React, { useState } from 'react';
import { Search, Filter, Plus, Factory, Settings, Calendar, ClipboardList } from 'lucide-react';

export const Manufacturing = () => {
  const [orders] = useState([
    { id: 'MO/0001', product: 'طقم أريكة فاخر', quantity: 10, uom: 'وحدة', date: '2023-11-01', status: 'مؤكد', progress: 40 },
    { id: 'MO/0002', product: 'مكتب خشبي كلاسيكي', quantity: 5, uom: 'وحدة', date: '2023-11-02', status: 'في الانتظار', progress: 0 },
    { id: 'MO/0003', product: 'كرسي مكتب مريح', quantity: 50, uom: 'وحدة', date: '2023-10-25', status: 'مكتمل', progress: 100 },
  ]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">نظام التصنيع والإنتاج</h2>
          <p className="text-slate-500 mt-1">إدارة أوامر التصنيع، مراكز العمل، وقوائم المواد (BoM) على طريقة Odoo ERP</p>
        </div>
        <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm font-medium">
          <Plus className="w-4 h-4" />
          <span>أمر تصنيع جديد</span>
        </button>
      </div>

      {/* Analytics or Top level Tabs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition">
           <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
             <Factory className="w-6 h-6" />
           </div>
           <div>
             <p className="text-sm text-slate-500">أوامر التصنيع</p>
             <p className="text-2xl font-bold text-slate-900">124</p>
           </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition">
           <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center">
             <ClipboardList className="w-6 h-6" />
           </div>
           <div>
             <p className="text-sm text-slate-500">قوائم المواد (BOM)</p>
             <p className="text-2xl font-bold text-slate-900">45</p>
           </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition">
           <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center">
             <Settings className="w-6 h-6" />
           </div>
           <div>
             <p className="text-sm text-slate-500">مراكز العمل</p>
             <p className="text-2xl font-bold text-slate-900">8</p>
           </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition">
           <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center">
             <Calendar className="w-6 h-6" />
           </div>
           <div>
             <p className="text-sm text-slate-500">عمليات مجدولة</p>
             <p className="text-2xl font-bold text-slate-900">12</p>
           </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input 
              type="text" 
              placeholder="بحث في أوامر التصنيع..." 
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition shadow-sm font-medium">
              <Filter className="w-4 h-4" />
              <span>تصفية والتجميع حسب</span>
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-6 py-4">المرجع</th>
                <th className="px-6 py-4">المنتج</th>
                <th className="px-6 py-4">الكمية للإنتاج</th>
                <th className="px-6 py-4">وحدة القياس</th>
                <th className="px-6 py-4">الموعد المجدول</th>
                <th className="px-6 py-4">التقدم</th>
                <th className="px-6 py-4">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((order, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors bg-white">
                  <td className="px-6 py-4 font-mono font-medium text-slate-600">{order.id}</td>
                  <td className="px-6 py-4 font-bold text-indigo-700">{order.product}</td>
                  <td className="px-6 py-4 font-bold text-slate-900">{order.quantity}</td>
                  <td className="px-6 py-4 text-slate-600">{order.uom}</td>
                  <td className="px-6 py-4 text-slate-600 font-medium">{order.date}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                        <div className="w-full bg-slate-200 rounded-full h-2 max-w-[100px]">
                           <div className={`h-2 rounded-full ${order.progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${order.progress}%` }}></div>
                        </div>
                        <span className="text-xs font-bold text-slate-600 w-8">{order.progress}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                     <span className={`px-2 py-1 rounded text-xs font-bold 
                        ${order.status === 'مكتمل' ? 'bg-emerald-100 text-emerald-800' : 
                          order.status === 'مؤكد' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-700'}`}>
                        {order.status}
                     </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
