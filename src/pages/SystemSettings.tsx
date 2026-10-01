import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Settings,
  Building2,
  Receipt,
  ShieldCheck,
  Mail,
  Database,
  Download,
  Save,
  Sparkles,
  AlertTriangle,
  Construction,
  Monitor,
  Users,
  UserPlus,
  KeyRound,
  RefreshCw,
  Bot,
  MessageCircle,
  Pencil,
  X,
  Wifi,
} from 'lucide-react';
import { ThemeDisplaySettings } from '../components/settings/ThemeDisplaySettings';
import { TelegramBotSettingsPanel } from '../components/settings/TelegramBotSettingsPanel';
import { AiAssistantSettingsPanel } from '../components/settings/AiAssistantSettingsPanel';
import { ActiveDevicesPanel } from '../components/settings/ActiveDevicesPanel';
import { ActivationSettingsPanel } from '../components/activation/ActivationSettingsPanel';
import { DesktopSettingsBody } from './settings/DesktopSettings';
import {
  createSystemUser,
  downloadDatabaseBackupToDevice,
  fetchTelegramUpdates,
  getPermissionsOverview,
  getSystemSettings,
  listSystemUsers,
  purgeBusinessData,
  saveRolePermissions,
  saveSystemSetting,
  testTelegramBot,
  updateSystemUser,
  type ApiPermission,
  type ApiRole,
  type ApiRolePermission,
  type ApiUser,
  type TelegramChatCandidate,
} from '../lib/api/settingsApi';
import { fetchMe, type AuthUser } from '../lib/api/authApi';
import { listCompanies, type ApiCompany } from '../lib/api/companiesApi';
import { CompanyManagementPanel } from '../components/companies/CompanyManagementPanel';
import { listExchangeRates, updateExchangeRate, type ExchangeRateDto, type SupportedCurrencyCode } from '../lib/api/exchangeRatesApi';
import { useToast } from '../components/NonBlockingToast';
import { useTranslation } from 'react-i18next';

type SettingsSectionId = 'company' | 'general' | 'desktop' | 'invoice' | 'users' | 'mail' | 'ai' | 'activation' | 'companies' | 'backup' | 'themes' | 'stub' | 'activeDevices';

type NavRow = {
  navKey: string;
  section: SettingsSectionId;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV_ITEMS: NavRow[] = [
  { navKey: 'company', section: 'company', labelKey: 'nav.company', icon: Building2 },
  { navKey: 'general', section: 'general', labelKey: 'nav.general', icon: Settings },
  { navKey: 'desktop', section: 'desktop', labelKey: 'nav.desktop', icon: Monitor },
  { navKey: 'invoice', section: 'invoice', labelKey: 'nav.invoice', icon: Receipt },
  { navKey: 'users',   section: 'users',   labelKey: 'nav.users', icon: ShieldCheck },
  { navKey: 'activeDevices', section: 'activeDevices', labelKey: 'nav.activeDevices', icon: Wifi },
  { navKey: 'mail',    section: 'mail',    labelKey: 'nav.mail', icon: Mail },
  { navKey: 'ai',      section: 'ai',      labelKey: 'nav.ai', icon: Bot },
  { navKey: 'backup',  section: 'backup',  labelKey: 'nav.backup', icon: Database },
  { navKey: 'themes',  section: 'themes',  labelKey: 'nav.themes', icon: Sparkles },
];

const VALID_NAV_KEYS = [...NAV_ITEMS.map((row) => row.navKey), 'activation'];

const defaultSettings = {
  general: {
    language: 'ar-SY',
    timezone: 'Asia/Damascus',
    lowStockThreshold: '10',
    autoSaveDrafts: true,
    requireWarehouseOnSales: true,
  },
  invoice: {
    invoicePrefix: 'INV',
    purchasePrefix: 'PUR',
    vatRate: '0',
    showQrOnInvoice: true,
    allowNegativeStock: false,
  },
  mail: {
    senderName: 'CLOTEX',
    senderEmail: 'info@clotex.local',
    smtpHost: '',
    smtpPort: '587',
    telegramEnabled: true,
    telegramBotToken: '',
    telegramTestChatId: '',
    telegramSendInvoices: true,
    telegramSendPayments: true,
    telegramBotTokenMasked: '',
    telegramBotTokenConfigured: false,
  },
  backup: {
    autoBackup: true,
    backupTime: '23:00',
    retentionDays: '14',
    backupPath: '',
  },
};

export const SystemSettings = () => {
  const { t } = useTranslation('settings');
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
  const tabParam = searchParams.get('tab');
  const initialKey = tabParam && VALID_NAV_KEYS.includes(tabParam) ? tabParam : 'company';
  const [activeNavKey, setActiveNavKey] = useState(initialKey);
  const [settingsValues, setSettingsValues] = useState(defaultSettings);
  const [settingsStatus, setSettingsStatus] = useState('');
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [roles, setRoles] = useState<ApiRole[]>([]);
  const [permissions, setPermissions] = useState<ApiPermission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<ApiRolePermission[]>([]);
  const [selectedRole, setSelectedRole] = useState('viewer');
  const [userForm, setUserForm] = useState({
    username: '',
    fullName: '',
    password: '',
    role: 'viewer',
    isActive: true,
    notes: '',
  });
  const [companies, setCompanies] = useState<ApiCompany[]>([]);
  /** الفرع المختار أعلى قسم "المستخدمين والصلاحيات" — يتحكم بكل من عرض القائمة وإنشاء مستخدم جديد. لمدير المنصة فقط؛ لغيره يبقى حساب المستخدم نفسه دائماً. */
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [editUserForm, setEditUserForm] = useState({
    username: '',
    fullName: '',
    password: '',
    role: 'viewer',
    isActive: true,
    notes: '',
  });
  const [editUserSaving, setEditUserSaving] = useState(false);
  const [editUserError, setEditUserError] = useState('');
  const [telegramStatus, setTelegramStatus] = useState('');
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramUpdates, setTelegramUpdates] = useState<TelegramChatCandidate[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateDto[]>([]);
  const [exchangeRatesDraft, setExchangeRatesDraft] = useState<Record<string, { rate: string; isActive: boolean }>>({});
  const [exchangeRatesLoading, setExchangeRatesLoading] = useState(false);
  const [exchangeRatesSaving, setExchangeRatesSaving] = useState<Record<string, boolean>>({});
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [purgeAcknowledged, setPurgeAcknowledged] = useState(false);
  const [purgeConfirmPhrase, setPurgeConfirmPhrase] = useState('');
  const [purgePassword, setPurgePassword] = useState('');
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [backupDownloadLoading, setBackupDownloadLoading] = useState(false);

  // Sync active tab when URL ?tab= changes (e.g., redirected from /settings/desktop)
  useEffect(() => {
    if (tabParam && VALID_NAV_KEYS.includes(tabParam) && tabParam !== activeNavKey) {
      setActiveNavKey(tabParam);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  const handleNavClick = (key: string) => {
    setActiveNavKey(key);
    const next = new URLSearchParams(searchParams);
    if (key === 'company') next.delete('tab'); else next.set('tab', key);
    setSearchParams(next, { replace: true });
  };

  const activeSection: SettingsSectionId = activeNavKey === 'activation'
    ? 'activation'
    : NAV_ITEMS.find((row) => row.navKey === activeNavKey)?.section ?? 'company';

  useEffect(() => {
    if (activeSection !== 'company') return;
    let cancelled = false;
    setExchangeRatesLoading(true);
    void (async () => {
      try {
        const res = await listExchangeRates();
        if (cancelled) return;
        setExchangeRates(res.data);
        setExchangeRatesDraft(
          Object.fromEntries(
            res.data.map((row) => [row.currency_code, { rate: String(row.exchange_rate_to_usd ?? '1'), isActive: Boolean(row.is_active) }]),
          ),
        );
      } catch (e) {
        if (!cancelled) showToast({ type: 'error', message: e instanceof Error ? e.message : t('toast.exchangeRatesLoadFailed') });
      } finally {
        if (!cancelled) setExchangeRatesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSection, showToast]);

  useEffect(() => {
    let cancelled = false;
    void fetchMe()
      .then((user) => {
        if (!cancelled) {
          setCurrentUser(user);
          setSelectedBranchId((prev) => prev || user.companyId);
        }
      })
      .catch(() => {
        if (!cancelled) setCurrentUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentUser?.isPlatformAdmin) return;
    let cancelled = false;
    void listCompanies()
      .then((rows) => {
        if (!cancelled) setCompanies(rows);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.isPlatformAdmin]);

  const handlePurgeBusinessData = async () => {
    if (currentUser?.role !== 'admin') {
      showToast({ type: 'error', message: t('toast.purgeAdminOnly') });
      return;
    }
    if (!purgeAcknowledged) {
      showToast({ type: 'warning', message: t('toast.purgeNeedsAck') });
      return;
    }
    if (purgeConfirmPhrase.trim() !== 'مسح البيانات') {
      showToast({ type: 'warning', message: t('toast.purgeNeedsExactPhrase') });
      return;
    }
    if (!purgePassword.trim()) {
      showToast({ type: 'warning', message: t('toast.purgeNeedsPassword') });
      return;
    }

    setPurgeLoading(true);
    try {
      const summary = await purgeBusinessData({
        confirmPhrase: 'مسح البيانات',
        password: purgePassword,
      });
      const totalRows = Object.values(summary.tables).reduce((sum, count) => sum + count, 0);
      showToast({
        type: 'success',
        message: t('toast.purgeSuccess', { count: totalRows }),
      });
      setPurgeAcknowledged(false);
      setPurgeConfirmPhrase('');
      setPurgePassword('');
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('toast.purgeFailed') });
    } finally {
      setPurgeLoading(false);
    }
  };

  const handleDownloadBackupToDevice = async () => {
    setBackupDownloadLoading(true);
    try {
      const result = await downloadDatabaseBackupToDevice();
      const sizeMb = (result.sizeBytes / (1024 * 1024)).toFixed(2);
      showToast({
        type: 'success',
        message: t('toast.backupDownloaded', { fileName: result.fileName, sizeMb }),
      });
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof Error ? e.message : t('toast.backupFailed'),
      });
    } finally {
      setBackupDownloadLoading(false);
    }
  };

  const saveExchangeRateRow = async (currencyCode: SupportedCurrencyCode) => {
    const draft = exchangeRatesDraft[currencyCode];
    const rate = Number(String(draft?.rate ?? '').replace(/,/g, '').trim());
    if (!Number.isFinite(rate) || rate <= 0) {
      showToast({ type: 'warning', message: t('toast.exchangeRateInvalid') });
      return;
    }
    if (currencyCode === 'USD' && Math.abs(rate - 1) > 1e-9) {
      showToast({ type: 'warning', message: t('toast.exchangeRateUsdFixed') });
      return;
    }
    setExchangeRatesSaving((prev) => ({ ...prev, [currencyCode]: true }));
    try {
      const res = await updateExchangeRate(currencyCode, { exchangeRateToUsd: rate, isActive: draft?.isActive });
      setExchangeRates((prev) => prev.map((x) => (x.currency_code === currencyCode ? res.data : x)));
      setExchangeRatesDraft((prev) => ({
        ...prev,
        [currencyCode]: { rate: String(res.data.exchange_rate_to_usd), isActive: Boolean(res.data.is_active) },
      }));
      showToast({ type: 'success', message: t('toast.exchangeRateSaved') });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : t('toast.exchangeRateSaveFailed') });
    } finally {
      setExchangeRatesSaving((prev) => ({ ...prev, [currencyCode]: false }));
    }
  };

  const ringCls = 'focus:outline-none focus:ring-2 focus:ring-[var(--ui-accent)]';

  const loadUsers = async (branchId?: string) => {
    setUsersLoading(true);
    try {
      const usersRows = await listSystemUsers(branchId || undefined);
      setUsers(usersRows);
    } catch {
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedBranchId) return;
    void loadUsers(currentUser?.isPlatformAdmin ? selectedBranchId : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId, currentUser?.isPlatformAdmin]);

  const loadSystemAdministration = async () => {
    try {
      const [savedSettings, permissionsOverview] = await Promise.all([
        getSystemSettings().catch(() => ({})),
        getPermissionsOverview().catch(() => ({ roles: [], permissions: [], rolePermissions: [] })),
      ]);

      setSettingsValues((current) => ({
        ...current,
        ...Object.fromEntries(
          Object.entries(savedSettings).filter(([key]) => key in current),
        ) as typeof defaultSettings,
      }));
      setRoles(permissionsOverview.roles);
      setPermissions(permissionsOverview.permissions);
      setRolePermissions(permissionsOverview.rolePermissions);
      if (permissionsOverview.roles[0]?.code && !permissionsOverview.roles.some((role) => role.code === selectedRole)) {
        setSelectedRole(permissionsOverview.roles[0].code);
      }
    } catch {
      setSettingsStatus(t('status.loadSettingsFailed'));
    }
  };

  useEffect(() => {
    loadSystemAdministration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSetting = (
    section: keyof typeof defaultSettings,
    key: string,
    value: string | boolean,
  ) => {
    setSettingsValues((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [key]: value,
      },
    }));
  };

  const handleSaveAll = async () => {
    setSettingsStatus(t('status.saving'));
    try {
      await Promise.all(
        Object.entries(settingsValues).map(([key, value]) => saveSystemSetting(key, value as Record<string, unknown>)),
      );
      setSettingsStatus(t('status.saved'));
    } catch {
      localStorage.setItem('fabric_erp_system_settings_draft', JSON.stringify(settingsValues));
      setSettingsStatus(t('status.saveFailedLocal'));
    }
  };

  const rolePermissionSet = new Set<string>(
    rolePermissions.filter((item) => item.role_code === selectedRole).map((item) => item.permission_code),
  );

  const toggleRolePermission = async (permissionCode: string) => {
    const role = roles.find((item) => item.code === selectedRole);
    if (!role) return;
    const next = new Set<string>(rolePermissionSet);
    if (next.has(permissionCode)) next.delete(permissionCode); else next.add(permissionCode);
    const permissionCodes = Array.from(next);
    await saveRolePermissions(selectedRole, { name: role.name, permissionCodes });
    setRolePermissions((current) => [
      ...current.filter((item) => item.role_code !== selectedRole),
      ...permissionCodes.map((code) => ({ role_code: selectedRole, permission_code: code })),
    ]);
  };

  const handleCreateUser = async () => {
    if (!userForm.username || !userForm.password) return;
    try {
      const created = await createSystemUser({
        ...userForm,
        companyId: currentUser?.isPlatformAdmin && selectedBranchId ? selectedBranchId : undefined,
      });
      setUsers((current) => [created, ...current]);
      setUserForm({ username: '', fullName: '', password: '', role: userForm.role, isActive: true, notes: '' });
      showToast({ message: t('toast.userCreated'), type: 'success' });
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : t('toast.userCreateFailed'),
        type: 'error',
      });
    }
  };

  const openEditUser = (user: ApiUser) => {
    setEditingUser(user);
    setEditUserForm({
      username: user.username,
      fullName: user.full_name || '',
      password: '',
      role: user.role,
      isActive: user.is_active,
      notes: user.notes || '',
    });
    setEditUserError('');
  };

  const closeEditUser = () => {
    setEditingUser(null);
    setEditUserError('');
  };

  const handleUpdateUser = async () => {
    if (!editingUser || !editUserForm.username.trim()) return;
    setEditUserSaving(true);
    setEditUserError('');
    try {
      const updated = await updateSystemUser(editingUser.id, {
        username: editUserForm.username.trim(),
        fullName: editUserForm.fullName.trim(),
        role: editUserForm.role,
        isActive: editUserForm.isActive,
        notes: editUserForm.notes.trim(),
        ...(editUserForm.password.trim() ? { password: editUserForm.password } : {}),
      });
      setUsers((current) => current.map((user) => (user.id === updated.id ? updated : user)));
      showToast({ message: t('toast.userUpdated'), type: 'success' });
      closeEditUser();
    } catch (error) {
      setEditUserError(error instanceof Error ? error.message : t('toast.userUpdateFailed'));
    } finally {
      setEditUserSaving(false);
    }
  };

  const handleTelegramTest = async () => {
    setTelegramLoading(true);
    setTelegramStatus('جاري اختبار بوت تيليغرام...');
    try {
      const bot = await testTelegramBot({
        botToken: String(settingsValues.mail.telegramBotToken || ''),
        chatId: String(settingsValues.mail.telegramTestChatId || ''),
      });
      setTelegramStatus(`تم الاتصال بالبوت بنجاح: ${bot.username ? `@${bot.username}` : bot.first_name || bot.id}`);
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : 'فشل اختبار تيليغرام');
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleFetchTelegramUpdates = async () => {
    setTelegramLoading(true);
    setTelegramStatus('جاري جلب آخر المحادثات من تيليغرام...');
    try {
      const updates = await fetchTelegramUpdates();
      setTelegramUpdates(updates);
      setTelegramStatus(updates.length ? `تم جلب ${updates.length} محادثة.` : 'لا توجد محادثات جديدة.');
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : 'فشل جلب محادثات تيليغرام');
    } finally {
      setTelegramLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text-heading)]">{t('page.title')}</h2>
          <p className="text-[var(--text-muted)] mt-1">{t('page.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={handleSaveAll}
          className="bg-[var(--ui-accent)] text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:opacity-95 transition shadow-sm font-medium"
        >
          <Save className="w-4 h-4" />
          <span>{t('page.saveAll')}</span>
        </button>
      </div>
      {settingsStatus && (
        <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-bold text-[var(--text-heading)] shadow-sm">
          {settingsStatus}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="col-span-1 border border-[var(--border-default)] bg-[var(--surface-header)] rounded-xl shadow-sm overflow-hidden h-fit transition-colors">
          <ul className="flex flex-col">
            {NAV_ITEMS.map((item) => {
              const isActive = activeNavKey === item.navKey;

              return (
                <li key={item.navKey}>
                  <button
                    type="button"
                    onClick={() => handleNavClick(item.navKey)}
                    className={`w-full p-4 border-b border-[var(--border-subtle)] cursor-pointer flex items-center gap-3 text-right transition-colors ${
                      isActive
                        ? 'bg-[var(--ui-accent-soft-bg)] border-r-4 border-r-[var(--ui-accent)]'
                        : 'hover:bg-[var(--surface-muted-nav)]'
                    }`}
                  >
                    <item.icon
                      className={`w-5 h-5 shrink-0 ${isActive ? 'text-[var(--ui-accent)]' : 'text-[var(--text-muted)]'}`}
                    />
                    <span className={`font-medium ${isActive ? 'font-bold text-[var(--ui-accent)]' : 'text-[var(--text-heading)]'}`}>
                      {t(item.labelKey)}
                    </span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={() => handleNavClick('activation')}
                className={`w-full p-4 border-b border-[var(--border-subtle)] cursor-pointer flex items-center gap-3 text-right transition-colors ${
                  activeNavKey === 'activation'
                    ? 'bg-[var(--ui-accent-soft-bg)] border-r-4 border-r-[var(--ui-accent)]'
                    : 'hover:bg-[var(--surface-muted-nav)]'
                }`}
              >
                <KeyRound
                  className={`w-5 h-5 shrink-0 ${activeNavKey === 'activation' ? 'text-[var(--ui-accent)]' : 'text-[var(--text-muted)]'}`}
                />
                <span className={`font-medium ${activeNavKey === 'activation' ? 'font-bold text-[var(--ui-accent)]' : 'text-[var(--text-heading)]'}`}>
                  {t('nav.activation')}
                </span>
              </button>
            </li>
          </ul>
        </div>

        <div className="col-span-1 md:col-span-3 space-y-6">
          {activeSection === 'themes' && (
            <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors">
              <ThemeDisplaySettings />
            </div>
          )}

          {activeSection === 'desktop' && (
            <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors">
              <DesktopSettingsBody />
            </div>
          )}

          {activeSection === 'stub' && (
            <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-10 text-center space-y-4">
              <Construction className="w-14 h-14 mx-auto text-[var(--text-muted)] opacity-70" />
              <h3 className="text-xl font-bold text-[var(--text-heading)]">{t('stub.title')}</h3>
              <p className="text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
                {t('stub.body', { themesLabel: t('nav.themes') })}
              </p>
            </div>
          )}

          {activeSection === 'general' && (
            <SettingsPanel
              title={t('general.title')}
              description={t('general.description')}
              rows={[
                { label: t('general.defaultLanguage'), type: 'select', value: settingsValues.general.language, options: [['ar-SY', t('general.arabic')], ['en-US', 'English']], onChange: (value) => updateSetting('general', 'language', value) },
                { label: t('general.timezone'), type: 'text', value: settingsValues.general.timezone, onChange: (value) => updateSetting('general', 'timezone', value) },
                { label: t('general.lowStockThreshold'), type: 'number', value: settingsValues.general.lowStockThreshold, onChange: (value) => updateSetting('general', 'lowStockThreshold', value) },
                { label: t('general.autoSaveDrafts'), type: 'checkbox', value: settingsValues.general.autoSaveDrafts, onChange: (value) => updateSetting('general', 'autoSaveDrafts', value) },
                { label: t('general.requireWarehouseOnSale'), type: 'checkbox', value: settingsValues.general.requireWarehouseOnSales, onChange: (value) => updateSetting('general', 'requireWarehouseOnSales', value) },
              ]}
            />
          )}

          {activeSection === 'invoice' && (
            <SettingsPanel
              title={t('invoice.title')}
              description={t('invoice.description')}
              rows={[
                { label: t('invoice.salesPrefix'), type: 'text', value: settingsValues.invoice.invoicePrefix, onChange: (value) => updateSetting('invoice', 'invoicePrefix', value) },
                { label: t('invoice.purchasePrefix'), type: 'text', value: settingsValues.invoice.purchasePrefix, onChange: (value) => updateSetting('invoice', 'purchasePrefix', value) },
                { label: t('invoice.taxRate'), type: 'number', value: settingsValues.invoice.vatRate, onChange: (value) => updateSetting('invoice', 'vatRate', value) },
                { label: t('invoice.showQr'), type: 'checkbox', value: settingsValues.invoice.showQrOnInvoice, onChange: (value) => updateSetting('invoice', 'showQrOnInvoice', value) },
                { label: t('invoice.allowNegativeStock'), type: 'checkbox', value: settingsValues.invoice.allowNegativeStock, onChange: (value) => updateSetting('invoice', 'allowNegativeStock', value) },
              ]}
            />
          )}

          {false && activeSection === 'mail' && (
            <SettingsPanel
              title="إعدادات المراسلة"
              description="بيانات البريد والإرسال الخارجي مع إبقاء الأسرار خارج الواجهة."
              rows={[
                { label: 'اسم المرسل', type: 'text', value: settingsValues.mail.senderName, onChange: (value) => updateSetting('mail', 'senderName', value) },
                { label: 'بريد المرسل', type: 'text', value: settingsValues.mail.senderEmail, onChange: (value) => updateSetting('mail', 'senderEmail', value) },
                { label: 'SMTP Host', type: 'text', value: settingsValues.mail.smtpHost, onChange: (value) => updateSetting('mail', 'smtpHost', value) },
                { label: 'SMTP Port', type: 'number', value: settingsValues.mail.smtpPort, onChange: (value) => updateSetting('mail', 'smtpPort', value) },
                { label: 'تفعيل تيليغرام للتنبيهات', type: 'checkbox', value: settingsValues.mail.telegramEnabled, onChange: (value) => updateSetting('mail', 'telegramEnabled', value) },
              ]}
            />
          )}

          {false && activeSection === 'mail' && (
            <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors space-y-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-xl font-bold text-[var(--text-heading)] flex items-center gap-2">
                    <Bot className="w-5 h-5 text-[var(--ui-accent)]" />
                    بوت تيليغرام
                  </h3>
                  <p className="text-sm text-[var(--text-muted)] mt-1">
                    احفظ التوكن، ثم اطلب من العميل أو المورد إرسال رسالة للبوت، وبعدها اجلب Chat ID تلقائيا.
                  </p>
                </div>
                {settingsValues.mail.telegramBotTokenConfigured && (
                  <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                    التوكن محفوظ: {settingsValues.mail.telegramBotTokenMasked || 'مخفي'}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="font-bold text-[var(--text-heading)] text-sm">Bot Token</span>
                  <input
                    type="password"
                    value={String(settingsValues.mail.telegramBotToken || '')}
                    onChange={(event) => updateSetting('mail', 'telegramBotToken', event.target.value)}
                    placeholder={settingsValues.mail.telegramBotTokenConfigured ? 'اتركه فارغا للإبقاء على التوكن المحفوظ' : '123456:ABC...'}
                    className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg text-[var(--text-heading)] ${ringCls}`}
                    dir="ltr"
                  />
                </label>
                <label className="space-y-2">
                  <span className="font-bold text-[var(--text-heading)] text-sm">Chat ID للاختبار</span>
                  <input
                    type="text"
                    value={String(settingsValues.mail.telegramTestChatId || '')}
                    onChange={(event) => updateSetting('mail', 'telegramTestChatId', event.target.value)}
                    className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg text-[var(--text-heading)] ${ringCls}`}
                    dir="ltr"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <label className="flex items-center justify-between gap-3 p-3 border border-[var(--border-default)] rounded-lg">
                  <span className="font-bold text-sm text-[var(--text-heading)]">إرسال فواتير البيع PDF</span>
                  <input type="checkbox" checked={Boolean(settingsValues.mail.telegramSendInvoices)} onChange={(event) => updateSetting('mail', 'telegramSendInvoices', event.target.checked)} className="w-4 h-4 accent-[var(--ui-accent)]" />
                </label>
                <label className="flex items-center justify-between gap-3 p-3 border border-[var(--border-default)] rounded-lg">
                  <span className="font-bold text-sm text-[var(--text-heading)]">إرسال سندات القبض والدفع PDF</span>
                  <input type="checkbox" checked={Boolean(settingsValues.mail.telegramSendPayments)} onChange={(event) => updateSetting('mail', 'telegramSendPayments', event.target.checked)} className="w-4 h-4 accent-[var(--ui-accent)]" />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handleTelegramTest} disabled={telegramLoading} className="bg-[var(--ui-accent)] text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:opacity-95 transition disabled:opacity-60">
                  <MessageCircle className="w-4 h-4" />
                  اختبار البوت
                </button>
                <button type="button" onClick={handleFetchTelegramUpdates} disabled={telegramLoading} className="bg-[var(--surface-header)] border border-[var(--border-default)] text-[var(--text-heading)] px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-[var(--surface-muted-nav)] transition disabled:opacity-60">
                  <RefreshCw className={`w-4 h-4 ${telegramLoading ? 'animate-spin' : ''}`} />
                  جلب Chat ID تلقائيا
                </button>
              </div>

              {telegramStatus && (
                <div className="border border-[var(--border-default)] bg-[var(--surface-muted-nav)] rounded-lg px-3 py-2 text-sm font-bold text-[var(--text-heading)]">
                  {telegramStatus}
                </div>
              )}

              {telegramUpdates.length > 0 && (
                <div className="border border-[var(--border-default)] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-[var(--surface-muted-nav)] border-b border-[var(--border-default)] font-bold text-[var(--text-heading)]">
                    آخر المحادثات الواردة للبوت
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--surface-muted-nav)] text-[var(--text-muted)]">
                        <tr>
                          <th className="p-3 text-right">الاسم</th>
                          <th className="p-3 text-right">Chat ID</th>
                          <th className="p-3 text-right">Username</th>
                          <th className="p-3 text-right">آخر رسالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {telegramUpdates.map((chat) => (
                          <tr key={chat.chatId} className="border-t border-[var(--border-subtle)]">
                            <td className="p-3 font-bold text-[var(--text-heading)]">{chat.name}</td>
                            <td className="p-3 font-mono text-[var(--ui-accent)]" dir="ltr">{chat.chatId}</td>
                            <td className="p-3 text-[var(--text-muted)]" dir="ltr">{chat.username ? `@${chat.username}` : '-'}</td>
                            <td className="p-3 text-[var(--text-muted)] max-w-[260px] truncate">{chat.lastMessage || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeSection === 'mail' && <TelegramBotSettingsPanel />}
          {activeSection === 'ai' && <AiAssistantSettingsPanel />}

          {activeSection === 'activation' && <ActivationSettingsPanel />}

          {activeSection === 'backup' && (
            <div className="space-y-6">
              <SettingsPanel
                title={t('backup.title')}
                description={t('backup.description')}
                rows={[
                  { label: t('backup.autoBackup'), type: 'checkbox', value: settingsValues.backup.autoBackup, onChange: (value) => updateSetting('backup', 'autoBackup', value) },
                  { label: t('backup.dailyTime'), type: 'text', value: settingsValues.backup.backupTime, onChange: (value) => updateSetting('backup', 'backupTime', value) },
                  { label: t('backup.retentionDays'), type: 'number', value: settingsValues.backup.retentionDays, onChange: (value) => updateSetting('backup', 'retentionDays', value) },
                  { label: t('backup.localPath'), type: 'text', value: settingsValues.backup.backupPath, onChange: (value) => updateSetting('backup', 'backupPath', value) },
                ]}
              />

              <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <Download className="w-6 h-6 text-[var(--ui-accent)] shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-xl font-bold text-[var(--text-heading)]">{t('backup.manualTitle')}</h3>
                    <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
                      {t('backup.manualBody')}

                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={backupDownloadLoading}
                  onClick={() => void handleDownloadBackupToDevice()}
                  className="inline-flex items-center justify-center gap-2 bg-[var(--ui-accent)] text-white px-5 py-2.5 rounded-lg font-bold hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  <Download className="w-4 h-4" />
                  {backupDownloadLoading ? t('backup.downloading') : t('backup.downloadNow')}
                </button>
              </div>

              {currentUser?.role === 'admin' && (
                <div className="bg-[var(--surface-header)] border-2 border-red-300 dark:border-red-800 rounded-xl shadow-sm p-6 space-y-5">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-xl font-bold text-red-700 dark:text-red-400">{t('purge.title')}</h3>
                      <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
                        {t('purge.explanation')}


                        <strong className="block mt-2 text-red-700 dark:text-red-400">{t('purge.irreversible')}</strong>
                      </p>
                    </div>
                  </div>

                  <label className="flex items-start gap-3 text-sm font-bold text-[var(--text-heading)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={purgeAcknowledged}
                      onChange={(e) => setPurgeAcknowledged(e.target.checked)}
                      className="accent-red-600 mt-1"
                    />
                    <span>{t('purge.ack')}</span>
                  </label>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-[var(--text-heading)] mb-2">{t('purge.typeConfirmLabel', { phrase: 'مسح البيانات' })}</label>
                      <input
                        className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`}
                        value={purgeConfirmPhrase}
                        onChange={(e) => setPurgeConfirmPhrase(e.target.value)}
                        placeholder="مسح البيانات"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-[var(--text-heading)] mb-2">{t('purge.passwordLabel')}</label>
                      <input
                        type="password"
                        className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`}
                        value={purgePassword}
                        onChange={(e) => setPurgePassword(e.target.value)}
                        autoComplete="current-password"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={purgeLoading || !purgeAcknowledged || purgeConfirmPhrase.trim() !== 'مسح البيانات' || !purgePassword.trim()}
                    onClick={() => void handlePurgeBusinessData()}
                    className="bg-red-600 text-white px-5 py-2.5 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {purgeLoading ? t('purge.purging') : t('purge.purgeButton')}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeSection === 'users' && (
            <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors space-y-6">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-xl font-bold text-[var(--text-heading)]">{t('users.title')}</h3>
                  <p className="text-sm text-[var(--text-muted)] mt-1">{t('users.description')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void loadSystemAdministration();
                    void loadUsers(currentUser?.isPlatformAdmin ? selectedBranchId : undefined);
                  }}
                  className="bg-[var(--surface-header)] border border-[var(--border-default)] text-[var(--text-heading)] px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-[var(--surface-muted-nav)] transition text-sm font-bold"
                >
                  <RefreshCw className="w-4 h-4" />
                  {t('users.refresh')}
                </button>
              </div>

              {currentUser?.isPlatformAdmin && companies.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-[var(--text-heading)]">{t('users.branchLabel')}</label>
                  <div className="inline-flex flex-wrap gap-2 p-1 bg-[var(--surface-muted-nav)] rounded-xl border border-[var(--border-default)]">
                    {companies.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedBranchId(c.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
                          selectedBranchId === c.id
                            ? 'bg-[var(--ui-accent)] text-white shadow-sm'
                            : 'text-[var(--text-heading)] hover:bg-[var(--surface-header)]'
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {currentUser?.isPlatformAdmin && (
                <CompanyManagementPanel onCompaniesChanged={(rows) => setCompanies(rows)} />
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-1 border border-[var(--border-default)] rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 font-bold text-[var(--text-heading)]">
                    <UserPlus className="w-5 h-5 text-[var(--ui-accent)]" /> {t('users.newUserTitle')}
                    {currentUser?.isPlatformAdmin && companies.length > 0 && (
                      <span className="text-xs font-normal text-[var(--text-muted)]">
                        — {companies.find((c) => c.id === selectedBranchId)?.name ?? ''}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--text-muted)]">{t('users.fullNameLabel')}</label>
                    <input className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`} placeholder={t('users.fullNamePlaceholder')} value={userForm.fullName} onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--text-muted)]">{t('users.usernameLabel')}</label>
                    <input className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`} placeholder={t('users.usernamePlaceholder')} value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--text-muted)]">{t('users.passwordLabel')}</label>
                    <input className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`} placeholder={t('users.passwordPlaceholder')} type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--text-muted)]">{t('users.roleLabel')}</label>
                    <select className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`} value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                      {(roles.length ? roles : [{ code: 'viewer', name: t('users.viewerFallback') } as ApiRole]).map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--text-muted)]">{t('users.notesLabel')}</label>
                    <textarea
                      className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg resize-none ${ringCls}`}
                      rows={2}
                      placeholder={t('users.notesPlaceholder')}
                      value={userForm.notes}
                      onChange={(e) => setUserForm({ ...userForm, notes: e.target.value })}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
                    <input type="checkbox" checked={userForm.isActive} onChange={(e) => setUserForm({ ...userForm, isActive: e.target.checked })} className="accent-[var(--ui-accent)]" />
                    {t('users.accountActive')}
                  </label>
                  <button type="button" onClick={handleCreateUser} className="w-full bg-[var(--ui-accent)] text-white px-4 py-2 rounded-lg font-bold hover:opacity-95 transition">{t('users.save')}</button>
                </div>

                <div className="lg:col-span-2 border border-[var(--border-default)] rounded-xl overflow-hidden">
                  <div className="p-4 bg-[var(--surface-muted-nav)] border-b border-[var(--border-default)] flex items-center gap-2 font-bold text-[var(--text-heading)]">
                    <Users className="w-5 h-5 text-[var(--ui-accent)]" /> {t('users.currentUsersTitle')}
                    {currentUser?.isPlatformAdmin && companies.length > 0 && (
                      <span className="text-xs font-normal text-[var(--text-muted)]">
                        — {companies.find((c) => c.id === selectedBranchId)?.name ?? ''}
                      </span>
                    )}
                    {usersLoading && <RefreshCw className="w-4 h-4 animate-spin text-[var(--text-muted)]" />}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--surface-muted-nav)] text-[var(--text-muted)]">
                        <tr>
                          <th className="p-3 text-right">{t('users.colUser')}</th>
                          <th className="p-3 text-right">{t('users.colRole')}</th>
                          <th className="p-3 text-right">{t('users.colStatus')}</th>
                          <th className="p-3 text-right w-24">{t('users.colAction')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => (
                          <tr key={user.id} className="border-t border-[var(--border-subtle)]">
                            <td className="p-3 font-bold text-[var(--text-heading)]">{user.full_name || user.username}<div className="text-xs text-[var(--text-muted)] font-mono">{user.username}</div></td>
                            <td className="p-3 text-[var(--text-heading)]">{roles.find((role) => role.code === user.role)?.name || user.role}</td>
                            <td className="p-3"><span className={`px-2 py-1 rounded-full text-xs font-bold ${user.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{user.is_active ? t('users.statusActive') : t('users.statusStopped')}</span></td>
                            <td className="p-3">
                              <button
                                type="button"
                                title={t('users.editUserTooltip')}
                                onClick={() => openEditUser(user)}
                                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] px-2.5 py-1.5 text-xs font-bold text-[var(--text-heading)] hover:bg-[var(--surface-muted-nav)] transition"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                {t('users.edit')}
                              </button>
                            </td>
                          </tr>
                        ))}
                        {users.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">{t('users.noUsersLoaded')}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {currentUser?.isPlatformAdmin && (
              <div className="border border-[var(--border-default)] rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 font-bold text-[var(--text-heading)]"><KeyRound className="w-5 h-5 text-[var(--ui-accent)]" /> {t('users.rolePermissionsTitle')}</div>
                  <select className={`p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`} value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}>
                    {roles.map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}
                  </select>
                </div>
                <p className="text-xs text-[var(--text-muted)]">{t('users.rolePermissionsHelp')}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {permissions.map((permission) => (
                    <label key={permission.code} className="flex items-center justify-between gap-3 p-3 border border-[var(--border-default)] rounded-lg hover:bg-[var(--surface-muted-nav)] cursor-pointer">
                      <span><span className="font-bold text-[var(--text-heading)]">{permission.name}</span><span className="block text-xs text-[var(--text-muted)] font-mono">{permission.code}</span></span>
                      <input type="checkbox" checked={rolePermissionSet.has(permission.code)} onChange={() => toggleRolePermission(permission.code)} className="accent-[var(--ui-accent)] w-4 h-4" />
                    </label>
                  ))}
                  {permissions.length === 0 && <p className="text-[var(--text-muted)] text-sm">{t('users.noPermissionsLoaded')}</p>}
                </div>
              </div>
              )}
            </div>
          )}

          {activeSection === 'activeDevices' && (
            <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors">
              <ActiveDevicesPanel />
            </div>
          )}

          {activeSection === 'company' && (
            <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors">
              <h3 className="text-xl font-bold text-[var(--text-heading)] mb-6">{t('company.basicInfoTitle')}</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[var(--text-heading)]">{t('company.nameArLabel')}</label>
                  <input
                    type="text"
                    defaultValue={t('company.mockNameAr')}
                    className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg shadow-sm ${ringCls}`}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[var(--text-heading)]">{t('company.nameEnLabel')}</label>
                  <input
                    type="text"
                    defaultValue="Golden Tailor Est."
                    className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg shadow-sm ${ringCls}`}
                    dir="ltr"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[var(--text-heading)]">{t('company.vatLabel')}</label>
                  <input
                    type="text"
                    defaultValue="310023456789003"
                    className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg shadow-sm font-mono text-left ${ringCls}`}
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[var(--text-heading)]">{t('company.crLabel')}</label>
                  <input
                    type="text"
                    defaultValue="1010123456"
                    className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg shadow-sm font-mono text-left ${ringCls}`}
                    dir="ltr"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-heading)]">{t('company.addressLabel')}</label>
                  <textarea
                    rows={2}
                    defaultValue={t('company.mockAddress')}
                    className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg shadow-sm ${ringCls}`}
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[var(--text-heading)]">{t('company.emailLabel')}</label>
                  <input
                    type="email"
                    defaultValue="info@goldentailor.com"
                    className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg shadow-sm text-left ${ringCls}`}
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[var(--text-heading)]">{t('company.websiteLabel')}</label>
                  <input
                    type="url"
                    defaultValue="www.goldentailor.com"
                    className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg shadow-sm text-left ${ringCls}`}
                    dir="ltr"
                  />
                </div>
              </div>

              <hr className="my-8 border-[var(--border-subtle)]" />

              <div className="space-y-6">
                <h3 className="text-xl font-bold text-[var(--text-heading)]">{t('company.currencySettingsTitle')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-[var(--text-heading)]">{t('company.baseCurrencyLabel')}</label>
                    <select
                      className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg shadow-sm font-bold text-[var(--text-heading)] ${ringCls}`}
                      value="USD"
                      disabled
                    >
                      <option value="USD">{t('company.usdOption')}</option>
                    </select>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {t('company.baseCurrencyHelp')}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-[var(--text-heading)]">{t('company.secondaryCurrenciesLabel')}</label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 p-2.5 border border-[var(--border-default)] rounded-lg hover:bg-[var(--surface-muted-nav)] cursor-pointer">
                        <input type="checkbox" defaultChecked className={`w-4 h-4 rounded border-[var(--border-default)] accent-[var(--ui-accent)] ${ringCls}`} />
                        <span className="font-medium text-[var(--text-heading)]">{t('company.tryOption')}</span>
                      </label>
                      <label className="flex items-center gap-2 p-2.5 border border-[var(--border-default)] rounded-lg hover:bg-[var(--surface-muted-nav)] cursor-pointer">
                        <input type="checkbox" defaultChecked className={`w-4 h-4 rounded border-[var(--border-default)] accent-[var(--ui-accent)] ${ringCls}`} />
                        <span className="font-medium text-[var(--text-heading)]">{t('company.sypOption')}</span>
                      </label>
                      <label className="flex items-center gap-2 p-2.5 border border-[var(--border-default)] rounded-lg hover:bg-[var(--surface-muted-nav)] cursor-pointer">
                        <input type="checkbox" defaultChecked className={`w-4 h-4 rounded border-[var(--border-default)] accent-[var(--ui-accent)] ${ringCls}`} />
                        <span className="font-medium text-[var(--text-heading)]">{t('company.egpOption')}</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] shadow-sm overflow-hidden">
                  <div className="p-4 border-b border-[var(--border-default)] bg-[var(--surface-muted-nav)] flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h4 className="font-bold text-[var(--text-heading)]">{t('company.exchangeRatesTitle')}</h4>
                      <p className="text-xs text-[var(--text-muted)] mt-1">{t('company.exchangeRatesHelp')}</p>
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {t('company.exchangeRatesExample')}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-sm">
                      <thead className="bg-[var(--surface-muted-nav)] text-[var(--text-muted)]">
                        <tr>
                          <th className="px-4 py-3 font-semibold">{t('company.colCurrency')}</th>
                          <th className="px-4 py-3 font-semibold">{t('company.colRate')}</th>
                          <th className="px-4 py-3 font-semibold">{t('company.colStatus')}</th>
                          <th className="px-4 py-3 font-semibold">{t('company.colUpdatedAt')}</th>
                          <th className="px-4 py-3 font-semibold"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {exchangeRatesLoading ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                              {t('company.ratesLoading')}
                            </td>
                          </tr>
                        ) : exchangeRates.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                              {t('company.ratesEmpty')}
                            </td>
                          </tr>
                        ) : (
                          exchangeRates.map((row) => {
                            const draft = exchangeRatesDraft[row.currency_code] ?? { rate: String(row.exchange_rate_to_usd), isActive: row.is_active };
                            const saving = Boolean(exchangeRatesSaving[row.currency_code]);
                            return (
                              <tr key={row.currency_code} className="hover:bg-[var(--surface-muted-nav)]">
                                <td className="px-4 py-3 font-semibold text-[var(--text-heading)]">
                                  {row.currency_name_ar} ({row.currency_code})
                                  {row.is_base && <span className="text-xs text-[var(--text-muted)] mr-2">— {t('company.baseCurrencyBadge')}</span>}
                                </td>
                                <td className="px-4 py-3">
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.000001"
                                    value={row.currency_code === 'USD' ? '1' : draft.rate}
                                    disabled={row.currency_code === 'USD'}
                                    onChange={(e) =>
                                      setExchangeRatesDraft((prev) => ({
                                        ...prev,
                                        [row.currency_code]: { ...draft, rate: e.target.value },
                                      }))
                                    }
                                    className={`w-full max-w-[220px] p-2 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg shadow-sm font-mono text-left ${ringCls}`}
                                    dir="ltr"
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <label className="inline-flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={row.currency_code === 'USD' ? true : draft.isActive}
                                      disabled={row.currency_code === 'USD'}
                                      onChange={(e) =>
                                        setExchangeRatesDraft((prev) => ({
                                          ...prev,
                                          [row.currency_code]: { ...draft, isActive: e.target.checked },
                                        }))
                                      }
                                      className={`w-4 h-4 rounded border-[var(--border-default)] accent-[var(--ui-accent)] ${ringCls}`}
                                    />
                                    <span className="text-sm text-[var(--text-heading)]">{(row.currency_code === 'USD' ? true : draft.isActive) ? t('company.rateActive') : t('company.rateStopped')}</span>
                                  </label>
                                </td>
                                <td className="px-4 py-3 text-xs text-[var(--text-muted)] font-mono" dir="ltr">
                                  {String(row.updated_at).replace('T', ' ').slice(0, 19)}
                                </td>
                                <td className="px-4 py-3">
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => void saveExchangeRateRow(row.currency_code)}
                                    className="bg-[var(--ui-accent)] text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:opacity-90 transition shadow-sm font-medium disabled:opacity-60"
                                  >
                                    <Save className="w-4 h-4" />
                                    <span>{saving ? '...' : t('company.saveRow')}</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <hr className="my-8 border-[var(--border-subtle)]" />

              <div className="space-y-6">
                <h3 className="text-xl font-bold text-[var(--text-heading)]">{t('company.logoTitle')}</h3>
                <div className="flex items-center gap-6 flex-wrap">
                  <div className="w-24 h-24 bg-[var(--surface-muted-nav)] border border-[var(--border-default)] rounded-xl flex items-center justify-center overflow-hidden shadow-sm">
                    <div className="text-[var(--text-muted)] font-bold text-center text-xs">{t('company.noLogo')}</div>
                  </div>
                  <div className="space-y-2">
                    <button
                      type="button"
                      className="bg-[var(--surface-header)] border border-[var(--ui-accent-border)] text-[var(--ui-accent)] px-4 py-2 rounded-lg font-medium hover:bg-[var(--ui-accent-soft-bg)] transition shadow-sm"
                    >
                      {t('company.uploadLogo')}
                    </button>
                    <p className="text-sm text-[var(--text-muted)]">
                      {t('company.logoHelp')}
                    </p>
                  </div>
                </div>
              </div>

              <hr className="my-8 border-[var(--border-subtle)]" />

              <div className="space-y-6 overflow-hidden">
                <h3 className="text-xl font-bold text-[var(--text-heading)]">{t('company.labelPreviewTitle')}</h3>
                <p className="text-sm text-[var(--text-muted)] mb-4">
                  {t('company.labelPreviewHelp')}
                </p>

                <div className="bg-[var(--surface-muted-nav)] p-8 rounded-xl border border-[var(--border-default)] flex justify-center items-center overflow-x-auto">
                  <div
                    className="bg-[var(--surface-header)] border border-[var(--border-default)] shadow-md flex flex-col"
                    style={{
                      width: '10cm',
                      height: '8cm',
                      padding: '15px',
                      boxSizing: 'border-box',
                      fontFamily: 'Arial, sans-serif'
                    }}
                  >
                    <div className="text-center font-bold text-lg mb-2 border-b-2 border-[var(--text-heading)] pb-1 text-[var(--text-heading)]">
                      {t('company.labelPreviewItemName')}
                    </div>
                    <div className="flex justify-between mb-2 font-bold text-base text-[var(--text-heading)]">
                      <span>{t('company.labelPreviewCode')}</span>
                      <span>101-TEX</span>
                    </div>
                    <div className="flex justify-between mb-2 font-bold text-base text-[var(--text-heading)]">
                      <span>{t('company.labelPreviewColorField')}</span>
                      <span>{t('company.labelPreviewColorValue')}</span>
                    </div>
                    <div className="flex justify-between mb-2 font-bold text-base text-[var(--text-heading)]">
                      <span>{t('company.labelPreviewColorCodeField')}</span>
                      <span>#FF0000</span>
                    </div>
                    <div className="flex justify-between mb-2 font-bold text-base text-[var(--text-heading)]">
                      <span>{t('company.labelPreviewLengthField')}</span>
                      <span>{t('company.labelPreviewLengthValue')}</span>
                    </div>
                    <div className="flex justify-between mb-2 font-bold text-base text-[var(--text-heading)]">
                      <span>{t('company.labelPreviewWeightField')}</span>
                      <span>25.50 KG</span>
                    </div>

                    <div className="mt-auto text-center flex flex-col items-center">
                      <div className="font-mono text-2xl tracking-widest mt-2" style={{ fontFamily: 'monospace' }}>
                        *ABC-123456*
                      </div>
                      <div className="text-xs mt-1 text-[var(--text-heading)]">{t('company.labelPreviewBarcodeCaption')}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] p-5">
              <h3 className="text-lg font-bold text-[var(--text-heading)]">{t('editUserModal.title')}</h3>
              <button type="button" onClick={closeEditUser} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <input
                className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`}
                placeholder={t('editUserModal.usernamePlaceholder')}
                value={editUserForm.username}
                onChange={(e) => setEditUserForm({ ...editUserForm, username: e.target.value })}
              />
              <input
                className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`}
                placeholder={t('editUserModal.fullNamePlaceholder')}
                value={editUserForm.fullName}
                onChange={(e) => setEditUserForm({ ...editUserForm, fullName: e.target.value })}
              />
              <input
                className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`}
                placeholder={t('editUserModal.passwordPlaceholder')}
                type="password"
                value={editUserForm.password}
                onChange={(e) => setEditUserForm({ ...editUserForm, password: e.target.value })}
              />
              <select
                className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg ${ringCls}`}
                value={editUserForm.role}
                onChange={(e) => setEditUserForm({ ...editUserForm, role: e.target.value })}
              >
                {(roles.length ? roles : [{ code: 'viewer', name: t('users.viewerFallback') } as ApiRole]).map((role) => (
                  <option key={role.code} value={role.code}>{role.name}</option>
                ))}
              </select>
              <textarea
                className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg resize-none ${ringCls}`}
                rows={2}
                placeholder={t('editUserModal.notesPlaceholder')}
                value={editUserForm.notes}
                onChange={(e) => setEditUserForm({ ...editUserForm, notes: e.target.value })}
              />
              <label className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
                <input
                  type="checkbox"
                  checked={editUserForm.isActive}
                  onChange={(e) => setEditUserForm({ ...editUserForm, isActive: e.target.checked })}
                  className="accent-[var(--ui-accent)]"
                />
                {t('editUserModal.accountActive')}
              </label>
              {editUserError && <p className="text-sm font-bold text-rose-600">{editUserError}</p>}
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--border-default)] p-5">
              <button
                type="button"
                onClick={closeEditUser}
                disabled={editUserSaving}
                className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-bold text-[var(--text-heading)] hover:bg-[var(--surface-muted-nav)] disabled:opacity-50"
              >
                {t('editUserModal.cancel')}
              </button>
              <button
                type="button"
                onClick={handleUpdateUser}
                disabled={editUserSaving || !editUserForm.username.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--ui-accent)] px-4 py-2 text-sm font-bold text-white hover:opacity-95 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {editUserSaving ? t('editUserModal.saving') : t('editUserModal.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

type SettingsPanelRow = {
  label: string;
  type: 'text' | 'number' | 'checkbox' | 'select';
  value: string | boolean;
  options?: [string, string][];
  onChange: (value: string | boolean) => void;
};

function SettingsPanel({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: SettingsPanelRow[];
}) {
  const ringCls = 'focus:outline-none focus:ring-2 focus:ring-[var(--ui-accent)]';

  return (
    <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors space-y-6">
      <div>
        <h3 className="text-xl font-bold text-[var(--text-heading)]">{title}</h3>
        <p className="text-sm text-[var(--text-muted)] mt-1">{description}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map((row) => (
          <label key={row.label} className={`border border-[var(--border-default)] rounded-xl p-4 ${row.type === 'checkbox' ? 'flex items-center justify-between gap-4' : 'space-y-2'}`}>
            <span className="font-bold text-[var(--text-heading)] text-sm">{row.label}</span>
            {row.type === 'checkbox' ? (
              <input
                type="checkbox"
                checked={Boolean(row.value)}
                onChange={(event) => row.onChange(event.target.checked)}
                className={`w-5 h-5 rounded accent-[var(--ui-accent)] ${ringCls}`}
              />
            ) : row.type === 'select' ? (
              <select
                value={String(row.value)}
                onChange={(event) => row.onChange(event.target.value)}
                className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg text-[var(--text-heading)] ${ringCls}`}
              >
                {(row.options ?? []).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            ) : (
              <input
                type={row.type}
                value={String(row.value)}
                onChange={(event) => row.onChange(event.target.value)}
                className={`w-full p-2.5 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg text-[var(--text-heading)] ${ringCls}`}
                dir={row.type === 'number' ? 'ltr' : undefined}
              />
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
