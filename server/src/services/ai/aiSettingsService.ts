import { getPool } from '../../db/pool.js';
import {
  type AiProvider,
  getProviderDefinition,
  normalizeAiProvider,
} from './aiProviders.js';
import { formatLlmError, postChatCompletion } from './llmClient.js';
import {
  apiKeyValidationMessage,
  decryptSecret,
  encryptSecret,
  isValidApiKey,
  maskApiKey,
} from './settingsEncryption.js';

export interface AiSettingsMasked {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  hasApiKey: boolean;
  maskedApiKey: string;
}

export interface ResolvedAiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

export async function getAiSettingsMasked(companyId: string): Promise<AiSettingsMasked> {
  const pool = getPool();
  const { rows } = await pool.query<{
    is_enabled: boolean;
    provider: string;
    model_name: string;
    openai_api_key_encrypted: string | null;
  }>(
    `SELECT is_enabled, provider, model_name, openai_api_key_encrypted
     FROM ai_assistant_settings WHERE company_id = $1`,
    [companyId],
  );
  const row = rows[0];
  const provider = normalizeAiProvider(row?.provider);
  const defaultModel = getProviderDefinition(provider).defaultModel;
  if (!row) {
    return { enabled: false, provider, model: defaultModel, hasApiKey: false, maskedApiKey: '' };
  }
  const hasApiKey = Boolean(row.openai_api_key_encrypted);
  let maskedApiKey = '';
  if (hasApiKey && row.openai_api_key_encrypted) {
    try {
      maskedApiKey = maskApiKey(decryptSecret(row.openai_api_key_encrypted), provider);
    } catch {
      maskedApiKey = provider === 'gemini' ? 'AIza••••' : 'sk-••••••••';
    }
  }
  return {
    enabled: row.is_enabled,
    provider,
    model: row.model_name || defaultModel,
    hasApiKey,
    maskedApiKey,
  };
}

export async function saveAiSettings(
  companyId: string,
  userId: string,
  input: { enabled: boolean; provider: AiProvider; model: string; apiKey?: string },
): Promise<AiSettingsMasked> {
  const provider = normalizeAiProvider(input.provider);
  const model = (input.model || getProviderDefinition(provider).defaultModel).trim()
    || getProviderDefinition(provider).defaultModel;
  const apiKey = input.apiKey?.trim() ?? '';

  if (apiKey && !isValidApiKey(provider, apiKey)) {
    throw new Error(apiKeyValidationMessage(provider));
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
       company_id, is_enabled, provider, openai_api_key_encrypted, model_name,
       created_by_user_id, updated_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (company_id) DO UPDATE SET
       is_enabled = EXCLUDED.is_enabled,
       provider = EXCLUDED.provider,
       model_name = EXCLUDED.model_name,
       openai_api_key_encrypted = COALESCE(EXCLUDED.openai_api_key_encrypted, ai_assistant_settings.openai_api_key_encrypted),
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = now()`,
    [companyId, input.enabled, provider, encryptedKey, model, userId],
  );

  return getAiSettingsMasked(companyId);
}

export async function resolveAiConfig(companyId: string): Promise<ResolvedAiConfig | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    provider: string;
    model_name: string;
    openai_api_key_encrypted: string | null;
  }>(
    `SELECT provider, model_name, openai_api_key_encrypted FROM ai_assistant_settings
     WHERE company_id = $1 AND is_enabled = true`,
    [companyId],
  );
  const row = rows[0];
  if (!row?.openai_api_key_encrypted) return null;
  const provider = normalizeAiProvider(row.provider);
  return {
    provider,
    apiKey: decryptSecret(row.openai_api_key_encrypted),
    model: row.model_name?.trim() || getProviderDefinition(provider).defaultModel,
  };
}

export async function testAiConnection(
  companyId: string,
  apiKeyOverride?: string,
  modelOverride?: string,
  providerOverride?: AiProvider,
): Promise<{ ok: true; model: string; provider: AiProvider }> {
  const settings = await getAiSettingsMasked(companyId);
  const provider = providerOverride ? normalizeAiProvider(providerOverride) : settings.provider;
  const key = apiKeyOverride?.trim() || (await resolveAiConfig(companyId))?.apiKey;
  if (!key || !isValidApiKey(provider, key)) {
    throw new Error('لم يتم ضبط مفتاح الذكاء الاصطناعي بعد. يرجى ضبطه من الإعدادات.');
  }
  const model = modelOverride?.trim()
    || (provider === settings.provider ? settings.model : getProviderDefinition(provider).defaultModel);
  const result = await postChatCompletion(provider, key, {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 16,
  });
  if (!result.ok) {
    throw new Error(formatLlmError(provider, result.status, result.body));
  }
  return { ok: true, model, provider };
}
