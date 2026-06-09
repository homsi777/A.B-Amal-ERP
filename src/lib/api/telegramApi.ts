import { apiFetch } from './client';

export type TelegramTargetType = 'USER' | 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'OTHER';

export interface TelegramSettingsDto {
  isEnabled: boolean;
  botUsername: string | null;
  botName: string | null;
  tokenMasked: string;
  hasToken: boolean;
  purchaseMessage?: string;
}

export interface DetectedTelegramChatDto {
  chatId: string;
  telegramUserId: string | null;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  telegramLastName: string | null;
  telegramDisplayName: string;
  chatType: string | null;
  lastMessage: string;
  lastMessageAt: string | null;
  linked: boolean;
  linkId: string | null;
  linkedTargetType: TelegramTargetType | null;
  linkedTargetId: string | null;
  linkedTargetName: string | null;
}

export interface TelegramChatLinkDto {
  id: string;
  chatId: string;
  telegramUserId: string | null;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  telegramLastName: string | null;
  telegramDisplayName: string | null;
  chatType: string | null;
  targetType: TelegramTargetType;
  targetId: string | null;
  targetName: string;
  isActive: boolean;
  canReceiveInvoices: boolean;
  canReceiveVouchers: boolean;
  canReceiveReports: boolean;
  canReceiveAlerts: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramLinkPayload {
  chatId: string;
  telegramUserId?: string | null;
  telegramUsername?: string | null;
  telegramFirstName?: string | null;
  telegramLastName?: string | null;
  telegramDisplayName?: string | null;
  chatType?: string | null;
  targetType: TelegramTargetType;
  targetId?: string | null;
  targetName: string;
  canReceiveInvoices: boolean;
  canReceiveVouchers: boolean;
  canReceiveReports: boolean;
  canReceiveAlerts: boolean;
  notes?: string;
}

export async function getTelegramSettings(): Promise<TelegramSettingsDto> {
  const res = await apiFetch<{ ok: boolean; data: TelegramSettingsDto }>('/api/telegram/settings');
  return res.data;
}

export async function updateTelegramSettings(payload: { botToken?: string; isEnabled: boolean }): Promise<TelegramSettingsDto> {
  const res = await apiFetch<{ ok: boolean; data: TelegramSettingsDto }>('/api/telegram/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function testTelegramBot(): Promise<{ id: number; username?: string; first_name?: string }> {
  const res = await apiFetch<{ ok: boolean; data: { id: number; username?: string; first_name?: string } }>('/api/telegram/test-bot', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return res.data;
}

export async function fetchTelegramUpdates(): Promise<DetectedTelegramChatDto[]> {
  const res = await apiFetch<{ ok: boolean; data: DetectedTelegramChatDto[] }>('/api/telegram/fetch-updates', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return res.data;
}

export async function getDetectedTelegramChats(): Promise<DetectedTelegramChatDto[]> {
  const res = await apiFetch<{ ok: boolean; data: DetectedTelegramChatDto[] }>('/api/telegram/detected-chats');
  return res.data;
}

export async function listTelegramChatLinks(params: {
  search?: string;
  targetType?: TelegramTargetType | '';
  active?: boolean;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ data: TelegramChatLinkDto[]; total: number; page: number; pageSize: number }> {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.targetType) q.set('targetType', params.targetType);
  if (typeof params.active === 'boolean') q.set('active', String(params.active));
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  const res = await apiFetch<{ ok: boolean; data: TelegramChatLinkDto[]; total: number; page: number; pageSize: number }>(
    `/api/telegram/chat-links${q.toString() ? `?${q}` : ''}`,
  );
  return res;
}

export async function createTelegramChatLink(payload: TelegramLinkPayload): Promise<{ id: string }> {
  const res = await apiFetch<{ ok: boolean; data: { id: string } }>('/api/telegram/chat-links', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateTelegramChatLink(id: string, payload: TelegramLinkPayload): Promise<{ id: string }> {
  const res = await apiFetch<{ ok: boolean; data: { id: string } }>(`/api/telegram/chat-links/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function toggleTelegramChatLinkStatus(id: string, isActive: boolean): Promise<void> {
  await apiFetch(`/api/telegram/chat-links/${id}/toggle-status`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });
}

export async function sendTelegramTestMessage(linkId: string): Promise<void> {
  await apiFetch(`/api/telegram/chat-links/${linkId}/test-message`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function sendTelegramDocument(payload: {
  documentType: 'INVOICE' | 'STATEMENT' | 'VOUCHER';
  partyType?: 'customer' | 'supplier' | 'user' | 'employee' | 'other' | 'system';
  partyId?: string | null;
  targetType?: TelegramTargetType;
  targetId?: string | null;
  chatId?: string;
  message: string;
  pdfHtml?: string;
  fileName?: string;
  caption?: string;
  eventType?: string;
}): Promise<void> {
  const path =
    payload.documentType === 'INVOICE'
      ? '/api/telegram/invoice'
      : payload.documentType === 'STATEMENT'
        ? '/api/telegram/statement'
        : '/api/telegram/voucher';
  await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
