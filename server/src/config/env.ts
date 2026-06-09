import { config as loadDotenv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Desktop EXE passes env via Electron parent; skip dotenv inside packaged/runtime bundle. */
if (process.env.CLOTEX_EMBEDDED_SERVER !== '1') {
  loadDotenv({ path: path.resolve(__dirname, '../../.env') });
}

/** قراءة متغيرات منطقية من .env — لا تستخدم z.coerce.boolean() مع القيم النصية لأن Boolean("false") = true */
function parseBoolEnv(val: unknown, defaultVal: boolean): boolean {
  if (val === undefined || val === null || val === '') return defaultVal;
  const s = String(val).trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  return defaultVal;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4010),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL مطلوب'),
  JWT_SECRET: z.string().min(8).optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default(
    'http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173',
  ),
  APP_BASE_URL: z.string().default('http://127.0.0.1:4010'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  ACTIVATION_KEY_PEPPER: z.string().optional(),
  ACTIVATION_GENERATE_DEV_KEYS: z.boolean().default(false),
  ACTIVATION_REQUIRE_ACTIVE: z.boolean().default(true),
  SEED_ADMIN_PASSWORD: z.string().optional(),
});

type ParsedEnv = z.infer<typeof envSchema>;
/** بعد التحقق، JWT_SECRET دائماً معرّف */
export type Env = Omit<ParsedEnv, 'JWT_SECRET'> & { JWT_SECRET: string };

function parseEnv(): Env {
  const raw = {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    APP_BASE_URL: process.env.APP_BASE_URL,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    ACTIVATION_KEY_PEPPER: process.env.ACTIVATION_KEY_PEPPER,
    ACTIVATION_GENERATE_DEV_KEYS: parseBoolEnv(process.env.ACTIVATION_GENERATE_DEV_KEYS, false),
    ACTIVATION_REQUIRE_ACTIVE: parseBoolEnv(process.env.ACTIVATION_REQUIRE_ACTIVE, true),
    SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD,
  };

  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`إعدادات البيئة غير صالحة: ${JSON.stringify(msg)}`);
  }

  let jwtSecret = parsed.data.JWT_SECRET;
  if (!jwtSecret) {
    if (parsed.data.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET مطلوب في الإنتاج.');
    }
    jwtSecret = 'dev-only-jwt-secret-min-32-characters-long!';
    console.warn('[env] تحذير: استخدام JWT_SECRET افتراضي للتطوير فقط. عرّف JWT_SECRET في server/.env للإنتاج.');
  }

  const data = { ...parsed.data, JWT_SECRET: jwtSecret };

  if (data.NODE_ENV === 'production' && jwtSecret.length < 32) {
    console.warn('[env] تحذير: يُفضّل JWT_SECRET بطول 32 حرفاً أو أكثر في الإنتاج.');
  }

  return data as Env;
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) {
    cached = parseEnv();
  }
  return cached;
}

export function getCorsOrigins(): string[] {
  return getEnv()
    .CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
