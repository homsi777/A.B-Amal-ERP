import crypto from 'node:crypto';
import { getEnv } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { runPostActivationBootstrap } from './postActivationBootstrap.js';

const KEY_REGEX = /^[A-Z0-9]{4}\.[A-Z0-9]{4}\.[A-Z0-9]{4}\.[A-Z0-9]{4}$/;
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type ActivationPlanCode = 'LITE' | 'PRO' | 'FULL';
export type ActivationKeyStatus = 'UNUSED' | 'USED' | 'REVOKED' | 'EXPIRED';
export type ActivationEventType =
  | 'KEY_GENERATED'
  | 'ACTIVATION_SUCCESS'
  | 'ACTIVATION_FAILED'
  | 'DUPLICATE_ATTEMPT'
  | 'REVOKED_ATTEMPT'
  | 'EXPIRED_ATTEMPT'
  | 'KEY_REVOKED'
  | 'STATUS_CHECK';

export type ActivationStatusDto = {
  active: boolean;
  requireActive: boolean;
  planCode?: ActivationPlanCode;
  activatedAt?: string;
  keySuffix?: string;
};

export type ActivationRequestMeta = {
  ipAddress?: string;
  userAgent?: string;
  deviceFingerprint?: string;
  deviceName?: string;
  osInfo?: string;
  appVersion?: string;
};

export type ActivationUserContext = {
  companyId?: string;
  userId?: string;
};

export class ActivationError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
  ) {
    super(message);
    this.name = 'ActivationError';
  }
}

function requirePepper(): string {
  const pepper = getEnv().ACTIVATION_KEY_PEPPER?.trim();
  if (!pepper) {
    throw new ActivationError('إعدادات التفعيل غير مكتملة على الخادم.', 500, 'ACTIVATION_CONFIG_MISSING');
  }
  return pepper;
}

export function normalizeActivationKey(rawKey: string): string {
  return String(rawKey || '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '.')
    .replace(/\s+/g, '');
}

export function validateActivationKeyFormat(key: string): boolean {
  return KEY_REGEX.test(key);
}

function keySuffix(key: string): string {
  return key.replace(/\./g, '').slice(-4);
}

export function hashActivationKey(key: string): string {
  return crypto.createHash('sha256').update(`${requirePepper()}:${key}`, 'utf8').digest('hex');
}

export function generateActivationKey(): string {
  let raw = '';
  for (let i = 0; i < 16; i += 1) {
    raw += KEY_ALPHABET[crypto.randomInt(0, KEY_ALPHABET.length)];
  }
  return raw.match(/.{1,4}/g)?.join('.') ?? raw;
}

async function getDefaultCompanyId(): Promise<string | null> {
  const row = await getPool().query<{ id: string }>('SELECT id FROM companies ORDER BY created_at ASC LIMIT 1');
  return row.rows[0]?.id ?? null;
}

/**
 * يضمن وجود شركة افتراضية قبل التفعيل من شاشة الدخول (بدون seed كامل).
 * يطابق إدراج البذرة: CLOTEX-MAIN / CLOTEX.
 */
async function ensureDefaultCompanyForActivation(): Promise<string> {
  const row = await getPool().query<{ id: string }>(
    `INSERT INTO companies (code, name, base_currency_code)
     VALUES ('CLOTEX-MAIN', 'CLOTEX', 'USD')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
  );
  const id = row.rows[0]?.id;
  if (!id) throw new ActivationError('تعذّر تهيئة شركة افتراضية للتفعيل.', 500, 'COMPANY_BOOTSTRAP_FAILED');
  return id;
}

async function resolveCompanyIdForActivation(userCompanyId?: string | null): Promise<string> {
  if (userCompanyId) return userCompanyId;
  const existing = await getDefaultCompanyId();
  if (existing) return existing;
  return ensureDefaultCompanyForActivation();
}

async function writeActivationEvent(input: {
  companyId?: string | null;
  activationKeyId?: string | null;
  eventType: ActivationEventType;
  keySuffix?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  appVersion?: string | null;
  message?: string | null;
  createdByUserId?: string | null;
}) {
  await getPool().query(
    `INSERT INTO activation_events
       (company_id, activation_key_id, event_type, key_suffix, ip_address, user_agent,
        device_fingerprint, app_version, message, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.companyId ?? null,
      input.activationKeyId ?? null,
      input.eventType,
      input.keySuffix ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.deviceFingerprint ?? null,
      input.appVersion ?? null,
      input.message ?? null,
      input.createdByUserId ?? null,
    ],
  );
}

export async function generateDevKeysIfEnabled(count = 20): Promise<{ generated: number }> {
  if (!getEnv().ACTIVATION_GENERATE_DEV_KEYS) return { generated: 0 };
  const existing = await getPool().query<{ total: string }>('SELECT COUNT(*) AS total FROM activation_keys');
  if (Number(existing.rows[0]?.total ?? 0) > 0) return { generated: 0 };
  const keys = await generateActivationKeys(count, 'FULL', null, { notes: 'development seed key' });
  // Development-only console output is intentionally count-only; raw keys are not printed.
  return { generated: keys.length };
}

export async function generateActivationKeys(
  count: number,
  planCode: ActivationPlanCode,
  createdByUserId?: string | null,
  options: {
    expiresAt?: string | null;
    notes?: string | null;
    /** رسالة حدث KEY_GENERATED (افتراضي: واجهة API المحمية). */
    eventMessage?: string | null;
  } = {},
): Promise<string[]> {
  requirePepper();
  const safeCount = Math.max(1, Math.min(100, Math.floor(count)));
  const keys = Array.from({ length: safeCount }, () => generateActivationKey());
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const key of keys) {
      const suffix = keySuffix(key);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO activation_keys
           (key_hash, key_suffix, status, plan_code, max_activations, activation_count,
            expires_at, notes, created_by_user_id)
         VALUES ($1,$2,'UNUSED',$3,1,0,$4,$5,$6)
         RETURNING id`,
        [hashActivationKey(key), suffix, planCode, options.expiresAt ?? null, options.notes ?? null, createdByUserId ?? null],
      );
      await client.query(
        `INSERT INTO activation_events
           (activation_key_id, event_type, key_suffix, message, created_by_user_id)
         VALUES ($1,'KEY_GENERATED',$2,$3,$4)`,
        [
          inserted.rows[0].id,
          suffix,
          options.eventMessage ?? 'key generated by protected backend API',
          createdByUserId ?? null,
        ],
      );
    }
    await client.query('COMMIT');
    return keys;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getActivationStatus(companyId?: string | null): Promise<ActivationStatusDto> {
  const targetCompanyId = companyId || await getDefaultCompanyId();
  if (!targetCompanyId) return { active: false, requireActive: getEnv().ACTIVATION_REQUIRE_ACTIVE };

  const row = await getPool().query<{ value: Omit<ActivationStatusDto, 'requireActive'> }>(
    `SELECT value FROM system_settings WHERE company_id=$1 AND key='activation.status' LIMIT 1`,
    [targetCompanyId],
  );
  const value = row.rows[0]?.value;
  if (!value?.active) return { active: false, requireActive: getEnv().ACTIVATION_REQUIRE_ACTIVE };
  return {
    active: true,
    requireActive: getEnv().ACTIVATION_REQUIRE_ACTIVE,
    planCode: value.planCode,
    activatedAt: value.activatedAt,
    keySuffix: value.keySuffix,
  };
}

async function upsertDevice(input: {
  companyId: string;
  activationKeyId: string;
  meta: ActivationRequestMeta;
}) {
  if (!input.meta.deviceFingerprint?.trim()) return;
  await getPool().query(
    `INSERT INTO activation_devices
       (company_id, activation_key_id, device_fingerprint, device_name, os_info, app_version)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (activation_key_id, device_fingerprint)
     DO UPDATE SET
       device_name=EXCLUDED.device_name,
       os_info=EXCLUDED.os_info,
       app_version=EXCLUDED.app_version,
       last_seen_at=now(),
       is_active=true`,
    [
      input.companyId,
      input.activationKeyId,
      input.meta.deviceFingerprint,
      input.meta.deviceName ?? null,
      input.meta.osInfo ?? null,
      input.meta.appVersion ?? null,
    ],
  );
}

export async function activateProject(
  rawKey: string,
  userContext: ActivationUserContext,
  requestMeta: ActivationRequestMeta = {},
): Promise<ActivationStatusDto> {
  const normalized = normalizeActivationKey(rawKey);
  const suffix = keySuffix(normalized);
  const companyId = await resolveCompanyIdForActivation(userContext.companyId);
  if (!validateActivationKeyFormat(normalized)) {
    await writeActivationEvent({
      companyId,
      eventType: 'ACTIVATION_FAILED',
      keySuffix: suffix || null,
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
      deviceFingerprint: requestMeta.deviceFingerprint,
      appVersion: requestMeta.appVersion,
      message: 'invalid format',
      createdByUserId: userContext.userId,
    });
    throw new ActivationError('صيغة مفتاح التفعيل غير صحيحة.', 400, 'INVALID_FORMAT');
  }

  const hash = hashActivationKey(normalized);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const row = await client.query<{
      id: string;
      company_id: string | null;
      status: ActivationKeyStatus;
      plan_code: ActivationPlanCode;
      max_activations: number;
      activation_count: number;
      key_suffix: string;
      expires_at: Date | null;
    }>(
      `SELECT id, company_id, status, plan_code, max_activations, activation_count, key_suffix, expires_at
       FROM activation_keys
       WHERE key_hash=$1
       FOR UPDATE`,
      [hash],
    );

    const activationKey = row.rows[0];
    if (!activationKey || (activationKey.company_id && activationKey.company_id !== companyId)) {
      await client.query(
        `INSERT INTO activation_events
           (company_id, event_type, key_suffix, ip_address, user_agent, device_fingerprint, app_version, message, created_by_user_id)
         VALUES ($1,'ACTIVATION_FAILED',$2,$3,$4,$5,$6,$7,$8)`,
        [
          companyId,
          suffix,
          requestMeta.ipAddress ?? null,
          requestMeta.userAgent ?? null,
          requestMeta.deviceFingerprint ?? null,
          requestMeta.appVersion ?? null,
          'not found',
          userContext.userId ?? null,
        ],
      );
      await client.query('COMMIT');
      throw new ActivationError('مفتاح التفعيل غير صحيح.', 404, 'KEY_NOT_FOUND');
    }

    if (activationKey.expires_at && activationKey.expires_at.getTime() < Date.now()) {
      await client.query(`UPDATE activation_keys SET status='EXPIRED', updated_at=now() WHERE id=$1`, [activationKey.id]);
      await client.query(
        `INSERT INTO activation_events
           (company_id, activation_key_id, event_type, key_suffix, ip_address, user_agent, device_fingerprint, app_version, message, created_by_user_id)
         VALUES ($1,$2,'EXPIRED_ATTEMPT',$3,$4,$5,$6,$7,$8,$9)`,
        [companyId, activationKey.id, activationKey.key_suffix, requestMeta.ipAddress ?? null, requestMeta.userAgent ?? null, requestMeta.deviceFingerprint ?? null, requestMeta.appVersion ?? null, 'expired key', userContext.userId ?? null],
      );
      await client.query('COMMIT');
      throw new ActivationError('مفتاح التفعيل منتهي الصلاحية.', 409, 'KEY_EXPIRED');
    }

    if (activationKey.status === 'REVOKED') {
      await client.query(
        `INSERT INTO activation_events
           (company_id, activation_key_id, event_type, key_suffix, ip_address, user_agent, device_fingerprint, app_version, message, created_by_user_id)
         VALUES ($1,$2,'REVOKED_ATTEMPT',$3,$4,$5,$6,$7,$8,$9)`,
        [companyId, activationKey.id, activationKey.key_suffix, requestMeta.ipAddress ?? null, requestMeta.userAgent ?? null, requestMeta.deviceFingerprint ?? null, requestMeta.appVersion ?? null, 'revoked key', userContext.userId ?? null],
      );
      await client.query('COMMIT');
      throw new ActivationError('مفتاح التفعيل موقوف.', 409, 'KEY_REVOKED');
    }

    if (activationKey.status === 'USED' || activationKey.activation_count >= activationKey.max_activations) {
      await client.query(
        `INSERT INTO activation_events
           (company_id, activation_key_id, event_type, key_suffix, ip_address, user_agent, device_fingerprint, app_version, message, created_by_user_id)
         VALUES ($1,$2,'DUPLICATE_ATTEMPT',$3,$4,$5,$6,$7,$8,$9)`,
        [companyId, activationKey.id, activationKey.key_suffix, requestMeta.ipAddress ?? null, requestMeta.userAgent ?? null, requestMeta.deviceFingerprint ?? null, requestMeta.appVersion ?? null, 'already used', userContext.userId ?? null],
      );
      await client.query('COMMIT');
      throw new ActivationError('مفتاح التفعيل مستخدم مسبقاً.', 409, 'KEY_ALREADY_USED');
    }

    const nextCount = activationKey.activation_count + 1;
    const nextStatus = nextCount >= activationKey.max_activations ? 'USED' : 'UNUSED';
    const activatedAt = new Date().toISOString();
    await client.query(
      `UPDATE activation_keys
          SET activation_count=$2,
              status=$3,
              activated_company_id=$4,
              activated_by_user_id=$5,
              activated_at=now(),
              updated_at=now()
        WHERE id=$1`,
      [activationKey.id, nextCount, nextStatus, companyId, userContext.userId ?? null],
    );

    const activationStatus: ActivationStatusDto = {
      active: true,
      requireActive: getEnv().ACTIVATION_REQUIRE_ACTIVE,
      planCode: activationKey.plan_code,
      activatedAt,
      keySuffix: activationKey.key_suffix,
    };
    await client.query(
      `INSERT INTO system_settings(company_id, key, value)
       VALUES($1,'activation.status',$2::jsonb)
       ON CONFLICT (company_id, key) DO UPDATE SET value=EXCLUDED.value`,
      [companyId, JSON.stringify(activationStatus)],
    );

    await client.query(
      `INSERT INTO activation_events
         (company_id, activation_key_id, event_type, key_suffix, ip_address, user_agent, device_fingerprint, app_version, message, created_by_user_id)
       VALUES ($1,$2,'ACTIVATION_SUCCESS',$3,$4,$5,$6,$7,$8,$9)`,
      [companyId, activationKey.id, activationKey.key_suffix, requestMeta.ipAddress ?? null, requestMeta.userAgent ?? null, requestMeta.deviceFingerprint ?? null, requestMeta.appVersion ?? null, 'activation success', userContext.userId ?? null],
    );

    await client.query('COMMIT');
    await upsertDevice({ companyId, activationKeyId: activationKey.id, meta: requestMeta });
    try {
      await runPostActivationBootstrap(companyId);
    } catch (bootErr) {
      console.error('[activation] فشل تهيئة المستخدم/الأدوار بعد التفعيل:', bootErr);
    }
    return activationStatus;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore completed transaction
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function requireActiveActivation(companyId?: string | null): Promise<boolean> {
  if (!getEnv().ACTIVATION_REQUIRE_ACTIVE) return true;
  const targetCompanyId = companyId || await getDefaultCompanyId();
  if (!targetCompanyId) return false;
  const row = await getPool().query<{ value: { active?: boolean } }>(
    `SELECT value FROM system_settings WHERE company_id=$1 AND key='activation.status' LIMIT 1`,
    [targetCompanyId],
  );
  return Boolean(row.rows[0]?.value?.active);
}

export async function listActivationKeysForAdmin(filters: { status?: string; page?: number; pageSize?: number } = {}) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filters.status) {
    params.push(filters.status);
    where.push(`status=$${params.length}`);
  }
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, filters.pageSize ?? 100));
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await getPool().query(
    `SELECT id, key_suffix, status, plan_code, activation_count, max_activations,
            activated_at, expires_at, notes, created_at, updated_at
     FROM activation_keys
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.rows;
}

export async function listActivationEvents(filters: { page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, filters.pageSize ?? 100));
  const rows = await getPool().query(
    `SELECT id, company_id, activation_key_id, event_type, key_suffix, ip_address,
            user_agent, device_fingerprint, app_version, message, created_by_user_id, created_at
     FROM activation_events
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [pageSize, (page - 1) * pageSize],
  );
  return rows.rows;
}

export async function listActivationDevices() {
  const rows = await getPool().query(
    `SELECT id, company_id, activation_key_id, device_fingerprint, device_name, os_info,
            app_version, first_seen_at, last_seen_at, is_active
     FROM activation_devices
     ORDER BY last_seen_at DESC
     LIMIT 100`,
  );
  return rows.rows;
}

export async function revokeActivationKey(id: string, userId?: string | null): Promise<{ id: string; status: string }> {
  const row = await getPool().query<{ id: string; status: string; key_suffix: string }>(
    `UPDATE activation_keys
        SET status='REVOKED',
            revoked_by_user_id=$2,
            revoked_at=now(),
            updated_at=now()
      WHERE id=$1
      RETURNING id, status, key_suffix`,
    [id, userId ?? null],
  );
  if (!row.rows.length) throw new ActivationError('مفتاح التفعيل غير موجود.', 404, 'KEY_NOT_FOUND');
  await writeActivationEvent({
    activationKeyId: row.rows[0].id,
    eventType: 'KEY_REVOKED',
    keySuffix: row.rows[0].key_suffix,
    message: 'key revoked by admin',
    createdByUserId: userId,
  });
  return { id: row.rows[0].id, status: row.rows[0].status };
}
