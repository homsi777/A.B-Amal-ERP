import type { AiProvider } from './aiProviders.js';
import { getProviderDefinition } from './aiProviders.js';

export function formatLlmError(provider: AiProvider, status: number, bodyText: string): string {
  const label = getProviderDefinition(provider).labelAr;
  let code = '';
  let message = '';
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; code?: string; type?: string; status?: string };
    };
    code = String(parsed.error?.code || parsed.error?.type || parsed.error?.status || '').trim();
    message = String(parsed.error?.message || '').trim();
  } catch {
    message = bodyText.slice(0, 300).trim();
  }

  const combined = `${code} ${message}`.toLowerCase();

  if (status === 401 || combined.includes('invalid_api_key') || combined.includes('api key not valid')) {
    return `مفتاح ${label} غير صالح. أنشئ مفتاحاً جديداً وأعد حفظه في الإعدادات.`;
  }
  if (
    combined.includes('insufficient_quota')
    || combined.includes('insufficient balance')
    || combined.includes('billing')
    || combined.includes('exceeded your current quota')
  ) {
    return provider === 'gemini'
      ? 'تجاوزت حد الطلبات المجانية لـ Gemini أو انتهى الرصيد. راجع Google AI Studio.'
      : `رصيد ${label} غير كافٍ. أضف رصيداً ثم أعد المحاولة.`;
  }
  if (status === 429 || combined.includes('rate_limit') || combined.includes('resource_exhausted')) {
    return `تجاوز حد الطلبات على ${label}. انتظر قليلاً ثم أعد المحاولة.`;
  }
  if (status === 403 || combined.includes('unsupported_country') || combined.includes('permission')) {
    return `المنطقة أو الصلاحيات غير مدعومة لـ ${label} من هذا السيرفر.`;
  }
  if (status === 404 || (combined.includes('model') && combined.includes('not'))) {
    return `النموذج غير متاح لحساب ${label}. جرّب نموذجاً آخر من الإعدادات.`;
  }

  if (message) {
    return `خطأ ${label} (HTTP ${status}): ${message}`;
  }
  return `فشل الاتصال بـ ${label} (HTTP ${status}).`;
}

export async function postChatCompletion(
  provider: AiProvider,
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; body: string }> {
  const url = getProviderDefinition(provider).chatCompletionsUrl;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    return { ok: false, status: res.status, body };
  }
  try {
    return { ok: true, data: JSON.parse(body) };
  } catch {
    return { ok: false, status: res.status, body: body || 'استجابة غير صالحة من مزود الذكاء الاصطناعي' };
  }
}
