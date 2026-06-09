import { apiFetch } from './client';

export type ActivationPlanCode = 'LITE' | 'PRO' | 'FULL';

export type ActivationStatusDto = {
  active: boolean;
  requireActive: boolean;
  planCode?: ActivationPlanCode;
  activatedAt?: string;
  keySuffix?: string;
};

export type ActivateResultDto = {
  ok: boolean;
  data: ActivationStatusDto;
  message?: string;
};

export type ActivationKeyAdminDto = {
  id: string;
  key_suffix: string;
  status: 'UNUSED' | 'USED' | 'REVOKED' | 'EXPIRED';
  plan_code: ActivationPlanCode;
  activation_count: number;
  max_activations: number;
  activated_at: string | null;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ActivationEventDto = {
  id: string;
  event_type: string;
  key_suffix: string | null;
  ip_address: string | null;
  device_fingerprint: string | null;
  app_version: string | null;
  message: string | null;
  created_at: string;
};

export async function getActivationStatus(): Promise<ActivationStatusDto> {
  const res = await apiFetch<{ ok: boolean; data: ActivationStatusDto }>('/api/activation/status', {
    skipAuth: true,
  });
  return res.data;
}

export async function activateProject(key: string): Promise<ActivationStatusDto> {
  const deviceInfo = await getActivationDeviceInfo();
  const res = await apiFetch<ActivateResultDto>('/api/activation/activate', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({ key, ...deviceInfo }),
  });
  return res.data;
}

export async function listActivationKeys(): Promise<ActivationKeyAdminDto[]> {
  const res = await apiFetch<{ ok: boolean; data: ActivationKeyAdminDto[] }>('/api/activation/keys');
  return res.data;
}

export async function generateActivationKeys(count: number, planCode: ActivationPlanCode, payload: { expiresAt?: string; notes?: string } = {}): Promise<{ keys: string[]; warning: string }> {
  const res = await apiFetch<{ ok: boolean; data: { keys: string[]; warning: string } }>('/api/activation/keys/generate', {
    method: 'POST',
    body: JSON.stringify({ count, planCode, ...payload }),
  });
  return res.data;
}

export async function revokeActivationKey(id: string): Promise<void> {
  await apiFetch(`/api/activation/keys/${id}/revoke`, { method: 'PATCH' });
}

export async function listActivationEvents(): Promise<ActivationEventDto[]> {
  const res = await apiFetch<{ ok: boolean; data: ActivationEventDto[] }>('/api/activation/events');
  return res.data;
}

async function getActivationDeviceInfo(): Promise<{
  deviceName?: string;
  osInfo?: string;
  appVersion?: string;
  deviceFingerprint?: string;
}> {
  if (typeof window === 'undefined' || !window.fabricApp?.getDeviceInfo) return {};
  try {
    return await window.fabricApp.getDeviceInfo();
  } catch {
    return {};
  }
}
