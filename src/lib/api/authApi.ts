import { apiFetch, setStoredToken } from './client';

export type AuthUser = {
  id: string;
  username: string;
  fullName: string | null;
  companyId: string;
  role: string;
  permissions: string[];
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
