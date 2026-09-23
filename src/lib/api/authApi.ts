import { apiFetch, setStoredToken } from './client';

export type AuthUser = {
  id: string;
  username: string;
  fullName: string | null;
  companyId: string;
  role: string;
  permissions: string[];
  /** مدير منصة clotex نفسه — منفصل عن "أدمن" أي شركة عميل. */
  isPlatformAdmin: boolean;
};

export type LoginResponse = {
  ok: true;
  token: string;
  user: AuthUser;
};

export type MeResponse = {
  ok: true;
  user: AuthUser;
};

export async function loginApi(username: string, password: string): Promise<LoginResponse> {
  const data = await apiFetch<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
    skipAuth: true,
  });
  if (data.token) {
    setStoredToken(data.token);
  }
  return data;
}

export async function logoutApi(): Promise<void> {
  try {
    await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST', skipAuth: true });
  } finally {
    setStoredToken(null);
  }
}

export async function fetchMe(): Promise<AuthUser> {
  const data = await apiFetch<MeResponse>('/api/auth/me');
  return data.user;
}

/** لمدير المنصة فقط: يُصدر توكناً جديداً لمشاهدة/العمل ضمن حساب آخر. */
export async function switchCompanyApi(companyId: string): Promise<AuthUser> {
  const data = await apiFetch<LoginResponse>('/api/auth/switch-company', {
    method: 'POST',
    body: JSON.stringify({ companyId }),
  });
  if (data.token) {
    setStoredToken(data.token);
  }
  return data.user;
}

/** يُبقي الجلسة ظاهرة في «الأجهزة النشطة» أثناء بقاء المستخدم داخل النظام */
export async function pingSessionPresence(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/auth/presence');
}
