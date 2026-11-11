import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import {
  importAttendanceRows,
  listAttendanceRecords,
  updateAttendanceRecordManual,
  listShiftTypes,
  createShiftType,
  computeMonthlyAttendanceSummaries,
  approveMonthlyAttendanceReview,
} from '../services/attendanceService.js';
import { insertAuditLog } from '../services/auditLogService.js';

function requirePermission(user: { role: string; permissions: string[] } | undefined, code: string): boolean {
  if (!user) return false;
  return user.role === 'admin' || user.permissions.includes(code);
}

const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;

const importRowSchema = z.object({
  fingerprintCode: z.string().min(1),
  nameInFile: z.string().optional().default(''),
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkInTime: z.string().regex(timeRegex).optional().nullable(),
  checkOutTime: z.string().regex(timeRegex).optional().nullable(),
  totalHours: z.coerce.number().nonnegative().default(0),
});

const importBody = z.object({
  fileName: z.string().min(1),
  rows: z.array(importRowSchema).min(1),
});

const shiftTypeBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  startTime: z.string().regex(timeRegex),
  endTime: z.string().regex(timeRegex),
  crossesMidnight: z.boolean().optional().default(false),
});

const approveReviewBody = z.object({
  employeeId: z.string().uuid(),
  periodMonth: z.coerce.number().int().min(1).max(12),
  periodYear: z.coerce.number().int().min(2000).max(2100),
  notes: z.string().optional().nullable(),
});

const manualUpdateBody = z.object({
  checkInTime: z.string().regex(timeRegex).optional().nullable(),
  checkOutTime: z.string().regex(timeRegex).optional().nullable(),
  lateMinutes: z.coerce.number().nonnegative().optional(),
  permissionMinutes: z.coerce.number().nonnegative().optional(),
  dayType: z.enum(['WORK', 'REST', 'HOLIDAY']).optional(),
  reason: z.string().min(1, 'سبب التعديل مطلوب'),
});

export const attendanceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const rows = await listAttendanceRecords(companyId, {
      employeeId: q.employeeId || undefined,
      dateFrom: q.dateFrom || undefined,
      dateTo: q.dateTo || undefined,
    });
    return reply.send({ ok: true, data: rows });
  });

  app.post('/import', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId } = req.user!;
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await importAttendanceRows(client, { companyId, fileName: d.fileName, rows: d.rows });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: result });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = manualUpdateBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await updateAttendanceRecordManual(client, {
        companyId,
        userId,
        id,
        checkInTime: d.checkInTime,
        checkOutTime: d.checkOutTime,
        lateMinutes: d.lateMinutes,
        permissionMinutes: d.permissionMinutes,
        dayType: d.dayType,
        reason: d.reason,
      });
      await insertAuditLog(client, {
        companyId,
        userId,
        action: 'ATTENDANCE_RECORD_MANUALLY_EDITED',
        entityType: 'attendance_daily_record',
        entityId: id,
        details: { reason: d.reason, checkInTime: d.checkInTime, checkOutTime: d.checkOutTime, lateMinutes: d.lateMinutes, permissionMinutes: d.permissionMinutes, dayType: d.dayType },
      });
      await client.query('COMMIT');
      return reply.send({ ok: true, data: row });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.get('/shift-types', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId } = req.user!;
    const rows = await listShiftTypes(companyId);
    return reply.send({ ok: true, data: rows });
  });

  app.post('/shift-types', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId } = req.user!;
    const parsed = shiftTypeBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await createShiftType(client, { companyId, ...d });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: row });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') return sendError(reply, 409, 'كود الشفت مستخدم مسبقاً', 'DUPLICATE');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.get('/monthly-review', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const periodMonth = Number(q.periodMonth);
    const periodYear = Number(q.periodYear);
    if (!periodMonth || !periodYear) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const rows = await computeMonthlyAttendanceSummaries(companyId, periodMonth, periodYear, q.employeeId || undefined);
    return reply.send({ ok: true, data: rows });
  });

  app.post('/monthly-review/approve', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePermission(req.user, 'attendance.approve')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { companyId, sub: userId } = req.user!;
    const parsed = approveReviewBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await approveMonthlyAttendanceReview(client, {
        companyId,
        userId,
        employeeId: d.employeeId,
        periodMonth: d.periodMonth,
        periodYear: d.periodYear,
        notes: d.notes,
      });
      await insertAuditLog(client, {
        companyId,
        userId,
        action: 'ATTENDANCE_MONTHLY_REVIEW_APPROVED',
        entityType: 'monthly_attendance_review',
        entityId: (row as { id?: string }).id ?? null,
        details: { employeeId: d.employeeId, periodMonth: d.periodMonth, periodYear: d.periodYear, notes: d.notes ?? null },
      });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: row });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });
};
