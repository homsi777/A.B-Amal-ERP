import React, { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Eye,
  FileStack,
  LayoutGrid,
  ListOrdered,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { useStore } from '../../store/useStore';
import type { Customer, CustomerOrder, CustomerOrderStatus, OrderTemplate, OrderTemplateLine } from '../../types';
import { OrderDetailModal } from '../../components/orders/OrderDetailModal';
import { OrderFormModal } from '../../components/orders/OrderFormModal';
import type { OrderFormSubmitPayload } from '../../components/orders/OrderFormModal';
import { ORDER_STATUS_LABELS, statusBadgeClass } from './orderStatusUi';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import {
  createCustomerOrderApi,
  createOrderTemplateApi,
  deleteCustomerOrderApi,
  deleteOrderTemplateApi,
  listCustomerOrders,
  listOrderTemplatesApi,
  updateCustomerOrderApi,
  updateCustomerOrderStatusApi,
} from '../../lib/api/customerOrdersApi';

type TabId = 'registry' | 'templates';

const emptyTplLine = (): OrderTemplateLine => ({
  materialName: '',
  dsamNumber: '',
  rollNo: '',
  colorCode: '',
  colorName: '',
  length: 0,
  widthCm: 150,
  gsm: 150,
  price: 0,
  note: '',
});

const mapApiCustomer = (c: ApiCustomer): Customer => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  address: c.address,
  balance: 0,
});

export function CustomerOrdersPage() {
  const inventory = useStore((s) => s.inventory);

  const [tab, setTab] = useState<TabId>('registry');
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
  const [orderTemplates, setOrderTemplates] = useState<OrderTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<CustomerOrder | null>(null);
  const [detailOrder, setDetailOrder] = useState<CustomerOrder | null>(null);

  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplDesc, setTplDesc] = useState('');
  const [tplLines, setTplLines] = useState<OrderTemplateLine[]>([emptyTplLine()]);

  const refreshData = async () => {
    setLoading(true);
    setError('');
    try {
      const [customerRes, orderRes, templateRes] = await Promise.all([
        listCustomers({ status: 'active', pageSize: 1000 }),
        listCustomerOrders(),
        listOrderTemplatesApi(),
      ]);
      setCustomers(customerRes.data.map(mapApiCustomer));
      setCustomerOrders(orderRes.data);
      setOrderTemplates(templateRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load customer orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshData();
  }, []);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customerOrders.filter((o) => {
      const c = customers.find((x) => x.id === o.customerId);
      const name = c?.name?.toLowerCase() ?? '';
      if (!q) return true;
      return (
        o.orderNumber.toLowerCase().includes(q) ||
        name.includes(q) ||
        (o.notes?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [customerOrders, customers, search]);

  const openNewOrder = () => {
    setEditingOrder(null);
    setOrderModalOpen(true);
  };

  const openEditOrder = (o: CustomerOrder) => {
    setEditingOrder(o);
    setOrderModalOpen(true);
  };

  const handleOrderSubmit = async (payload: OrderFormSubmitPayload, mode: 'create' | 'update') => {
    if (mode === 'create') {
      const created = await createCustomerOrderApi({
        date: payload.date,
        customerId: payload.customerId,
        currency: payload.currency,
        warehouse: payload.warehouse,
        notes: payload.notes,
        items: payload.items,
        status: payload.status,
        expectedDate: payload.expectedDate,
        templateId: payload.templateId,
        orderNumber: payload.orderNumber,
        advancePayment: payload.advancePayment,
      });
      setCustomerOrders((rows) => [created, ...rows]);
      return;
    }
    if (editingOrder) {
      const updated = await updateCustomerOrderApi(editingOrder.id, {
        date: payload.date,
        customerId: payload.customerId,
        currency: payload.currency,
        warehouse: payload.warehouse,
        notes: payload.notes,
        items: payload.items,
        status: payload.status,
        expectedDate: payload.expectedDate,
        templateId: payload.templateId,
        advancePayment: payload.advancePayment,
        ...(payload.orderNumber ? { orderNumber: payload.orderNumber } : {}),
      });
      setCustomerOrders((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      setDetailOrder((row) => (row?.id === updated.id ? updated : row));
    }
  };

  const resetTplForm = () => {
    setTplName('');
    setTplDesc('');
    setTplLines([emptyTplLine()]);
  };

  const saveTemplate = async () => {
    const name = tplName.trim();
    if (!name) return;
    const lines = tplLines.filter((l) => l.materialName.trim() || l.dsamNumber.trim());
    if (!lines.length) return;
    const created = await createOrderTemplateApi({ name, description: tplDesc.trim() || undefined, lines });
    setOrderTemplates((rows) => [created, ...rows]);
    resetTplForm();
    setTplModalOpen(false);
  };

  const handleStatusChange = async (id: string, status: CustomerOrderStatus) => {
    const previous = customerOrders;
    setCustomerOrders((rows) => rows.map((o) => (o.id === id ? { ...o, status, updatedAt: new Date().toISOString() } : o)));
    try {
      await updateCustomerOrderStatusApi(id, status);
    } catch (e) {
      setCustomerOrders(previous);
      setError(e instanceof Error ? e.message : 'Failed to update order status');
    }
  };

  const handleDeleteOrder = async (id: string) => {
    const previous = customerOrders;
    setCustomerOrders((rows) => rows.filter((o) => o.id !== id));
    try {
      await deleteCustomerOrderApi(id);
    } catch (e) {
      setCustomerOrders(previous);
      setError(e instanceof Error ? e.message : 'Failed to delete order');
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    const previous = orderTemplates;
    setOrderTemplates((rows) => rows.filter((t) => t.id !== id));
    try {
      await deleteOrderTemplateApi(id);
    } catch (e) {
      setOrderTemplates(previous);
      setError(e instanceof Error ? e.message : 'Failed to delete template');
    }
  };

  const updateTplLine = (index: number, patch: Partial<OrderTemplateLine>) => {
    setTplLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ClipboardList className="w-7 h-7 text-indigo-600" />
            الطلبيات
          </h2>
          <p className="text-slate-500 mt-1">
            حجز طلبيات للعملاء على خامات وأقمشة متوقعة قبل وصولها للمستودع — مع نماذج تسريع وملفّات صور لكل سطر.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === 'registry' ? (
            <button
              type="button"
              onClick={openNewOrder}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition font-medium"
            >
              <Plus className="w-4 h-4" />
              إنشاء طلبية جديدة
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                resetTplForm();
                setTplModalOpen(true);
              }}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition font-medium"
            >
              <FileStack className="w-4 h-4" />
              إنشاء نموذج طلبية
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-1">
        <button
          type="button"
          onClick={() => setTab('registry')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-bold transition ${
            tab === 'registry'
              ? 'bg-white border border-b-0 border-slate-200 text-indigo-700 shadow-sm'
              : 'text-slate-500 hover:bg-slate-100/80'
          }`}
        >
          <ListOrdered className="w-4 h-4" />
          سجل الطلبيات
        </button>
        <button
          type="button"
          onClick={() => setTab('templates')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-bold transition ${
            tab === 'templates'
              ? 'bg-white border border-b-0 border-slate-200 text-indigo-700 shadow-sm'
              : 'text-slate-500 hover:bg-slate-100/80'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          نماذج الطلبيات
        </button>
      </div>

      {(loading || error) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-600'
          }`}
        >
          {error || 'Loading customer orders...'}
        </div>
      )}

      {tab === 'registry' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
            <div className="relative flex-1 max-w-md min-w-[200px]">
              <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم الطلبية أو اسم العميل..."
                className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">رقم الطلبية</th>
                  <th className="px-4 py-3">التاريخ</th>
                  <th className="px-4 py-3">العميل</th>
                  <th className="px-4 py-3">البنود</th>
                  <th className="px-4 py-3">متوقع التوريد</th>
                  <th className="px-4 py-3">الإجمالي</th>
                  <th className="px-4 py-3 min-w-[140px]">الحالة</th>
                  <th className="px-4 py-3">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((o) => {
                  const customer = customers.find((c) => c.id === o.customerId);
                  const total = o.items.reduce((s, i) => s + i.length * i.price, 0);
                  return (
                    <tr
                      key={o.id}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setDetailOrder(o);
                        }
                      }}
                      className="hover:bg-indigo-50/40 cursor-pointer transition-colors"
                      onClick={() => setDetailOrder(o)}
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-indigo-600">{o.orderNumber}</td>
                      <td className="px-4 py-3 text-slate-600">{format(new Date(o.date), 'PP', { locale: ar })}</td>
                      <td className="px-4 py-3 font-bold text-slate-800">{customer?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{o.items.length}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {o.expectedDate ? format(new Date(o.expectedDate), 'PP', { locale: ar }) : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold">
                        {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                        <span className="text-xs text-slate-500">{o.currency}</span>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={o.status}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onChange={(e) => void handleStatusChange(o.id, e.target.value as CustomerOrderStatus)}
                          className={`text-xs font-bold rounded-lg px-2 py-1.5 border max-w-[160px] ${statusBadgeClass(o.status)}`}
                        >
                          {(Object.keys(ORDER_STATUS_LABELS) as CustomerOrderStatus[]).map((st) => (
                            <option key={st} value={st}>
                              {ORDER_STATUS_LABELS[st]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 justify-end">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailOrder(o);
                            }}
                            className="text-violet-700 hover:bg-violet-50 px-2 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            عرض
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditOrder(o);
                            }}
                            className="text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            تعديل
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm('حذف هذه الطلبية من السجل؟')) void handleDeleteOrder(o.id);
                            }}
                            className="text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            حذف
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-14 text-center text-slate-500">
                      لا توجد طلبيات بعد. ابدأ بـ «إنشاء طلبية جديدة» بعد تعريف العملاء في النظام.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'templates' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orderTemplates.map((t) => (
            <div
              key={t.id}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-slate-900 text-lg">{t.name}</h3>
                  {t.description && <p className="text-sm text-slate-500 mt-1">{t.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('حذف هذا النموذج؟')) void handleDeleteTemplate(t.id);
                  }}
                  className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                  aria-label="حذف"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="text-xs text-slate-500 font-mono">{t.lines.length} سطر افتراضي</div>
              <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
                {t.lines.slice(0, 4).map((line, i) => (
                  <li key={i}>
                    {line.materialName || 'خامة'} — {line.dsamNumber}
                  </li>
                ))}
                {t.lines.length > 4 && <li className="text-slate-400">…</li>}
              </ul>
            </div>
          ))}
          {orderTemplates.length === 0 && (
            <div className="sm:col-span-2 lg:col-span-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-10 text-center text-slate-500">
              لا توجد نماذج بعد. أنشئ نموذجاً من أزرار الأعلى لتسريع إدخال الطلبيات المتكررة (مثل «طقم صيفي» أو «طلب معرض»).
            </div>
          )}
        </div>
      )}

      <OrderDetailModal
        open={detailOrder !== null}
        order={detailOrder}
        customer={customers.find((c) => c.id === detailOrder?.customerId)}
        onClose={() => setDetailOrder(null)}
      />

      <OrderFormModal
        open={orderModalOpen}
        onClose={() => {
          setOrderModalOpen(false);
          setEditingOrder(null);
        }}
        customers={customers}
        inventory={inventory}
        templates={orderTemplates}
        editingOrder={editingOrder}
        onSubmit={handleOrderSubmit}
      />

      {tplModalOpen && (
        <div className="fixed inset-0 z-[190] flex items-center justify-center p-4 bg-slate-900/50" dir="rtl">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">إنشاء نموذج طلبية</h3>
              <button
                type="button"
                onClick={() => setTplModalOpen(false)}
                className="text-slate-500 hover:text-slate-800 p-2"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-slate-600">
              يحفظ بنوداً جاهزة (خامة، تصميم، ألوان، كميات تقريبية) لاستدعائها عند إنشاء طلبية جديدة من القائمة المنسدلة «تحميل من
              نموذج».
            </p>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700">اسم النموذج</label>
              <input
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2"
                placeholder="مثال: طلب معرض ربيع 2026"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700">وصف اختياري</label>
              <textarea
                value={tplDesc}
                onChange={(e) => setTplDesc(e.target.value)}
                rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-slate-800">بنود النموذج</span>
                <button
                  type="button"
                  onClick={() => setTplLines((r) => [...r, emptyTplLine()])}
                  className="text-sm text-indigo-600 font-medium"
                >
                  + سطر
                </button>
              </div>
              {tplLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <input
                    placeholder="خامة"
                    value={line.materialName}
                    onChange={(e) => updateTplLine(idx, { materialName: e.target.value })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm col-span-2"
                  />
                  <input
                    placeholder="تصميم"
                    value={line.dsamNumber}
                    onChange={(e) => updateTplLine(idx, { dsamNumber: e.target.value })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm"
                  />
                  <input
                    placeholder="سعر متر"
                    type="number"
                    value={line.price || ''}
                    onChange={(e) => updateTplLine(idx, { price: Number(e.target.value) || 0 })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm"
                    dir="ltr"
                  />
                  <input
                    placeholder="لون"
                    value={line.colorName}
                    onChange={(e) => updateTplLine(idx, { colorName: e.target.value })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm"
                  />
                  <input
                    placeholder="كود لون"
                    value={line.colorCode}
                    onChange={(e) => updateTplLine(idx, { colorCode: e.target.value })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm"
                    dir="ltr"
                  />
                  <input
                    placeholder="أمتار"
                    type="number"
                    value={line.length || ''}
                    onChange={(e) => updateTplLine(idx, { length: Number(e.target.value) || 0 })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm"
                    dir="ltr"
                  />
                  <input
                    placeholder="عرض سم"
                    type="number"
                    value={line.widthCm || ''}
                    onChange={(e) => updateTplLine(idx, { widthCm: Number(e.target.value) || 0 })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm"
                    dir="ltr"
                  />
                  <div className="flex justify-end col-span-2 sm:col-span-4">
                    <button
                      type="button"
                      onClick={() => setTplLines((r) => r.filter((_, i) => i !== idx))}
                      disabled={tplLines.length <= 1}
                      className="text-rose-600 text-xs disabled:opacity-30"
                    >
                      حذف السطر
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTplModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={saveTemplate}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700"
              >
                حفظ النموذج
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
