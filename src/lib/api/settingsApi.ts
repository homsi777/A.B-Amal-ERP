import { apiFetch } from './client';

export type SystemSettingsMap = Record<string, Record<string, unknown>>;

export interface ApiPermission {
  id: string;
  code: string;
  name: string;
  category: string | null;
}

export interface ApiRole {
  id: string;
  code: string;
  name: string;
}

export interface ApiRolePermission {
  role_code: string;
  permission_code: string;
}

export interface ApiUser {
  id: string;
  username: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export async function getSystemSettings(): Promise<SystemSettingsMap> {
  const res = await apiFetch<{ ok: boolean; data: SystemSettingsMap }>('/api/system/settings');
  return res.data;
}

export async function saveSystemSetting(key: string, value: Record<string, unknown>): Promise<void> {
  await apiFetch(`/api/system/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export interface TelegramBotInfo {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TelegramChatCandidate {
  chatId: string;
  chatType: string;
  name: string;
  username: string;
  lastMessage: string;
  lastUpdateId: number;
  lastMessageAt: string;
}

export async function testTelegramBot(payload: { botToken?: string; chatId?: string } = {}): Promise<TelegramBotInfo> {
  const res = await apiFetch<{ ok: boolean; data: TelegramBotInfo }>('/api/system/telegram/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function fetchTelegramUpdates(): Promise<TelegramChatCandidate[]> {
  const res = await apiFetch<{ ok: boolean; data: TelegramChatCandidate[] }>('/api/system/telegram/updates');
  return res.data;
}

export async function getPermissionsOverview(): Promise<{
  roles: ApiRole[];
  permissions: ApiPermission[];
  rolePermissions: ApiRolePermission[];
}> {
  const res = await apiFetch<{
    ok: boolean;
    roles: ApiRole[];
    permissions: ApiPermission[];
    rolePermissions: ApiRolePermission[];
  }>('/api/system/permissions');
  return {
    roles: res.roles,
    permissions: res.permissions,
    rolePermissions: res.rolePermissions,
  };
}

export async function saveRolePermissions(
  roleCode: string,
  payload: { name: string; permissionCodes: string[] },
): Promise<void> {
  await apiFetch(`/api/system/roles/${encodeURIComponent(roleCode)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function listSystemUsers(): Promise<ApiUser[]> {
  const res = await apiFetch<{ ok: boolean; data: ApiUser[] }>('/api/system/users');
  return res.data;
}

export async function createSystemUser(payload: {
  username: string;
  fullName: string;
  password: string;
  role: string;
  isActive: boolean;
}): Promise<ApiUser> {
  const res = await apiFetch<{ ok: boolean; data: ApiUser }>('/api/system/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateSystemUser(
  id: string,
  payload: { username: string; fullName: string; password?: string; role: string; isActive: boolean },
): Promise<ApiUser> {
  const res = await apiFetch<{ ok: boolean; data: ApiUser }>(`/api/system/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}
