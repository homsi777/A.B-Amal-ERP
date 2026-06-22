import { createHash } from 'node:crypto';
import type { JwtPayload } from '../middleware/auth.js';
import {
  clientPlatformLabel,
  resolveClientPlatform,
  type ClientPlatformCode,
} from '../utils/clientPlatform.js';

export type ActiveSession = {
  sessionKey: string;
  userId: string;
  username: string;
  fullName: string | null;
  companyId: string;
  ip: string;
  userAgent: string;
  clientPlatform: ClientPlatformCode;
  clientPlatformLabel: string;
  connectedAt: string;
  lastSeenAt: string;
};

const IDLE_TTL_MS = 5 * 60 * 1000;

const sessions = new Map<
  string,
  {
    sessionKey: string;
    userId: string;
    username: string;
    fullName: string | null;
    companyId: string;
    ip: string;
    userAgent: string;
    clientPlatform: ClientPlatformCode;
    connectedAt: number;
    lastSeenAt: number;
  }
>();

const revokedSessionKeys = new Set<string>();

function sessionKey(userId: string, token: string): string {
  return createHash('sha256').update(`${userId}:${token}`).digest('hex').slice(0, 24);
}

export function buildSessionKey(userId: string, token: string): string {
  return sessionKey(userId, token);
}

export function isSessionRevoked(userId: string, token: string): boolean {
  return revokedSessionKeys.has(sessionKey(userId, token));
}

export function revokeActiveSession(sessionKeyValue: string, companyId: string): boolean {
  const row = sessions.get(sessionKeyValue);
  if (!row || row.companyId !== companyId) return false;
  sessions.delete(sessionKeyValue);
  revokedSessionKeys.add(sessionKeyValue);
  return true;
}

function pruneExpired(now = Date.now()) {
  for (const [key, row] of sessions.entries()) {
    if (now - row.lastSeenAt > IDLE_TTL_MS) {
      sessions.delete(key);
    }
  }
}

export function touchActiveSession(input: {
  payload: JwtPayload;
  token: string;
  ip: string;
  userAgent: string;
  clientPlatformHeader?: string | string[];
  fullName?: string | null;
}) {
  const key = sessionKey(input.payload.sub, input.token);
  const now = Date.now();
  const existing = sessions.get(key);
  const clientPlatform = resolveClientPlatform(input.clientPlatformHeader, input.userAgent);

  sessions.set(key, {
    sessionKey: key,
    userId: input.payload.sub,
    username: input.payload.username,
    fullName: input.fullName ?? existing?.fullName ?? null,
    companyId: input.payload.companyId,
    ip: input.ip || '—',
    userAgent: input.userAgent || '—',
    clientPlatform,
    connectedAt: existing?.connectedAt ?? now,
    lastSeenAt: now,
  });
  pruneExpired(now);
}

export function listActiveSessions(companyId: string): ActiveSession[] {
  const now = Date.now();
  pruneExpired(now);
  return [...sessions.values()]
    .filter((row) => row.companyId === companyId)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((row) => ({
      sessionKey: row.sessionKey,
      userId: row.userId,
      username: row.username,
      fullName: row.fullName,
      companyId: row.companyId,
      ip: row.ip,
      userAgent: row.userAgent,
      clientPlatform: row.clientPlatform,
      clientPlatformLabel: clientPlatformLabel(row.clientPlatform),
      connectedAt: new Date(row.connectedAt).toISOString(),
      lastSeenAt: new Date(row.lastSeenAt).toISOString(),
    }));
}
