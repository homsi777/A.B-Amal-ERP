import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';

/**
 * تحقق مباشر من كلمة مرور المستخدم الحالي (إعادة مصادقة قبل إجراء حسّاس)،
 * بنفس أسلوب تسجيل الدخول (`bcrypt.compare` على `users.password_hash`) —
 * لا توجد دالة مشتركة جاهزة بالمشروع، فهذا تحقق مستقل بدون لمس authRoutes.ts.
 *
 * عدّاد محاولات فاشلة داخل الذاكرة فقط (لا Redis ولا جدول DB بالمشروع لهذا) —
 * 5 محاولات/15 دقيقة لكل مستخدم، يُفقَد عند إعادة تشغيل الخادم (مقبول لهذا النطاق).
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; windowStart: number }>();

export class ReauthRateLimitedError extends Error {
  code = 'REAUTH_RATE_LIMITED' as const;
  constructor() {
    super('محاولات كثيرة جداً — حاول/ي بعد قليل');
  }
}

export class ReauthPasswordInvalidError extends Error {
  code = 'PASSWORD_INVALID' as const;
  constructor() {
    super('كلمة المرور غير صحيحة');
  }
}

function checkRateLimit(userId: string): void {
  const now = Date.now();
  const entry = attempts.get(userId);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(userId, { count: 0, windowStart: now });
    return;
  }
  if (entry.count >= MAX_ATTEMPTS) {
    throw new ReauthRateLimitedError();
  }
}

function recordFailure(userId: string): void {
  const now = Date.now();
  const entry = attempts.get(userId);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(userId, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function recordSuccess(userId: string): void {
  attempts.delete(userId);
}

/** يرمي ReauthRateLimitedError أو ReauthPasswordInvalidError عند الفشل؛ لا يُرجع شيئاً عند النجاح. */
export async function verifyCurrentUserPassword(
  client: PoolClient,
  userId: string,
  plainPassword: string,
): Promise<void> {
  checkRateLimit(userId);

  const password = String(plainPassword ?? '');
  if (!password) {
    recordFailure(userId);
    throw new ReauthPasswordInvalidError();
  }

  const row = await client.query<{ password_hash: string }>(
    `SELECT password_hash FROM users WHERE id = $1`,
    [userId],
  );
  const hash = row.rows[0]?.password_hash;
  const match = hash ? await bcrypt.compare(password, hash) : false;
  if (!match) {
    recordFailure(userId);
    throw new ReauthPasswordInvalidError();
  }
  recordSuccess(userId);
}
