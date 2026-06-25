/** تحويل أخطاء OpenAI إلى رسائل عربية آمنة (بدون كشف المفتاح). */
export function formatOpenAiError(status: number, bodyText: string): string {
  let code = '';
  let message = '';
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; code?: string; type?: string };
    };
    code = String(parsed.error?.code || parsed.error?.type || '').trim();
    message = String(parsed.error?.message || '').trim();
  } catch {
    message = bodyText.slice(0, 300).trim();
  }

  const combined = `${code} ${message}`.toLowerCase();

  if (status === 401 || combined.includes('invalid_api_key') || combined.includes('incorrect api key')) {
    return 'مفتاح OpenAI غير صالح أو ملغى. أنشئ مفتاحاً جديداً من platform.openai.com وأعد حفظه في الإعدادات.';
  }
  if (
    combined.includes('insufficient_quota')
    || combined.includes('billing')
    || combined.includes('exceeded your current quota')
  ) {
    return 'رصيد OpenAI غير كافٍ أو لا توجد طريقة دفع مفعّلة. أضف رصيداً/بطاقة في حساب OpenAI ثم أعد المحاولة.';
  }
  if (status === 429 || combined.includes('rate_limit')) {
    return 'تجاوز حد الطلبات على OpenAI. انتظر قليلاً ثم أعد المحاولة.';
  }
  if (status === 403 || combined.includes('unsupported_country')) {
    return 'حساب OpenAI أو المنطقة غير مدعومة لهذا الطلب.';
  }
  if (status === 404 || combined.includes('model') && combined.includes('not')) {
    return `النموذج غير متاح لحسابك. جرّب gpt-4o-mini من الإعدادات. (${message || code})`;
  }

  if (message) {
    return `خطأ OpenAI (HTTP ${status}): ${message}`;
  }
  return `فشل الاتصال بـ OpenAI (HTTP ${status}).`;
}

export async function postOpenAiChatCompletion(
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; body: string }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
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
    return { ok: false, status: res.status, body: body || 'استجابة غير صالحة من OpenAI' };
  }
}
