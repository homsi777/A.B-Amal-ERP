import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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

const getTargetLabels = (t: TFunction): Record<TelegramTargetType, string> => ({
  USER: t('telegramBot.targetUser'),
  CUSTOMER: t('telegramBot.targetCustomer'),
  SUPPLIER: t('telegramBot.targetSupplier'),
  EMPLOYEE: t('telegramBot.targetEmployee'),
  OTHER: t('telegramBot.targetOther'),
});

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
  const { t } = useTranslation('settings');
  const targetLabels = useMemo(() => getTargetLabels(t), [t]);
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
    setStatus(t('telegramBot.savingSettings'));
    try {
      const saved = await updateTelegramSettings({ botToken: botToken.trim() || undefined, isEnabled: isEnabled || Boolean(botToken.trim()) });
      setSettings(saved);
      setBotToken('');
      setStatus(saved.purchaseMessage || t('telegramBot.purchaseMessageFallback'));
      setStatus(t('telegramBot.saveSuccess'));
      setStatus(saved.purchaseMessage || t('telegramBot.purchaseMessageFallback'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('telegramBot.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  const testBot = async () => {
    setLoading(true);
    setStatus(t('telegramBot.testing'));
    try {
      const bot = await testTelegramBot();
      setStatus(t('telegramBot.connectedTo', { identity: bot.username ? `@${bot.username}` : bot.first_name || bot.id }));
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('telegramBot.testFailed'));
    } finally {
      setLoading(false);
    }
  };

  const fetchChats = async () => {
    setLoading(true);
    setStatus(t('telegramBot.fetchingChats'));
    try {
      const rows = await fetchTelegramUpdates();
      setDetectedChats(rows);
      setStatus(rows.length ? t('telegramBot.fetchedCount', { count: rows.length }) : t('telegramBot.noNewChatsSendFirst'));
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('telegramBot.fetchChatsFailed'));
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
    setStatus(t('telegramBot.manualCustomerHint'));
  };

  const fillLatestDetectedChat = async () => {
    if (!linkForm) return;
    setLoading(true);
    try {
      const rows = await fetchTelegramUpdates();
      setDetectedChats(rows);
      const candidate = rows.find((chat) => !chat.linked) || rows[0];
      if (!candidate) {
        setStatus(t('telegramBot.noIdReadyHint'));
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
      setStatus(t('telegramBot.fetchedId', { chatId: candidate.chatId, displayName: candidate.telegramDisplayName }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('telegramBot.fetchIdFailed'));
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
      setStatus(t('telegramBot.linkSaved'));
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('telegramBot.linkSaveFailed'));
    } finally {
      setLoading(false);
    }
  };

  const sendTest = async (linkId: string) => {
    setLoading(true);
    try {
      await sendTelegramTestMessage(linkId);
      setStatus(t('telegramBot.testMessageSent'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('telegramBot.testMessageFailed'));
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
              {t('telegramBot.title')}
            </h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {t('telegramBot.description')}
            </p>
          </div>
          {settings?.hasToken && (
            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
              {t('telegramBot.tokenSavedBadge', { tokenMasked: settings.tokenMasked })}
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
              placeholder={t('telegramBot.tokenPlaceholder')}
              className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg text-[var(--text-heading)] ${ringCls}`}
              dir="ltr"
            />
          </label>
          <label className="flex items-center justify-between gap-3 p-4 border border-[var(--border-default)] rounded-xl">
            <span className="font-bold text-[var(--text-heading)]">{t('telegramBot.enableBot')}</span>
            <input type="checkbox" checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} className="w-5 h-5 accent-[var(--ui-accent)]" />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={saveSettings} disabled={loading} className="bg-[var(--ui-accent)] text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:opacity-95 transition disabled:opacity-60">
            <Check className="w-4 h-4" />
            {t('telegramBot.saveSettingsButton')}
          </button>
          <button type="button" onClick={testBot} disabled={loading || !settings?.hasToken} className="bg-[var(--surface-header)] border border-[var(--border-default)] text-[var(--text-heading)] px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-[var(--surface-muted-nav)] transition disabled:opacity-60">
            <MessageCircle className="w-4 h-4" />
            {t('telegramBot.testBotButton')}
          </button>
          {loading && <Loader2 className="w-5 h-5 animate-spin text-[var(--ui-accent)] self-center" />}
        </div>
      </div>

      <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-bold text-[var(--text-heading)]">{t('telegramBot.fetchChatIdTitle')}</h3>
            <p className="text-sm text-[var(--text-muted)]">{t('telegramBot.fetchChatIdDescription')}</p>
          </div>
          <button type="button" onClick={openManualCustomerLink} disabled={loading || !settings?.hasToken} className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition disabled:opacity-60">
            <Plus className="w-4 h-4" />
            {t('telegramBot.addCustomerButton')}
          </button>
          <button type="button" onClick={fetchChats} disabled={loading || !settings?.hasToken} className="bg-[var(--ui-accent)] text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:opacity-95 transition disabled:opacity-60">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {t('telegramBot.fetchChatIdAutoButton')}
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
                <th className="p-3 text-right">{t('telegramBot.colName')}</th>
                <th className="p-3 text-right">Username</th>
                <th className="p-3 text-right">{t('telegramBot.colChatType')}</th>
                <th className="p-3 text-right">{t('telegramBot.colLastMessage')}</th>
                <th className="p-3 text-right">{t('telegramBot.colStatus')}</th>
                <th className="p-3 text-right">{t('telegramBot.colLinkedWith')}</th>
                <th className="p-3 text-right">{t('telegramBot.colAction')}</th>
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
                      {chat.linked ? t('telegramBot.linkedAlready') : t('telegramBot.newChat')}
                    </span>
                  </td>
                  <td className="p-3 text-[var(--text-heading)]">{chat.linkedTargetName ? t('telegramBot.linkedWithPrefix', { name: chat.linkedTargetName }) : '-'}</td>
                  <td className="p-3">
                    {chat.linked && chat.linkId ? (
                      <button type="button" onClick={() => sendTest(chat.linkId!)} className="px-3 py-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-heading)] hover:bg-[var(--surface-muted-nav)]">{t('telegramBot.sendTestButton')}</button>
                    ) : (
                      <button type="button" onClick={() => openLink(chat)} className="px-3 py-1.5 rounded-lg bg-[var(--ui-accent)] text-white">{t('telegramBot.linkButton')}</button>
                    )}
                  </td>
                </tr>
              ))}
              {detectedChats.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-[var(--text-muted)]">{t('telegramBot.noDetectedChats')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors space-y-4">
        <h3 className="text-lg font-bold text-[var(--text-heading)] flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-[var(--ui-accent)]" />
          {t('telegramBot.linksLogTitle')}
        </h3>
        <div className="overflow-x-auto border border-[var(--border-default)] rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-muted-nav)] text-[var(--text-muted)]">
              <tr>
                <th className="p-3 text-right">{t('telegramBot.colPerson')}</th>
                <th className="p-3 text-right">{t('telegramBot.colType')}</th>
                <th className="p-3 text-right">Chat ID</th>
                <th className="p-3 text-right">{t('telegramBot.colInvoices')}</th>
                <th className="p-3 text-right">{t('telegramBot.colVouchers')}</th>
                <th className="p-3 text-right">{t('telegramBot.colStatus')}</th>
                <th className="p-3 text-right">{t('telegramBot.colAction')}</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id} className="border-t border-[var(--border-subtle)]">
                  <td className="p-3 font-bold text-[var(--text-heading)]">{link.targetName}</td>
                  <td className="p-3 text-[var(--text-muted)]">{targetLabels[link.targetType]}</td>
                  <td className="p-3 font-mono text-[var(--ui-accent)]" dir="ltr">{link.chatId}</td>
                  <td className="p-3">{link.canReceiveInvoices ? t('telegramBot.yes') : t('telegramBot.no')}</td>
                  <td className="p-3">{link.canReceiveVouchers ? t('telegramBot.yes') : t('telegramBot.no')}</td>
                  <td className="p-3">{link.isActive ? t('telegramBot.active') : t('telegramBot.inactive')}</td>
                  <td className="p-3 flex gap-2">
                    <button type="button" onClick={() => sendTest(link.id)} className="px-3 py-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-heading)] hover:bg-[var(--surface-muted-nav)]"><Send className="w-4 h-4" /></button>
                    <button type="button" onClick={() => toggleLink(link)} className="px-3 py-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-heading)] hover:bg-[var(--surface-muted-nav)]">{link.isActive ? t('telegramBot.disableButton') : t('telegramBot.enableButton')}</button>
                  </td>
                </tr>
              ))}
              {links.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-[var(--text-muted)]">{t('telegramBot.noLinksSaved')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {linkForm && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--surface-header)] rounded-xl shadow-xl w-full max-w-2xl overflow-hidden border border-[var(--border-default)]">
            <div className="px-6 py-4 border-b border-[var(--border-default)] flex justify-between items-center">
              <h3 className="font-bold text-lg text-[var(--text-heading)]">{t('telegramBot.linkModalTitle')}</h3>
              <button type="button" onClick={() => setLinkForm(null)} className="text-[var(--text-muted)] hover:text-[var(--text-heading)]"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="font-bold text-sm text-[var(--text-heading)]">{t('telegramBot.targetTypeLabel')}</span>
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
                    <span className="font-bold text-sm text-[var(--text-heading)]">{t('telegramBot.selectAccountLabel')}</span>
                    <select
                      value={linkForm.targetId || ''}
                      onChange={(event) => {
                        const selected = targetOptions.find((item) => item.id === event.target.value);
                        setLinkForm({ ...linkForm, targetId: selected?.id || '', targetName: selected?.name || '' });
                      }}
                      className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`}
                    >
                      <option value="">{t('telegramBot.selectPlaceholder')}</option>
                      {targetOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <label className="space-y-2">
                    <span className="font-bold text-sm text-[var(--text-heading)]">{t('telegramBot.personNameLabel')}</span>
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
                    placeholder={t('telegramBot.chatIdPlaceholder')}
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
                  {t('telegramBot.fetchIdButton')}
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  ['canReceiveInvoices', t('telegramBot.colInvoices')],
                  ['canReceiveVouchers', t('telegramBot.colVouchers')],
                  ['canReceiveReports', t('telegramBot.reportsLabel')],
                  ['canReceiveAlerts', t('telegramBot.alertsLabel')],
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
                <span className="font-bold text-sm text-[var(--text-heading)]">{t('telegramBot.notesLabel')}</span>
                <textarea
                  rows={2}
                  value={linkForm.notes || ''}
                  onChange={(event) => setLinkForm({ ...linkForm, notes: event.target.value })}
                  className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setLinkForm(null)} className="px-4 py-2 border border-[var(--border-default)] rounded-lg text-[var(--text-heading)]">{t('telegramBot.cancelButton')}</button>
                <button type="button" onClick={saveLink} disabled={loading || !linkForm.targetName || !linkForm.chatId} className="px-4 py-2 bg-[var(--ui-accent)] text-white rounded-lg disabled:opacity-60">{t('telegramBot.saveLinkButton')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
