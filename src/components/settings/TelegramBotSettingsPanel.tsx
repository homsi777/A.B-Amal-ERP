import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Check, Loader2, MessageCircle, Plus, RefreshCw, Send, ShieldCheck, X } from 'lucide-react';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { listSystemUsers, type ApiUser } from '../../lib/api/settingsApi';
import {
  createTelegramChatLink,
  fetchTelegramUpdates,
  getDetectedTelegramChats,
  getTelegramSettings,
  listTelegramChatLinks,
  sendTelegramTestMessage,
  testTelegramBot,
  toggleTelegramChatLinkStatus,
  updateTelegramSettings,
  type DetectedTelegramChatDto,
  type TelegramChatLinkDto,
  type TelegramLinkPayload,
  type TelegramSettingsDto,
  type TelegramTargetType,
} from '../../lib/api/telegramApi';

const targetLabels: Record<TelegramTargetType, string> = {
  USER: 'مستخدم',
  CUSTOMER: 'عميل',
  SUPPLIER: 'مورد',
  EMPLOYEE: 'موظف',
  OTHER: 'آخر',
};

const emptyLink = (chat?: DetectedTelegramChatDto): TelegramLinkPayload => ({
  chatId: chat?.chatId ?? '',
  telegramUserId: chat?.telegramUserId ?? '',
  telegramUsername: chat?.telegramUsername ?? '',
  telegramFirstName: chat?.telegramFirstName ?? '',
  telegramLastName: chat?.telegramLastName ?? '',
  telegramDisplayName: chat?.telegramDisplayName ?? '',
  chatType: chat?.chatType ?? '',
  targetType: 'CUSTOMER',
  targetId: '',
  targetName: '',
  canReceiveInvoices: true,
  canReceiveVouchers: true,
  canReceiveReports: false,
  canReceiveAlerts: true,
  notes: '',
});

export function TelegramBotSettingsPanel() {
  const [settings, setSettings] = useState<TelegramSettingsDto | null>(null);
  const [botToken, setBotToken] = useState('');
  const [isEnabled, setIsEnabled] = useState(false);
  const [detectedChats, setDetectedChats] = useState<DetectedTelegramChatDto[]>([]);
  const [links, setLinks] = useState<TelegramChatLinkDto[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [linkForm, setLinkForm] = useState<TelegramLinkPayload | null>(null);

  const ringCls = 'focus:outline-none focus:ring-2 focus:ring-[var(--ui-accent)]';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRow, chats, linkRows, customerRows, supplierRows, userRows] = await Promise.all([
        getTelegramSettings().catch(() => null),
        getDetectedTelegramChats().catch(() => []),
        listTelegramChatLinks({ pageSize: 50 }).catch(() => ({ data: [], total: 0, page: 1, pageSize: 50 })),
        listCustomers({ pageSize: 100, status: 'active' }).then((res) => res.data).catch(() => []),
        listSuppliers({ pageSize: 100, status: 'active' }).then((res) => res.data).catch(() => []),
        listSystemUsers().catch(() => []),
      ]);
      setSettings(settingsRow);
      setIsEnabled(Boolean(settingsRow?.isEnabled));
      setDetectedChats(chats);
      setLinks(linkRows.data);
      setCustomers(customerRows);
      setSuppliers(supplierRows);
      setUsers(userRows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const targetOptions = useMemo(() => {
    if (!linkForm) return [];
    if (linkForm.targetType === 'CUSTOMER') return customers.map((item) => ({ id: item.id, name: item.name }));
    if (linkForm.targetType === 'SUPPLIER') return suppliers.map((item) => ({ id: item.id, name: item.name }));
    if (linkForm.targetType === 'USER') return users.map((item) => ({ id: item.id, name: item.full_name || item.username }));
    return [];
  }, [customers, linkForm, suppliers, users]);

  const saveSettings = async () => {
    setLoading(true);
    setStatus('جاري حفظ إعدادات تيليغرام...');
    try {
      const saved = await updateTelegramSettings({ botToken: botToken.trim() || undefined, isEnabled: isEnabled || Boolean(botToken.trim()) });
      setSettings(saved);
      setBotToken('');
      setStatus(saved.purchaseMessage || 'تم شراء البوت قيمة شراء 92$ - البوت جاهز للخدمة - 50 عميل');
      setStatus('تم حفظ إعدادات البوت. التوكن لن يظهر بعد الحفظ.');
      setStatus(saved.purchaseMessage || 'تم شراء البوت قيمة شراء 92$ - البوت جاهز للخدمة - 50 عميل');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'فشل حفظ إعدادات تيليغرام');
    } finally {
      setLoading(false);
    }
  };

  const testBot = async () => {
    setLoading(true);
    setStatus('جاري اختبار البوت...');
    try {
      const bot = await testTelegramBot();
      setStatus(`تم الاتصال بالبوت: ${bot.username ? `@${bot.username}` : bot.first_name || bot.id}`);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'فشل اختبار البوت');
    } finally {
      setLoading(false);
    }
  };

  const fetchChats = async () => {
    setLoading(true);
    setStatus('جاري جلب Chat ID من تيليغرام...');
    try {
      const rows = await fetchTelegramUpdates();
      setDetectedChats(rows);
      setStatus(rows.length ? `تم جلب ${rows.length} محادثة.` : 'لا توجد محادثات جديدة. يجب أن يرسل الشخص رسالة للبوت أولا.');
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'فشل جلب المحادثات');
    } finally {
      setLoading(false);
    }
  };

  const openLink = (chat: DetectedTelegramChatDto) => {
    setLinkForm(emptyLink(chat));
    setStatus('');
  };

  const openManualCustomerLink = () => {
    setLinkForm({ ...emptyLink(), targetType: 'CUSTOMER', canReceiveReports: true });
    setStatus('اكتب اسم العميل أو اختره، ثم اضغط جلب ID بعد أن يرسل العميل اسمه للبوت.');
  };

  const fillLatestDetectedChat = async () => {
    if (!linkForm) return;
    setLoading(true);
    try {
      const rows = await fetchTelegramUpdates();
      setDetectedChats(rows);
      const candidate = rows.find((chat) => !chat.linked) || rows[0];
      if (!candidate) {
        setStatus('لا يوجد ID جاهز. اطلب من العميل إرسال اسمه في محادثة البوت ثم اضغط جلب ID.');
        return;
      }
      setLinkForm({
        ...linkForm,
        chatId: candidate.chatId,
        telegramUserId: candidate.telegramUserId || '',
        telegramUsername: candidate.telegramUsername || '',
        telegramFirstName: candidate.telegramFirstName || '',
        telegramLastName: candidate.telegramLastName || '',
        telegramDisplayName: candidate.telegramDisplayName || '',
        chatType: candidate.chatType || '',
      });
      setStatus(`تم جلب ID: ${candidate.chatId} - ${candidate.telegramDisplayName}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'تعذر جلب ID من تيليغرام');
    } finally {
      setLoading(false);
    }
  };

  const saveLink = async () => {
    if (!linkForm) return;
    setLoading(true);
    try {
      await createTelegramChatLink(linkForm);
      setLinkForm(null);
      setStatus('تم ربط Chat ID بنجاح.');
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'فشل ربط Chat ID');
    } finally {
      setLoading(false);
    }
  };

  const sendTest = async (linkId: string) => {
    setLoading(true);
    try {
      await sendTelegramTestMessage(linkId);
      setStatus('تم إرسال رسالة الاختبار بنجاح.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'فشل إرسال رسالة الاختبار');
    } finally {
      setLoading(false);
    }
  };

  const toggleLink = async (link: TelegramChatLinkDto) => {
    setLoading(true);
    try {
      await toggleTelegramChatLinkStatus(link.id, !link.isActive);
      await load();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-xl font-bold text-[var(--text-heading)] flex items-center gap-2">
              <Bot className="w-5 h-5 text-[var(--ui-accent)]" />
              بوت تيليغرام
            </h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              أنشئ البوت من BotFather، ثم ضع التوكن هنا. لا يظهر التوكن بعد الحفظ لأسباب أمنية.
            </p>
          </div>
          {settings?.hasToken && (
            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
              التوكن محفوظ: {settings.tokenMasked}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-2">
            <span className="font-bold text-[var(--text-heading)] text-sm">Bot Token</span>
            <input
              type="text"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
              placeholder="أدخل توكن البوت من BotFather"
              className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg text-[var(--text-heading)] ${ringCls}`}
              dir="ltr"
            />
          </label>
          <label className="flex items-center justify-between gap-3 p-4 border border-[var(--border-default)] rounded-xl">
            <span className="font-bold text-[var(--text-heading)]">تفعيل البوت</span>
            <input type="checkbox" checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} className="w-5 h-5 accent-[var(--ui-accent)]" />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={saveSettings} disabled={loading} className="bg-[var(--ui-accent)] text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:opacity-95 transition disabled:opacity-60">
            <Check className="w-4 h-4" />
            حفظ الإعدادات
          </button>
          <button type="button" onClick={testBot} disabled={loading || !settings?.hasToken} className="bg-[var(--surface-header)] border border-[var(--border-default)] text-[var(--text-heading)] px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-[var(--surface-muted-nav)] transition disabled:opacity-60">
            <MessageCircle className="w-4 h-4" />
            اختبار البوت
          </button>
          {loading && <Loader2 className="w-5 h-5 animate-spin text-[var(--ui-accent)] self-center" />}
        </div>
      </div>

      <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-bold text-[var(--text-heading)]">جلب Chat ID</h3>
            <p className="text-sm text-[var(--text-muted)]">اطلب من الشخص إرسال أي رسالة إلى البوت أولا، ثم اضغط جلب Chat ID.</p>
          </div>
          <button type="button" onClick={openManualCustomerLink} disabled={loading || !settings?.hasToken} className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition disabled:opacity-60">
            <Plus className="w-4 h-4" />
            إضافة عميل
          </button>
          <button type="button" onClick={fetchChats} disabled={loading || !settings?.hasToken} className="bg-[var(--ui-accent)] text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:opacity-95 transition disabled:opacity-60">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            جلب Chat ID تلقائيا
          </button>
        </div>

        {status && (
          <div className="border border-[var(--border-default)] bg-[var(--surface-muted-nav)] rounded-lg px-3 py-2 text-sm font-bold text-[var(--text-heading)]">
            {status}
          </div>
        )}

        <div className="overflow-x-auto border border-[var(--border-default)] rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-muted-nav)] text-[var(--text-muted)]">
              <tr>
                <th className="p-3 text-right">Chat ID</th>
                <th className="p-3 text-right">الاسم</th>
                <th className="p-3 text-right">Username</th>
                <th className="p-3 text-right">نوع المحادثة</th>
                <th className="p-3 text-right">آخر رسالة</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3 text-right">مرتبط بـ</th>
                <th className="p-3 text-right">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {detectedChats.map((chat) => (
                <tr key={chat.chatId} className="border-t border-[var(--border-subtle)]">
                  <td className="p-3 font-mono text-[var(--ui-accent)]" dir="ltr">{chat.chatId}</td>
                  <td className="p-3 font-bold text-[var(--text-heading)]">{chat.telegramDisplayName}</td>
                  <td className="p-3 text-[var(--text-muted)]" dir="ltr">{chat.telegramUsername ? `@${chat.telegramUsername}` : '-'}</td>
                  <td className="p-3 text-[var(--text-muted)]">{chat.chatType || '-'}</td>
                  <td className="p-3 text-[var(--text-muted)] max-w-[220px] truncate">{chat.lastMessage || '-'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${chat.linked ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
                      {chat.linked ? 'مرتبط مسبقا' : 'جديد'}
                    </span>
                  </td>
                  <td className="p-3 text-[var(--text-heading)]">{chat.linkedTargetName ? `مرتبط مسبقاً بـ: ${chat.linkedTargetName}` : '-'}</td>
                  <td className="p-3">
                    {chat.linked && chat.linkId ? (
                      <button type="button" onClick={() => sendTest(chat.linkId!)} className="px-3 py-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-heading)] hover:bg-[var(--surface-muted-nav)]">إرسال اختبار</button>
                    ) : (
                      <button type="button" onClick={() => openLink(chat)} className="px-3 py-1.5 rounded-lg bg-[var(--ui-accent)] text-white">ربط</button>
                    )}
                  </td>
                </tr>
              ))}
              {detectedChats.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-[var(--text-muted)]">لا توجد محادثات مكتشفة بعد.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors space-y-4">
        <h3 className="text-lg font-bold text-[var(--text-heading)] flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-[var(--ui-accent)]" />
          سجل الروابط
        </h3>
        <div className="overflow-x-auto border border-[var(--border-default)] rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-muted-nav)] text-[var(--text-muted)]">
              <tr>
                <th className="p-3 text-right">الشخص</th>
                <th className="p-3 text-right">النوع</th>
                <th className="p-3 text-right">Chat ID</th>
                <th className="p-3 text-right">الفواتير</th>
                <th className="p-3 text-right">السندات</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3 text-right">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id} className="border-t border-[var(--border-subtle)]">
                  <td className="p-3 font-bold text-[var(--text-heading)]">{link.targetName}</td>
                  <td className="p-3 text-[var(--text-muted)]">{targetLabels[link.targetType]}</td>
                  <td className="p-3 font-mono text-[var(--ui-accent)]" dir="ltr">{link.chatId}</td>
                  <td className="p-3">{link.canReceiveInvoices ? 'نعم' : 'لا'}</td>
                  <td className="p-3">{link.canReceiveVouchers ? 'نعم' : 'لا'}</td>
                  <td className="p-3">{link.isActive ? 'نشط' : 'معطل'}</td>
                  <td className="p-3 flex gap-2">
                    <button type="button" onClick={() => sendTest(link.id)} className="px-3 py-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-heading)] hover:bg-[var(--surface-muted-nav)]"><Send className="w-4 h-4" /></button>
                    <button type="button" onClick={() => toggleLink(link)} className="px-3 py-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-heading)] hover:bg-[var(--surface-muted-nav)]">{link.isActive ? 'تعطيل' : 'تفعيل'}</button>
                  </td>
                </tr>
              ))}
              {links.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-[var(--text-muted)]">لا توجد روابط محفوظة.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {linkForm && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--surface-header)] rounded-xl shadow-xl w-full max-w-2xl overflow-hidden border border-[var(--border-default)]">
            <div className="px-6 py-4 border-b border-[var(--border-default)] flex justify-between items-center">
              <h3 className="font-bold text-lg text-[var(--text-heading)]">ربط محادثة تيليغرام</h3>
              <button type="button" onClick={() => setLinkForm(null)} className="text-[var(--text-muted)] hover:text-[var(--text-heading)]"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="font-bold text-sm text-[var(--text-heading)]">نوع الهدف</span>
                  <select
                    value={linkForm.targetType}
                    onChange={(event) => setLinkForm({ ...linkForm, targetType: event.target.value as TelegramTargetType, targetId: '', targetName: '' })}
                    className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`}
                  >
                    {Object.entries(targetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                {targetOptions.length > 0 ? (
                  <label className="space-y-2">
                    <span className="font-bold text-sm text-[var(--text-heading)]">اختيار الحساب</span>
                    <select
                      value={linkForm.targetId || ''}
                      onChange={(event) => {
                        const selected = targetOptions.find((item) => item.id === event.target.value);
                        setLinkForm({ ...linkForm, targetId: selected?.id || '', targetName: selected?.name || '' });
                      }}
                      className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`}
                    >
                      <option value="">اختر...</option>
                      {targetOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <label className="space-y-2">
                    <span className="font-bold text-sm text-[var(--text-heading)]">اسم الشخص</span>
                    <input
                      value={linkForm.targetName}
                      onChange={(event) => setLinkForm({ ...linkForm, targetName: event.target.value, targetId: '' })}
                      className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`}
                    />
                  </label>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                <label className="space-y-2">
                  <span className="font-bold text-sm text-[var(--text-heading)]">Telegram Chat ID</span>
                  <input
                    value={linkForm.chatId}
                    onChange={(event) => setLinkForm({ ...linkForm, chatId: event.target.value })}
                    placeholder="اضغط جلب ID بعد أن يرسل العميل اسمه للبوت"
                    className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg text-[var(--text-heading)] ${ringCls}`}
                    dir="ltr"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void fillLatestDetectedChat()}
                  disabled={loading || !settings?.hasToken}
                  className="px-4 py-2.5 bg-sky-600 text-white rounded-lg flex items-center gap-2 hover:bg-sky-700 disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  جلب ID
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  ['canReceiveInvoices', 'الفواتير'],
                  ['canReceiveVouchers', 'السندات'],
                  ['canReceiveReports', 'التقارير'],
                  ['canReceiveAlerts', 'التنبيهات'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-2 p-3 border border-[var(--border-default)] rounded-lg text-sm font-bold text-[var(--text-heading)]">
                    {label}
                    <input
                      type="checkbox"
                      checked={Boolean(linkForm[key as keyof TelegramLinkPayload])}
                      onChange={(event) => setLinkForm({ ...linkForm, [key]: event.target.checked })}
                      className="accent-[var(--ui-accent)]"
                    />
                  </label>
                ))}
              </div>
              <label className="space-y-2 block">
                <span className="font-bold text-sm text-[var(--text-heading)]">ملاحظات</span>
                <textarea
                  rows={2}
                  value={linkForm.notes || ''}
                  onChange={(event) => setLinkForm({ ...linkForm, notes: event.target.value })}
                  className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setLinkForm(null)} className="px-4 py-2 border border-[var(--border-default)] rounded-lg text-[var(--text-heading)]">إلغاء</button>
                <button type="button" onClick={saveLink} disabled={loading || !linkForm.targetName || !linkForm.chatId} className="px-4 py-2 bg-[var(--ui-accent)] text-white rounded-lg disabled:opacity-60">حفظ الربط</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
