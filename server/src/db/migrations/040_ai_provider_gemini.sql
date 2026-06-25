-- Multi-provider AI assistant (OpenAI, Google Gemini, DeepSeek).

ALTER TABLE ai_assistant_settings
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'openai';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_assistant_settings_provider_chk'
  ) THEN
    ALTER TABLE ai_assistant_settings
      ADD CONSTRAINT ai_assistant_settings_provider_chk
      CHECK (provider IN ('openai', 'gemini', 'deepseek'));
  END IF;
END $$;
