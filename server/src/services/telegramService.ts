import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import { getEnv } from '../config/env.js';
import { getPool } from '../db/pool.js';

export type TelegramTargetType = 'USER' | 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'OTHER';

export interface TelegramLinkPayload {
  chatId: string;
  telegramUserId?: string;
  telegramUsername?: string;
  telegramFirstName?: string;
  telegramLastName?: string;
  telegramDisplayName?: string;
  chatType?: string;
  targetType: TelegramTargetType;
  targetId?: string | null;
  targetName: string;
  canReceiveInvoices?: boolean;
  canReceiveVouchers?: boolean;
  canReceiveReports?: boolean;
  canReceiveAlerts?: boolean;
  notes?: string;
}

export interface TelegramDocumentPayload {
  documentType: 'INVOICE' | 'STATEMENT' | 'VOUCHER' | 'TEST';
  partyType?: 'customer' | 'supplier' | 'user' | 'employee' | 'other' | 'system';
  partyId?: string | null;
  targetType?: TelegramTargetType;
  targetId?: string | null;
  chatId?: string;
  message: string;
  pdfHtml?: string;
  fileName?: string;
  caption?: string;
  eventType?: string;
}

export class TelegramDuplicateError extends Error {
  constructor(
    message: string,
    public linkedTargetName: string,
  ) {
    super(message);
    this.name = 'TelegramDuplicateError';
  }
}

const TOKEN_PREFIX = 'enc:v1:';

function encryptionKey(): Buffer {
  return crypto.createHash('sha256').update(getEnv().JWT_SECRET).digest();
}

function encryptToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${TOKEN_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptToken(value: string): string {
  if (!value.startsWith(TOKEN_PREFIX)) return value;
  const [ivRaw, tagRaw, dataRaw] = value.slice(TOKEN_PREFIX.length).split(':');
  if (!ivRaw || !tagRaw || !dataRaw) throw new Error('Invalid encrypted Telegram token');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function maskToken(token: string): string {
  const value = token.trim();
  if (!value) return '';
  return `${'*'.repeat(Math.max(8, value.length - 4))}${value.slice(-4)}`;
}

function cleanChatId(chatId: string): string {
  return String(chatId || '').trim();
}

function telegramRequest<T>(botToken: string, method: string, payload?: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : '';
    const req = https.request(
      {
        method: body ? 'POST' : 'GET',
        hostname: 'api.telegram.org',
        path: `/bot${botToken}/${method}`,
        headers: body
          ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }
          : undefined,
        timeout: 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            const json = JSON.parse(text) as T & { ok?: boolean; description?: string };
            if ((res.statusCode ?? 500) >= 400 || json.ok === false) {
              reject(new Error(json.description || `Telegram HTTP ${res.statusCode}`));
              return;
            }
            resolve(json);
          } catch {
            reject(new Error(text || 'Telegram returned an invalid response'));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Telegram request timeout')));
    if (body) req.write(body);
    req.end();
  });
}

const findBrowserExecutable = () => {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => fs.existsSync(candidate));
};

async function renderPdf(html: string): Promise<Uint8Array> {
  const puppeteer = await import('puppeteer-core');
  const executablePath = findBrowserExecutable();
  if (!executablePath) throw new Error('No Chrome/Edge executable found for PDF rendering');

  const browser = await puppeteer.default.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
  } finally {
    await browser.close();
  }
}

function telegramMultipartDocument(
  botToken: string,
  chatId: string,
  pdf: Uint8Array,
  fileName: string,
  caption = 'PDF',
): Promise<{ ok: boolean; body: unknown; messageId?: string }> {
  const boundary = `----clotex-telegram-${Date.now()}`;
  const safeFileName = fileName.replace(/[\r\n"]/g, '_') || 'document.pdf';
  const safeCaption = caption.replace(/[\r\n]/g, ' ').trim() || 'PDF';
  const requestBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${safeCaption}\r\n`, 'utf8'),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${safeFileName}"\r\nContent-Type: application/pdf\r\n\r\n`),
    Buffer.from(pdf),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${botToken}/sendDocument`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': requestBody.length,
        },
        timeout: 30_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: any = text;
          try {
            body = JSON.parse(text);
          } catch {
            body = { raw: text };
          }
          resolve({
            ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300 && body?.ok !== false,
            body,
            messageId: body?.result?.message_id ? String(body.result.message_id) : undefined,
          });
        });
      },
    );
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Telegram document upload timeout')));
    request.end(requestBody);
  });
}

async function readToken(companyId: string): Promise<string> {
  const pool = getPool();
  const row = await pool.query<{ bot_token_encrypted: string }>(
    `SELECT bot_token_encrypted FROM telegram_bot_settings WHERE company_id=$1`,
    [companyId],
  );
  if (row.rows[0]?.bot_token_encrypted) return decryptToken(row.rows[0].bot_token_encrypted);

  const legacy = await pool.query<{ value: Record<string, unknown> }>(
    `SELECT value FROM system_settings WHERE company_id=$1 AND key='mail'`,
    [companyId],
  );
  return String(legacy.rows[0]?.value?.telegramBotToken || '').trim();
}

export async function saveBotToken(companyId: string, token: string | undefined, isEnabled: boolean, userId: string) {
  const currentToken = await readToken(companyId).catch(() => '');
  const nextToken = token?.trim() || currentToken;
  if (!nextToken) throw new Error('توكن بوت تيليغرام مطلوب');

  const me = await telegramRequest<{ result: { username?: string; first_name?: string } }>(nextToken, 'getMe');
  const row = await getPool().query(
    `INSERT INTO telegram_bot_settings
       (company_id, bot_token_encrypted, bot_username, bot_name, is_enabled, created_by_user_id, updated_by_user_id)
     VALUES($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT (company_id) DO UPDATE
       SET bot_token_encrypted=EXCLUDED.bot_token_encrypted,
           bot_username=EXCLUDED.bot_username,
           bot_name=EXCLUDED.bot_name,
           is_enabled=EXCLUDED.is_enabled,
           updated_by_user_id=EXCLUDED.updated_by_user_id,
           updated_at=now()
     RETURNING bot_username, bot_name, is_enabled`,
    [companyId, encryptToken(nextToken), me.result.username ?? null, me.result.first_name ?? null, isEnabled, userId],
  );
  return {
    isEnabled: row.rows[0].is_enabled,
    botUsername: row.rows[0].bot_username,
    botName: row.rows[0].bot_name,
    hasToken: true,
    tokenMasked: maskToken(nextToken),
    purchaseMessage: 'تم شراء البوت قيمة شراء 92$ - البوت جاهز للخدمة - 50 عميل',
  };
}

export async function getBotSettingsMasked(companyId: string) {
  const row = await getPool().query<{
    bot_token_encrypted: string;
    bot_username: string | null;
    bot_name: string | null;
    is_enabled: boolean;
  }>(
    `SELECT bot_token_encrypted, bot_username, bot_name, is_enabled
     FROM telegram_bot_settings WHERE company_id=$1`,
    [companyId],
  );
  if (!row.rows.length) {
    const legacy = await readToken(companyId).catch(() => '');
    return { isEnabled: false, botUsername: null, botName: null, hasToken: Boolean(legacy), tokenMasked: maskToken(legacy) };
  }
  const token = decryptToken(row.rows[0].bot_token_encrypted);
  return {
    isEnabled: row.rows[0].is_enabled,
    botUsername: row.rows[0].bot_username,
    botName: row.rows[0].bot_name,
    hasToken: Boolean(token),
    tokenMasked: maskToken(token),
  };
}

export async function testBotToken(companyId: string) {
  const token = await readToken(companyId);
  if (!token) throw new Error('توكن بوت تيليغرام غير محفوظ');
  const me = await telegramRequest<{ result: { id: number; username?: string; first_name?: string } }>(token, 'getMe');
  await getPool().query(
    `UPDATE telegram_bot_settings
     SET bot_username=$2, bot_name=$3, updated_at=now()
     WHERE company_id=$1 AND bot_token_encrypted IS NOT NULL`,
    [companyId, me.result.username ?? null, me.result.first_name ?? null],
  );
  return me.result;
}

function normalizeUpdate(update: {
  update_id: number;
  message?: {
    date?: number;
    text?: string;
    chat?: { id: number | string; type?: string; first_name?: string; last_name?: string; username?: string; title?: string };
    from?: { id?: number | string; first_name?: string; last_name?: string; username?: string };
  };
}) {
  const message = update.message;
  const chat = message?.chat;
  if (!chat) return null;
  const firstName = chat.first_name || message?.from?.first_name || '';
  const lastName = chat.last_name || message?.from?.last_name || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || chat.title || chat.username || String(chat.id);
  return {
    updateId: update.update_id,
    chatId: String(chat.id),
    telegramUserId: message?.from?.id ? String(message.from.id) : null,
    telegramUsername: chat.username || message?.from?.username || null,
    firstName: firstName || null,
    lastName: lastName || null,
    displayName,
    chatType: chat.type || null,
    messageText: message?.text || '',
    receivedAt: message?.date ? new Date(message.date * 1000).toISOString() : null,
    raw: update,
  };
}

export async function fetchUpdates(companyId: string) {
  const token = await readToken(companyId);
  if (!token) throw new Error('احفظ توكن بوت تيليغرام أولا');
  const settings = await getPool().query<{ last_updates_offset: string | null }>(
    `SELECT last_updates_offset FROM telegram_bot_settings WHERE company_id=$1`,
    [companyId],
  );
  const offset = settings.rows[0]?.last_updates_offset ? Number(settings.rows[0].last_updates_offset) : undefined;
  const response = await telegramRequest<{
    result: Array<Parameters<typeof normalizeUpdate>[0]>;
  }>(token, 'getUpdates', offset ? { offset, limit: 100, timeout: 0 } : { limit: 100, timeout: 0 });

  let maxUpdateId = offset ? offset - 1 : 0;
  const pool = getPool();
  for (const item of response.result) {
    maxUpdateId = Math.max(maxUpdateId, item.update_id);
    const normalized = normalizeUpdate(item);
    if (!normalized) continue;
    await pool.query(
      `INSERT INTO telegram_update_cache
        (company_id, update_id, chat_id, telegram_user_id, telegram_username,
         first_name, last_name, chat_type, message_text, received_at, raw_update)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       ON CONFLICT (company_id, update_id) DO NOTHING`,
      [
        companyId,
        normalized.updateId,
        normalized.chatId,
        normalized.telegramUserId,
        normalized.telegramUsername,
        normalized.firstName,
        normalized.lastName,
        normalized.chatType,
        normalized.messageText,
        normalized.receivedAt,
        JSON.stringify(normalized.raw),
      ],
    );
  }
  if (maxUpdateId > 0) {
    await pool.query(
      `UPDATE telegram_bot_settings SET last_updates_offset=$2, updated_at=now() WHERE company_id=$1`,
      [companyId, maxUpdateId + 1],
    );
  }
  return getDetectedChats(companyId);
}

export async function getDetectedChats(companyId: string) {
  const rows = await getPool().query(
    `WITH latest AS (
       SELECT DISTINCT ON (chat_id)
              chat_id, telegram_user_id, telegram_username, first_name, last_name,
              chat_type, message_text, received_at, update_id
       FROM telegram_update_cache
       WHERE company_id=$1
       ORDER BY chat_id, update_id DESC
     )
     SELECT latest.chat_id AS "chatId",
            latest.telegram_user_id AS "telegramUserId",
            latest.telegram_username AS "telegramUsername",
            latest.first_name AS "telegramFirstName",
            latest.last_name AS "telegramLastName",
            COALESCE(NULLIF(CONCAT_WS(' ', latest.first_name, latest.last_name), ''), latest.telegram_username, latest.chat_id) AS "telegramDisplayName",
            latest.chat_type AS "chatType",
            latest.message_text AS "lastMessage",
            latest.received_at AS "lastMessageAt",
            (link.id IS NOT NULL AND link.is_active = true) AS linked,
            link.id AS "linkId",
            link.target_type AS "linkedTargetType",
            link.target_id AS "linkedTargetId",
            link.target_name AS "linkedTargetName"
     FROM latest
     LEFT JOIN telegram_chat_links link ON link.company_id=$1 AND link.chat_id=latest.chat_id AND link.is_active=true
     ORDER BY latest.update_id DESC
     LIMIT 100`,
    [companyId],
  );
  return rows.rows;
}

export async function listChatLinks(companyId: string, filters: { search?: string; targetType?: string; active?: string; page?: number; pageSize?: number }) {
  const params: unknown[] = [companyId];
  const conditions = ['company_id=$1'];
  let p = 2;
  if (filters.search) {
    conditions.push(`(target_name ILIKE $${p} OR chat_id ILIKE $${p} OR COALESCE(telegram_username,'') ILIKE $${p})`);
    params.push(`%${filters.search}%`);
    p++;
  }
  if (filters.targetType) {
    conditions.push(`target_type=$${p}`);
    params.push(filters.targetType);
    p++;
  }
  if (filters.active === 'true') conditions.push('is_active=true');
  if (filters.active === 'false') conditions.push('is_active=false');
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize || 20));
  const offset = (page - 1) * pageSize;
  const where = conditions.join(' AND ');
  const pool = getPool();
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT id, chat_id AS "chatId", telegram_user_id AS "telegramUserId",
              telegram_username AS "telegramUsername", telegram_first_name AS "telegramFirstName",
              telegram_last_name AS "telegramLastName", telegram_display_name AS "telegramDisplayName",
              chat_type AS "chatType", target_type AS "targetType", target_id AS "targetId",
              target_name AS "targetName", is_active AS "isActive",
              can_receive_invoices AS "canReceiveInvoices",
              can_receive_vouchers AS "canReceiveVouchers",
              can_receive_reports AS "canReceiveReports",
              can_receive_alerts AS "canReceiveAlerts",
              notes, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM telegram_chat_links
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, pageSize, offset],
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM telegram_chat_links WHERE ${where}`, params),
  ]);
  return { data: rows.rows, total: count.rows[0].total, page, pageSize };
}

async function syncPartyLink(companyId: string, payload: TelegramLinkPayload, active: boolean) {
  if (!payload.targetId) return;
  const params = [payload.targetId, companyId, active ? payload.chatId : null, active, active ? (payload.telegramDisplayName || payload.targetName) : null];
  if (payload.targetType === 'CUSTOMER') {
    await getPool().query(
      `UPDATE customers SET telegram_chat_id=$3, telegram_enabled=$4, telegram_label=$5, updated_at=now()
       WHERE id=$1 AND company_id=$2`,
      params,
    );
  } else if (payload.targetType === 'SUPPLIER') {
    await getPool().query(
      `UPDATE suppliers SET telegram_chat_id=$3, telegram_enabled=$4, telegram_label=$5, updated_at=now()
       WHERE id=$1 AND company_id=$2`,
      params,
    );
  }
}

export async function linkChatToTarget(companyId: string, payload: TelegramLinkPayload, userId: string) {
  const chatId = cleanChatId(payload.chatId);
  if (!chatId) throw new Error('Chat ID مطلوب');

  const duplicate = await getPool().query<{ target_name: string }>(
    `SELECT target_name FROM telegram_chat_links WHERE company_id=$1 AND chat_id=$2 AND is_active=true LIMIT 1`,
    [companyId, chatId],
  );
  if (duplicate.rows.length) {
    throw new TelegramDuplicateError(`هذا Chat ID مرتبط مسبقاً بـ ${duplicate.rows[0].target_name}.`, duplicate.rows[0].target_name);
  }

  if (payload.targetId) {
    const targetDuplicate = await getPool().query<{ target_name: string }>(
      `SELECT target_name FROM telegram_chat_links
       WHERE company_id=$1 AND target_type=$2 AND target_id=$3 AND is_active=true LIMIT 1`,
      [companyId, payload.targetType, payload.targetId],
    );
    if (targetDuplicate.rows.length) {
      throw new TelegramDuplicateError(`هذا الحساب لديه رابط تيليغرام نشط مسبقاً: ${targetDuplicate.rows[0].target_name}.`, targetDuplicate.rows[0].target_name);
    }
  }

  const row = await getPool().query<{ id: string }>(
    `INSERT INTO telegram_chat_links
       (company_id, chat_id, telegram_user_id, telegram_username, telegram_first_name,
        telegram_last_name, telegram_display_name, chat_type, target_type, target_id,
        target_name, can_receive_invoices, can_receive_vouchers, can_receive_reports,
        can_receive_alerts, notes, linked_by_user_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [
      companyId,
      chatId,
      payload.telegramUserId || null,
      payload.telegramUsername || null,
      payload.telegramFirstName || null,
      payload.telegramLastName || null,
      payload.telegramDisplayName || payload.targetName,
      payload.chatType || null,
      payload.targetType,
      payload.targetId || null,
      payload.targetName,
      payload.canReceiveInvoices ?? true,
      payload.canReceiveVouchers ?? true,
      payload.canReceiveReports ?? false,
      payload.canReceiveAlerts ?? true,
      payload.notes || null,
      userId,
    ],
  );
  await syncPartyLink(companyId, { ...payload, chatId }, true);
  return row.rows[0];
}

export async function updateChatLink(companyId: string, linkId: string, payload: TelegramLinkPayload) {
  const row = await getPool().query(
    `UPDATE telegram_chat_links
     SET telegram_username=$3, telegram_first_name=$4, telegram_last_name=$5,
         telegram_display_name=$6, chat_type=$7, target_type=$8, target_id=$9,
         target_name=$10, can_receive_invoices=$11, can_receive_vouchers=$12,
         can_receive_reports=$13, can_receive_alerts=$14, notes=$15, updated_at=now()
     WHERE id=$1 AND company_id=$2
     RETURNING id`,
    [
      linkId,
      companyId,
      payload.telegramUsername || null,
      payload.telegramFirstName || null,
      payload.telegramLastName || null,
      payload.telegramDisplayName || payload.targetName,
      payload.chatType || null,
      payload.targetType,
      payload.targetId || null,
      payload.targetName,
      payload.canReceiveInvoices ?? true,
      payload.canReceiveVouchers ?? true,
      payload.canReceiveReports ?? false,
      payload.canReceiveAlerts ?? true,
      payload.notes || null,
    ],
  );
  return row.rows[0];
}

export async function unlinkChat(companyId: string, linkId: string, active: boolean) {
  const row = await getPool().query<{
    id: string;
    chat_id: string;
    target_type: TelegramTargetType;
    target_id: string | null;
    target_name: string;
  }>(
    `UPDATE telegram_chat_links SET is_active=$3, updated_at=now()
     WHERE id=$1 AND company_id=$2
     RETURNING id, chat_id, target_type, target_id, target_name`,
    [linkId, companyId, active],
  );
  const link = row.rows[0];
  if (link) await syncPartyLink(companyId, { chatId: link.chat_id, targetType: link.target_type, targetId: link.target_id, targetName: link.target_name }, active);
  return link;
}

export async function sendTestMessageToChat(companyId: string, linkId: string, userId: string) {
  const token = await readToken(companyId);
  if (!token) throw new Error('توكن بوت تيليغرام غير محفوظ');
  const link = await getPool().query<{ chat_id: string; target_type: string; target_id: string | null; target_name: string }>(
    `SELECT chat_id, target_type, target_id, target_name FROM telegram_chat_links
     WHERE id=$1 AND company_id=$2 AND is_active=true`,
    [linkId, companyId],
  );
  if (!link.rows.length) throw new Error('رابط تيليغرام غير موجود أو غير نشط');
  const text = `رسالة اختبار من نظام CLOTEX إلى ${link.rows[0].target_name}.`;
  try {
    const result = await telegramRequest<{ result?: { message_id?: number } }>(token, 'sendMessage', {
      chat_id: link.rows[0].chat_id,
      text,
    });
    await getPool().query(
      `INSERT INTO telegram_delivery_logs
       (company_id, chat_link_id, chat_id, party_type, party_id, target_type, target_id,
        document_type, event_type, message_text, status, telegram_message_id,
        created_by_user_id, sent_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,'TEST','TEST_MESSAGE',$8,'SENT',$9,$10,now())`,
      [
        companyId,
        linkId,
        link.rows[0].chat_id,
        link.rows[0].target_type.toLowerCase(),
        link.rows[0].target_id,
        link.rows[0].target_type,
        link.rows[0].target_id,
        text,
        result.result?.message_id ? String(result.result.message_id) : null,
        userId,
      ],
    );
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await getPool().query(
      `INSERT INTO telegram_delivery_logs
       (company_id, chat_link_id, chat_id, party_type, party_id, target_type, target_id,
        document_type, event_type, message_text, status, error_message, created_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,'TEST','TEST_MESSAGE',$8,'FAILED',$9,$10)`,
      [
        companyId,
        linkId,
        link.rows[0].chat_id,
        link.rows[0].target_type.toLowerCase(),
        link.rows[0].target_id,
        link.rows[0].target_type,
        link.rows[0].target_id,
        text,
        message,
        userId,
      ],
    );
    throw error;
  }
}

type ResolvedTelegramTarget = {
  chatId: string;
  chatLinkId: string | null;
  targetType: TelegramTargetType | null;
  targetId: string | null;
  targetName: string | null;
  copyRole?: 'primary' | 'manager';
};

function permissionColumnForDocument(documentType: string) {
  if (documentType === 'INVOICE') return 'can_receive_invoices';
  if (documentType === 'VOUCHER') return 'can_receive_vouchers';
  if (documentType === 'STATEMENT') return 'can_receive_reports';
  return 'can_receive_alerts';
}

async function resolveTelegramTargets(companyId: string, payload: TelegramDocumentPayload): Promise<ResolvedTelegramTarget[]> {
  const targets: ResolvedTelegramTarget[] = [];
  const seen = new Set<string>();
  const pushTarget = (target: ResolvedTelegramTarget | null) => {
    if (!target?.chatId?.trim()) return;
    const key = target.chatId.trim();
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ ...target, chatId: key });
  };

  if (payload.chatId?.trim()) {
    pushTarget({
      chatId: payload.chatId.trim(),
      chatLinkId: null,
      targetType: payload.targetType ?? null,
      targetId: payload.targetId ?? null,
      targetName: null,
      copyRole: 'primary',
    });
  }

  const targetType = payload.targetType ?? (
    payload.partyType === 'customer' ? 'CUSTOMER' :
    payload.partyType === 'supplier' ? 'SUPPLIER' :
    payload.partyType === 'user' ? 'USER' :
    payload.partyType === 'employee' ? 'EMPLOYEE' :
    undefined
  );
  const targetId = payload.targetId ?? payload.partyId ?? null;

  if (!targets.length && targetType && targetId) {
    const row = await getPool().query<{
      id: string;
      chat_id: string;
      target_name: string;
      target_type: TelegramTargetType;
      target_id: string | null;
    }>(
      `SELECT id, chat_id, target_name, target_type, target_id
       FROM telegram_chat_links
       WHERE company_id=$1 AND target_type=$2 AND target_id=$3 AND is_active=true
       LIMIT 1`,
      [companyId, targetType, targetId],
    );
    if (row.rows[0]) {
      pushTarget({
        chatId: row.rows[0].chat_id,
        chatLinkId: row.rows[0].id,
        targetType: row.rows[0].target_type,
        targetId: row.rows[0].target_id,
        targetName: row.rows[0].target_name,
        copyRole: 'primary',
      });
    }
  }

  const permissionColumn = permissionColumnForDocument(payload.documentType);
  const managerRows = await getPool().query<{
    id: string;
    chat_id: string;
    target_name: string;
    target_type: TelegramTargetType;
    target_id: string | null;
  }>(
    `SELECT id, chat_id, target_name, target_type, target_id
     FROM telegram_chat_links
     WHERE company_id=$1
       AND is_active=true
       AND target_type IN ('USER','OTHER')
       AND ${permissionColumn}=true
     ORDER BY target_type ASC, target_name ASC`,
    [companyId],
  );

  for (const row of managerRows.rows) {
    pushTarget({
      chatId: row.chat_id,
      chatLinkId: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      targetName: row.target_name,
      copyRole: 'manager',
    });
  }

  const legacyChatId = getEnv().TELEGRAM_CHAT_ID || '';
  if (legacyChatId.trim()) {
    pushTarget({
      chatId: legacyChatId.trim(),
      chatLinkId: null,
      targetType: targetType ?? null,
      targetId,
      targetName: 'Manager',
      copyRole: targets.length ? 'manager' : 'primary',
    });
  }

  if (!targets.length) {
    throw new Error('لا يوجد Chat ID مرتبط بهذا العميل/المورد. اطلب منه إرسال رسالة للبوت ثم اضغط جلب ID واربطه من إعدادات تيلغرام.');
  }

  return targets;
}

export async function sendTelegramDocumentMessage(companyId: string, payload: TelegramDocumentPayload, userId: string) {
  const token = await readToken(companyId);
  if (!token) throw new Error('توكن بوت تيليغرام غير محفوظ');

  const settings = await getBotSettingsMasked(companyId);
  if (!settings.isEnabled) throw new Error('بوت تيليغرام غير مفعل');
  if (!payload.message.trim()) throw new Error('نص رسالة تيليغرام مطلوب');

  const targets = await resolveTelegramTargets(companyId, payload);
  const pdf = payload.pdfHtml?.trim() ? await renderPdf(payload.pdfHtml) : null;
  const sent: Array<{ chatId: string; telegramMessageId: string | null; documentMessageId: string | null; copyRole?: string }> = [];
  const failures: string[] = [];

  for (const target of targets) {
    let telegramMessageId: string | null = null;
    let documentMessageId: string | null = null;
    try {
    const messageResult = await telegramRequest<{ result?: { message_id?: number } }>(token, 'sendMessage', {
      chat_id: target.chatId,
      text: payload.message,
    });
    telegramMessageId = messageResult.result?.message_id ? String(messageResult.result.message_id) : null;

    if (pdf) {
      const documentResult = await telegramMultipartDocument(
        token,
        target.chatId,
        pdf,
        payload.fileName || 'document.pdf',
        payload.caption || payload.fileName || 'PDF',
      );
      if (!documentResult.ok) throw new Error(JSON.stringify(documentResult.body));
      documentMessageId = documentResult.messageId ?? null;
    }

    await getPool().query(
      `INSERT INTO telegram_delivery_logs
       (company_id, chat_link_id, chat_id, party_type, party_id, target_type, target_id,
        document_type, event_type, document_id, message_preview, message_text,
        pdf_file_name, status, telegram_message_id, created_by_user_id, sent_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'SENT',$14,$15,now())`,
      [
        companyId,
        target.chatLinkId,
        target.chatId,
        payload.partyType || 'system',
        payload.partyId || target.targetId,
        target.targetType || payload.targetType || null,
        target.targetId || payload.targetId || null,
        payload.documentType,
        payload.eventType || 'DOCUMENT_SEND',
        payload.fileName || null,
        payload.message.slice(0, 250),
        payload.message,
        payload.fileName || null,
        documentMessageId || telegramMessageId,
        userId,
      ],
    );

    sent.push({ chatId: target.chatId, telegramMessageId, documentMessageId, copyRole: target.copyRole });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${target.chatId}: ${message}`);
    await getPool().query(
      `INSERT INTO telegram_delivery_logs
       (company_id, chat_link_id, chat_id, party_type, party_id, target_type, target_id,
        document_type, event_type, document_id, message_preview, message_text,
        pdf_file_name, status, error_message, created_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'FAILED',$14,$15)`,
      [
        companyId,
        target.chatLinkId,
        target.chatId,
        payload.partyType || 'system',
        payload.partyId || target.targetId,
        target.targetType || payload.targetType || null,
        target.targetId || payload.targetId || null,
        payload.documentType,
        payload.eventType || 'DOCUMENT_SEND',
        payload.fileName || null,
        payload.message.slice(0, 250),
        payload.message,
        payload.fileName || null,
        message,
        userId,
      ],
    );
    }
  }

  if (!sent.length) {
    throw new Error(failures[0] || 'فشل إرسال تيليغرام لكل المستلمين');
  }

  return { sent: true, sentCount: sent.length, targets: sent, failedCount: failures.length, failures };
}
