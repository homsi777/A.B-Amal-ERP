import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { Plus, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

export const Expenses = () => {
  const { expenses, addExpense } = useStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const [newExpense, setNewExpense] = useState({ 
    date: new Date().toISOString().split('T')[0], 
    category: '', 
    amount: 0, 
    description: '' 
  });

  const filtered = expenses.filter(e => 
    e.description.includes(searchTerm) || e.category.includes(searchTerm)
  );

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    addExpense({
      ...newExpense,
      date: new Date(newExpense.date).toISOString()
    });
    setIsModalOpen(false);
    setNewExpense({ date: new Date().toISOString().split('T')[0], category: '', amount: 0, description: '' });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">المصاريف</h2>
          <p className="text-slate-500 mt-1">سجل المصروفات والتشغيل النثري</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة مصروف</span>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input 
              type="text" 
              placeholder="بحث في المصاريف..." 
              className="w-full pr-10 pl-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">الرقم المرجعي</th>
                <th className="px-6 py-4">التاريخ</th>
                <th className="px-6 py-4">التصنيف</th>
                <th className="px-6 py-4">البيان</th>
                <th className="px-6 py-4">المبلغ ($)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(expense => (
                <tr key={expense.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-900">{expense.id}</td>
                  <td className="px-6 py-4 text-slate-500">{format(new Date(expense.date), 'PP', { locale: ar })}</td>
                  <td className="px-6 py-4"><span className="px-2 py-1 bg-slate-100 rounded text-slate-700 text-xs">{expense.category}</span></td>
                  <td className="px-6 py-4 text-slate-700">{expense.description}</td>
                  <td className="px-6 py-4 font-bold text-rose-600">{expense.amount.toFixed(2)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-500">لا يوجد مصاريف مسجلة.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-900">إضافة مصروف جديد</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <form onSubmit={handleAdd} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">التاريخ</label>
                <input required type="date" className="w-full px-3 py-2 border border-slate-300 rounded-lg" value={newExpense.date} onChange={e => setNewExpense({...newExpense, date: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">التصنيف</label>
                <input required type="text" placeholder="مثال: نقل، ضيافة، صيانة..." className="w-full px-3 py-2 border border-slate-300 rounded-lg" value={newExpense.category} onChange={e => setNewExpense({...newExpense, category: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">البيان</label>
                <input required type="text" className="w-full px-3 py-2 border border-slate-300 rounded-lg" value={newExpense.description} onChange={e => setNewExpense({...newExpense, description: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">المبلغ ($)</label>
                <input required type="number" min="0" step="0.01" className="w-full px-3 py-2 border border-slate-300 rounded-lg" value={newExpense.amount} onChange={e => setNewExpense({...newExpense, amount: Number(e.target.value)})} />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50">إلغاء</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">حفظ</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
