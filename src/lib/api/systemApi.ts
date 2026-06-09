import { apiFetch, getApiBaseUrl } from './client';

export type HealthResponse = {
  ok: boolean;
  service: string;
  database: 'connected' | 'disconnected';
  time: string;
};

/** فحص الصحة بدون مصادقة */
export async function fetchHealth(): Promise<HealthResponse | null> {
  const base = getApiBaseUrl();
  if (!base) return null;

  try {
    const response = await fetch(`${base}/api/health`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as HealthResponse;
  } catch {
    return null;
  }
}

export async function fetchSystemInfo(): Promise<{ ok: boolean; name: string; version: string }> {
  return apiFetch('/api/system/info');
}
