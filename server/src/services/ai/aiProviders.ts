export type AiProvider = 'openai' | 'gemini' | 'deepseek';

export interface AiProviderDefinition {
  id: AiProvider;
  labelAr: string;
  defaultModel: string;
  chatCompletionsUrl: string;
  models: Array<{ value: string; label: string }>;
  keyHintAr: string;
  keyPlaceholder: string;
  docsUrl: string;
}

export const AI_PROVIDERS: Record<AiProvider, AiProviderDefinition> = {
  openai: {
    id: 'openai',
    labelAr: 'OpenAI',
    defaultModel: process.env.DEFAULT_OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    chatCompletionsUrl: 'https://api.openai.com/v1/chat/completions',
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { value: 'gpt-4.1', label: 'GPT-4.1' },
    ],
    keyHintAr: 'مفتاح OpenAI يبدأ بـ sk-',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    id: 'gemini',
    labelAr: 'Google Gemini',
    defaultModel: process.env.DEFAULT_GEMINI_MODEL?.trim() || 'gemini-2.0-flash',
    chatCompletionsUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (موصى به — مجاني محدود)' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
    keyHintAr: 'مفتاح Gemini من Google AI Studio — يبدأ عادة بـ AIza',
    keyPlaceholder: 'AIza...',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  deepseek: {
    id: 'deepseek',
    labelAr: 'DeepSeek',
    defaultModel: process.env.DEFAULT_DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
    chatCompletionsUrl: 'https://api.deepseek.com/chat/completions',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat (V4 Flash)' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ],
    keyHintAr: 'مفتاح DeepSeek يبدأ بـ sk-',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
};

export function normalizeAiProvider(value: string | null | undefined): AiProvider {
  if (value === 'gemini' || value === 'deepseek' || value === 'openai') return value;
  return 'openai';
}

export function getProviderDefinition(provider: AiProvider): AiProviderDefinition {
  return AI_PROVIDERS[provider];
}
