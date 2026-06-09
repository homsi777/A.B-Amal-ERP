/** عميل HTTP للـ API — لا يحتوي على اعتمادات قاعدة البيانات */

const TOKEN_KEY = 'fabric_erp_api_token';

/**
 * LocalStorage key for user-configured API URL (Electron desktop settings page).
 */
const API_URL_STORAGE_KEY = 'fabric_erp_api_base_url';

function normalizeApiUrl(url: string | null | undefined): string {
  if (url == null) return '';
  return String(url).trim().replace(/\/+$/, '');
}

function isElectronRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.fabricApp?.isElectron);
}

/** Packaged renderer build (production Vite bundle) inside Electron desktop shell */
function electronPackagedRenderer(): boolean {
  return isElectronRuntime() && import.meta.env.PROD;
}

/** Vite dev server + Electron: not the production bundle */
function electronViteDevShell(): boolean {
  return isElectronRuntime() && !import.meta.env.PROD;
}

function browserProductionMode(): boolean {
  return !isElectronRuntime() && import.meta.env.PROD;
}

function browserDevelopmentMode(): boolean {
  return !isElectronRuntime() && !import.meta.env.PROD;
}

let loggedApiResolution = false;

function readDesktopBootUrl(): string {
  try {
    const boot =
      typeof window !== 'undefined' && window.fabricApp && 'desktopApiBaseAtBoot' in window.fabricApp
        ? (window.fabricApp as { desktopApiBaseAtBoot?: string }).desktopApiBaseAtBoot
        : '';
    return normalizeApiUrl(boot);
  } catch {
    return '';
  }
}

function readLocalStorageApiUrl(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    return normalizeApiUrl(localStorage.getItem(API_URL_STORAGE_KEY));
  } catch {
    return '';
  }
}

/**
 * Electron: persisted settings, then localStorage, then VITE.
 * Packaged production falls back to loopback bundled API.
 * Electron + Vite HMR falls back to local dev Fastify (4010).
 */
function resolveElectronDesktopApiUrl(): string {
  const ordered = [
    readDesktopBootUrl(),
    readLocalStorageApiUrl(),
    normalizeApiUrl(import.meta.env.VITE_API_BASE_URL as string | undefined),
  ];

  const pack = electronPackagedRenderer();

  const firstNonEmpty = ordered.find((u) => !!u);
  if (firstNonEmpty) return firstNonEmpty;

  if (pack) {
    return 'http://127.0.0.1:4010';
  }

  if (electronViteDevShell()) {
    return 'http://127.0.0.1:4010';
  }

  return '';
}

function resolveBrowserApiUrl(): string {
  const fromVite = normalizeApiUrl(import.meta.env.VITE_API_BASE_URL as string | undefined);

  // Production browser mode must route through the current origin + Nginx.
  // Ignore localStorage so old Electron/dev values such as localhost:4010
  // cannot hijack the live website.
  if (browserProductionMode()) {
    return fromVite || '';

  }

  // Browser development may still use local overrides when needed.
  if (browserDevelopmentMode()) {
    const fromLs = readLocalStorageApiUrl();
    if (fromLs) return fromLs;
  }

  return fromVite;
}

export function getApiBaseUrl(): string {
  const resolved = isElectronRuntime() ? resolveElectronDesktopApiUrl() : resolveBrowserApiUrl();

  if (typeof window !== 'undefined' && !loggedApiResolution) {
    loggedApiResolution = true;
    console.info('[fabric-api] عنوان الـ API المستخدم الآن:', resolved || '(فارغ — راجع الإعدادات)');
    if (isElectronRuntime()) {
      console.info(
        '[fabric-api] Electron: desktopApiBaseAtBoot -> localStorage -> VITE -> http://127.0.0.1:4010 (HMR or packaged)',
      );
    } else if (browserProductionMode()) {
      console.info('[fabric-api] Browser production: same-origin requests active; localStorage desktop overrides ignored.');
    }
  }

  return resolved;
}

/** Set a runtime API URL override (used by DesktopSettings page) */
export function setApiBaseUrl(url: string): void {
  try {
    if (url && url.trim()) {
      localStorage.setItem(API_URL_STORAGE_KEY, url.replace(/\/$/, ''));
    } else {
      localStorage.removeItem(API_URL_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Storage strategy for the auth token.
 *
 *  - Electron desktop: use `sessionStorage` so the token is wiped when the
 *    BrowserWindow is destroyed. Result: every fresh app launch requires a
 *    new login (matches the "login screen on every launch" requirement),
 *    but the token still survives renderer reloads / HMR inside one session.
 *
 *  - Web: keep `localStorage` so users stay logged in across tabs and reloads.
 *
 * On boot we also remove any stale token from `localStorage` while inside
 * Electron, in case a previous build wrote it there.
 */
function getTokenStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return isElectronRuntime() ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

if (typeof window !== 'undefined' && isElectronRuntime()) {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function getStoredToken(): string | null {
  try {
    return getTokenStorage()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    const storage = getTokenStorage();
    if (!storage) return;
    if (token) {
      storage.setItem(TOKEN_KEY, token);
    } else {
      storage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* ignore */
  }
}

export type ApiErrorBody = {
  ok?: boolean;
  message?: string;
  error?: string;
  code?: string;
  details?: unknown;
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public body?: ApiErrorBody,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    const hint = isElectronRuntime() && electronPackagedRenderer()
      ? ' أضِف حقلاً صالحًا لـ apiPublicUrl في ملف vps-connection.json قبل بناء النسخة المثبتة.'
      : '';
    throw new ApiRequestError(
      `لم يُضبط عنوان خادم CLOTEX API (المتصفح أو المثبت).${hint}`,
      0,
      { ok: false, code: 'NETWORK' },
    );
  }

  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  if (!options.skipAuth) {
    const token = getStoredToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;

  let response: Response;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const timeoutController = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId =
    timeoutController && timeoutMs > 0
      ? globalThis.setTimeout(() => timeoutController.abort(), timeoutMs)
      : null;
  try {
    const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
    response = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: fetchOptions.signal ?? timeoutController?.signal,
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new ApiRequestError(
        'استغرقت عملية الاتصال وقتاً طويلاً. يرجى مراجعة سجل العملية أو المحاولة بملف أصغر.',
        0,
        { ok: false, code: 'TIMEOUT' },
      );
    }
    throw new ApiRequestError(
      `تعذّر الاتصال بخادم CLOTEX على العنوان ${base}. قد يكون الخادم غير متاح، عنوان apiPublicUrl خاطئ، مشكلة إنترنت، شهادة SSL، أو سياسات CORS تمنع الطلب.`,
      0,
      { ok: false, code: 'NETWORK' },
    );
  } finally {
    if (timeoutId != null) globalThis.clearTimeout(timeoutId);
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  let data: unknown = null;
  if (isJson) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const body = data as ApiErrorBody | undefined;
    const msg =
      body?.message ||
      body?.error ||
      (response.status === 401
        ? 'يجب تسجيل الدخول أو انتهت الجلسة.'
        : 'طلب غير ناجح.') ||
      response.statusText;

    // Hard-evict any stale token on 401 so the route guard sends the user
    // back to /login. Skip when the caller explicitly opted out of auth
    // (e.g. the login request itself), to avoid clobbering the form.
    if (response.status === 401 && !options.skipAuth) {
      setStoredToken(null);
      if (typeof window !== 'undefined' && !window.location.pathname.endsWith('/login') && !window.location.hash.endsWith('/login')) {
        const target = isElectronRuntime() ? '#/login' : '/login';
        window.location.assign(target);
      }
    }

    throw new ApiRequestError(msg, response.status, body);
  }

  return data as T;
}
