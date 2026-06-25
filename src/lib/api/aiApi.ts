import { apiFetch } from './client';

export type AiProvider = 'openai' | 'gemini' | 'deepseek';

export interface AiSettingsDto {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  hasApiKey: boolean;
  maskedApiKey: string;
}

export interface FabricChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface FabricChatResponse {
  reply: string;
  sessionId: string | null;
  errorCode: string | null;
}

export const AI_PROVIDER_OPTIONS: Array<{ value: AiProvider; label: string; docsUrl: string }> = [
  { value: 'gemini', label: 'Google Gemini (مجاني محدود — موصى به)', docsUrl: 'https://aistudio.google.com/app/apikey' },
  { value: 'deepseek', label: 'DeepSeek (رخيص)', docsUrl: 'https://platform.deepseek.com/api_keys' },
  { value: 'openai', label: 'OpenAI', docsUrl: 'https://platform.openai.com/api-keys' },
];

export const AI_MODEL_OPTIONS: Record<AiProvider, Array<{ value: string; label: string }>> = {
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
  ],
  gemini: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (موصى به)' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek Chat' },
    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  ],
};

export const AI_KEY_HINTS: Record<AiProvider, { hint: string; placeholder: string }> = {
  gemini: {
    hint: 'مفتاح Gemini من Google AI Studio — يبدأ عادة بـ AIza',
    placeholder: 'AIza...',
  },
  deepseek: {
    hint: 'مفتاح DeepSeek يبدأ بـ sk-',
    placeholder: 'sk-...',
  },
  openai: {
    hint: 'مفتاح OpenAI يبدأ بـ sk-',
    placeholder: 'sk-...',
  },
};

export function isValidApiKeyForProvider(provider: AiProvider, key: string): boolean {
  const value = key.trim();
  if (!value || value.length < 12) return false;
  if (provider === 'gemini') return value.startsWith('AIza') || value.length >= 20;
  return value.startsWith('sk-');
}

export function apiKeyValidationMessage(provider: AiProvider): string {
  if (provider === 'gemini') {
    return 'مفتاح Google Gemini غير صالح. أنشئه من Google AI Studio (يبدأ عادة بـ AIza).';
  }
  if (provider === 'deepseek') {
    return 'مفتاح DeepSeek غير صالح. يجب أن يبدأ بـ sk-.';
  }
  return 'مفتاح OpenAI غير صالح. يجب أن يبدأ بـ sk-.';
}

export async function getAiSettings(): Promise<AiSettingsDto> {
  const res = await apiFetch<{ ok: boolean; data: AiSettingsDto }>('/api/ai/settings');
  return res.data;
}

export async function updateAiSettings(payload: {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  apiKey?: string;
}): Promise<AiSettingsDto> {
  const res = await apiFetch<{ ok: boolean; data: AiSettingsDto }>('/api/ai/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export type AiTestConnectionResult =
  | { success: true; model: string; provider?: AiProvider }
  | { success: false; message: string };

export async function testAiConnection(
  apiKey?: string,
  model?: string,
  provider?: AiProvider,
): Promise<AiTestConnectionResult> {
  const res = await apiFetch<{ ok: boolean; data: AiTestConnectionResult }>(
    '/api/ai/test-connection',
    {
      method: 'POST',
      body: JSON.stringify({
        ...(apiKey ? { apiKey } : {}),
        ...(model ? { model } : {}),
        ...(provider ? { provider } : {}),
      }),
    },
  );
  return res.data;
}

export async function sendFabricChatMessage(payload: {
  message: string;
  history?: FabricChatMessage[];
  sessionId?: string | null;
}): Promise<FabricChatResponse> {
  const res = await apiFetch<{ ok: boolean; data: FabricChatResponse }>('/api/ai/fabric-chat', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}
