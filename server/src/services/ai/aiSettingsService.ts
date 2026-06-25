import { getPool } from '../../db/pool.js';
import {
  decryptSecret,
  encryptSecret,
  isValidOpenAiKey,
  maskOpenAiKey,
} from './settingsEncryption.js';

export interface AiSettingsMasked {
  enabled: boolean;
  model: string;
  hasApiKey: boolean;
  maskedApiKey: string;
}

const DEFAULT_MODEL = process.env.DEFAULT_OPENAI_MODEL?.trim() || 'gpt-4o-mini';

export async function getAiSettingsMasked(companyId: string): Promise<AiSettingsMasked> {
  const pool = getPool();
  const { rows } = await pool.query<{
    is_enabled: boolean;
    model_name: string;
    openai_api_key_encrypted: string | null;
  }>(
    `SELECT is_enabled, model_name, openai_api_key_encrypted
     FROM ai_assistant_settings WHERE company_id = $1`,
    [companyId],
  );
  const row = rows[0];
  if (!row) {
    return { enabled: false, model: DEFAULT_MODEL, hasApiKey: false, maskedApiKey: '' };
  }
  const hasApiKey = Boolean(row.openai_api_key_encrypted);
  let maskedApiKey = '';
  if (hasApiKey && row.openai_api_key_encrypted) {
    try {
      maskedApiKey = maskOpenAiKey(decryptSecret(row.openai_api_key_encrypted));
    } catch {
      maskedApiKey = 'sk-••••••••';
    }
  }
  return {
    enabled: row.is_enabled,
    model: row.model_name || DEFAULT_MODEL,
    hasApiKey,
    maskedApiKey,
  };
}

export async function saveAiSettings(
  companyId: string,
  userId: string,
  input: { enabled: boolean; model: string; apiKey?: string },
): Promise<AiSettingsMasked> {
  const model = (input.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const apiKey = input.apiKey?.trim() ?? '';

  if (apiKey && !isValidOpenAiKey(apiKey)) {
    throw new Error('مفتاح OpenAI غير صالح. يجب أن يبدأ بـ sk-');
  }

  const pool = getPool();
  const existing = await pool.query<{ openai_api_key_encrypted: string | null }>(
    `SELECT openai_api_key_encrypted FROM ai_assistant_settings WHERE company_id = $1`,
    [companyId],
  );

  let encryptedKey: string | null = existing.rows[0]?.openai_api_key_encrypted ?? null;
  if (apiKey) {
    encryptedKey = encryptSecret(apiKey);
  }

  await pool.query(
    `INSERT INTO ai_assistant_settings (
       company_id, is_enabled, openai_api_key_encrypted, model_name,
       created_by_user_id, updated_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (company_id) DO UPDATE SET
       is_enabled = EXCLUDED.is_enabled,
       model_name = EXCLUDED.model_name,
       openai_api_key_encrypted = COALESCE(EXCLUDED.openai_api_key_encrypted, ai_assistant_settings.openai_api_key_encrypted),
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = now()`,
    [companyId, input.enabled, encryptedKey, model, userId],
  );

  return getAiSettingsMasked(companyId);
}

export async function resolveOpenAiApiKey(companyId: string): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query<{ openai_api_key_encrypted: string | null }>(
    `SELECT openai_api_key_encrypted FROM ai_assistant_settings
     WHERE company_id = $1 AND is_enabled = true`,
    [companyId],
  );
  const enc = rows[0]?.openai_api_key_encrypted;
  if (!enc) return null;
  return decryptSecret(enc);
}

export async function resolveAiModel(companyId: string): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query<{ model_name: string }>(
    `SELECT model_name FROM ai_assistant_settings WHERE company_id = $1`,
    [companyId],
  );
  return rows[0]?.model_name?.trim() || DEFAULT_MODEL;
}

export async function testOpenAiConnection(companyId: string, apiKeyOverride?: string): Promise<{ ok: true; model: string }> {
  const key = apiKeyOverride?.trim() || (await resolveOpenAiApiKey(companyId));
  if (!key || !isValidOpenAiKey(key)) {
    throw new Error('لم يتم ضبط مفتاح OpenAI بعد. يرجى ضبطه من الإعدادات.');
  }
  const model = await resolveAiModel(companyId);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText.includes('invalid_api_key') ? 'مفتاح OpenAI غير صالح.' : 'فشل اختبار الاتصال بـ OpenAI.');
  }
  return { ok: true, model };
}
