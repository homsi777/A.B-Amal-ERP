import crypto from 'node:crypto';
import { getEnv } from '../../config/env.js';

const PREFIX = 'enc:v1:';

function encryptionKey(): Buffer {
  const dedicated = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (dedicated) {
    return crypto.createHash('sha256').update(dedicated).digest();
  }
  return crypto.createHash('sha256').update(getEnv().JWT_SECRET).digest();
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX)) return value;
  const [ivRaw, tagRaw, dataRaw] = value.slice(PREFIX.length).split(':');
  if (!ivRaw || !tagRaw || !dataRaw) throw new Error('مفتاح مشفّر غير صالح');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function maskOpenAiKey(key: string): string {
  const value = key.trim();
  if (!value) return '';
  if (value.length <= 8) return 'sk-••••••••';
  return `sk-••••••••••••${value.slice(-4)}`;
}

export function isValidOpenAiKey(key: string): boolean {
  const value = key.trim();
  return value.length > 0 && value.startsWith('sk-');
}
