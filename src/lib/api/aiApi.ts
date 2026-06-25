import { apiFetch } from './client';

export interface AiSettingsDto {
  enabled: boolean;
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

export async function getAiSettings(): Promise<AiSettingsDto> {
  const res = await apiFetch<{ ok: boolean; data: AiSettingsDto }>('/api/ai/settings');
  return res.data;
}

export async function updateAiSettings(payload: {
  enabled: boolean;
  model: string;
  apiKey?: string;
}): Promise<AiSettingsDto> {
  const res = await apiFetch<{ ok: boolean; data: AiSettingsDto }>('/api/ai/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function testAiConnection(apiKey?: string): Promise<{ ok: true; model: string }> {
  const res = await apiFetch<{ ok: boolean; data: { ok: true; model: string } }>(
    '/api/ai/test-connection',
    {
      method: 'POST',
      body: JSON.stringify(apiKey ? { apiKey } : {}),
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

export const OPENAI_MODEL_OPTIONS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini (موصى به)' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
];
