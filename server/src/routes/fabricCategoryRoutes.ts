import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';

const categoryBody = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

/** التحقق: على الأقل حقل واحد من الاسم أو الكود مطلوب */
function validateAtLeastOneField(
  name: string | undefined,
  code: string | undefined,
): { valid: boolean; error?: string } {
  if ((!name || name.trim() === '') && (!code || code.trim() === '')) {
    return { valid: false, error: 'يجب إدخال الاسم أو الكود على الأقل' };
  }
  return { valid: true };
}

type DbCategory = {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  is_active: boolean;
  children?: DbCategory[];
};

function buildTree(rows: DbCategory[]): DbCategory[] {
  const map = new Map<string, DbCategory>();
  rows.forEach((r) => map.set(r.id, { ...r, children: [] }));
  const roots: DbCategory[] = [];
  rows.forEach((r) => {
    const node = map.get(r.id)!;
    if (r.parent_id && map.has(r.parent_id)) {
      map.get(r.parent_id)!.children!.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

/** عمق العقدة من الجذر: الجذر = 0، ثم 1، ثم 2، ثم 3 كحد أقصى لأربع مستويات */
async function categoryDepthFromRoot(
  pool: ReturnType<typeof getPool>,
  companyId: string,
  id: string,
): Promise<number> {
  let depth = 0;
  let cur: string | null = id;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT parent_id FROM fabric_categories WHERE id=$1 AND company_id=$2`,
      [cur, companyId],
    ) as { rows: { parent_id: string | null }[] };
    if (!rows.length) return 0;
    const parentId: string | null = rows[0]!.parent_id;
    if (parentId === null) return depth;
    depth++;
    cur = parentId;
  }
}

function subtreeHeightFromFlat(flat: DbCategory[], rootId: string): number {
  const kids = flat.filter((c) => c.parent_id === rootId);
  if (!kids.length) return 0;
  return 1 + Math.max(...kids.map((k) => subtreeHeightFromFlat(flat, k.id)));
}

const norm = (value: string) => value.trim().toLowerCase();
const keyByParentName = (parentId: string | null, name: string) => `${parentId ?? 'root'}::${norm(name)}`;
const keyByParentCode = (parentId: string | null, code: string) => `${parentId ?? 'root'}::${norm(code)}`;
const safeText = (value: unknown) => String(value ?? '').trim();
const toCode = (value: string, fallback: string) => {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/[^A-Za-z0-9-]/g, '')
    .toUpperCase()
    .slice(0, 64);
  return cleaned || fallback;
};

export const fabricCategoryRoutes: FastifyPluginAsync = async (app) => {
  app.post('/sync-from-materials', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query<DbCategory>(
        `SELECT id,parent_id,code,name,is_active
         FROM fabric_categories
         WHERE company_id=$1`,
         [companyId],
      );
      // Maps for checking existing within same parent
      const byParentName = new Map<string, DbCategory>();
      const byParentCode = new Map<string, DbCategory>();
      for (const c of existing.rows) {
        if (safeText(c.name)) byParentName.set(keyByParentName(c.parent_id, c.name), c);
        if (safeText(c.code)) byParentCode.set(keyByParentCode(c.parent_id, c.code), c);
      }

      const counters = {
        scannedMaterials: 0,
        scannedColors: 0,
        createdLevel1: 0,
        createdLevel2: 0,
        createdLevel3: 0,
        createdLevel4: 0,
      };

const ensureCategory = async (
        level: 1 | 2 | 3 | 4,
        parentId: string | null,
        name: string,
        code: string,
      ): Promise<DbCategory> => {
        const n = safeText(name);
        const c = safeText(code);

        // Check by name under same parent
        if (n) {
          const existingByName = byParentName.get(keyByParentName(parentId, n));
          if (existingByName) return existingByName;
        }

        // For level 2 (material code): check duplicate within same parent
        // For levels 3,4 (color/color code): allow any code globally
        if (level === 2 && c) {
          const existingByCodeSameParent = byParentCode.get(keyByParentCode(parentId, c));
          if (existingByCodeSameParent) return existingByCodeSameParent;
        }

        // No existing record found - proceed to insert
        const finalCode = c || n || `CAT-${level}`;
        const finalName = n || c || `CAT-${level}`;

        let row: DbCategory;
        try {
          const inserted = await client.query<DbCategory>(
            `INSERT INTO fabric_categories(company_id,parent_id,code,name)
             VALUES($1,$2,$3,$4)
             RETURNING id,parent_id,code,name,is_active`,
            [companyId, parentId, finalCode, finalName],
          );
          row = inserted.rows[0]!;
        } catch (e: unknown) {
          if ((e as { code?: string }).code === '23505') {
            // On conflict (shouldn't happen after removing global unique), try to find existing
            if (c) {
              const existing = await client.query<DbCategory>(
                `SELECT id,parent_id,code,name,is_active
                 FROM fabric_categories
                 WHERE company_id=$1 AND code=$2 AND parent_id=$3
                 LIMIT 1`,
                [companyId, c, parentId],
              );
              if (existing.rows.length) return existing.rows[0]!;
            }
            throw e;
          } else {
            throw e;
          }
        }

        // Update the lookup maps
        if (safeText(row.name)) byParentName.set(keyByParentName(row.parent_id, row.name), row);
        if (safeText(row.code)) byParentCode.set(keyByParentCode(row.parent_id, row.code), row);
        if (level === 1) counters.createdLevel1++;
        if (level === 2) counters.createdLevel2++;
        if (level === 3) counters.createdLevel3++;
        if (level === 4) counters.createdLevel4++;
        return row;
      };

      const materials = await client.query<{
        item_name: string;
        item_code: string | null;
        color_name: string | null;
        color_code: string | null;
      }>(
        `SELECT
           fi.name AS item_name,
           COALESCE(NULLIF(fi.internal_code, ''), NULLIF(fi.supplier_code, ''), fi.name) AS item_code,
           COALESCE(NULLIF(fc.name_ar, ''), NULLIF(fc.name_tr, ''), NULLIF(fc.color_code, ''), NULLIF(fc.supplier_color_code, '')) AS color_name,
           COALESCE(NULLIF(fc.color_code, ''), NULLIF(fc.supplier_color_code, '')) AS color_code
         FROM fabric_items fi
         LEFT JOIN fabric_rolls fr
           ON fr.item_id = fi.id
          AND fr.company_id = fi.company_id
         LEFT JOIN fabric_colors fc
           ON fc.id = fr.color_id
         WHERE fi.company_id = $1
           AND fi.is_active = true
         ORDER BY fi.name ASC`,
        [companyId],
      );

      const seenMaterials = new Set<string>();
      const seenColors = new Set<string>();

      for (const row of materials.rows) {
        const itemName = safeText(row.item_name);
        if (!itemName) continue;
        const itemCodeRaw = safeText(row.item_code) || itemName;
        const itemCode = toCode(itemCodeRaw, 'MAT');
        const materialKey = `${norm(itemName)}::${norm(itemCodeRaw)}`;
        if (!seenMaterials.has(materialKey)) {
          counters.scannedMaterials++;
          seenMaterials.add(materialKey);
        }

        const lvl1 = await ensureCategory(1, null, itemName, toCode(itemName, itemCode));
        const lvl2 = await ensureCategory(2, lvl1.id, itemCodeRaw, itemCode);

        const colorName = safeText(row.color_name);
        const colorCodeRaw = safeText(row.color_code);
        if (!colorName && !colorCodeRaw) continue;

        const colorNameSafe = colorName || colorCodeRaw;
        const colorCodeSafe = colorCodeRaw || toCode(colorNameSafe, 'CLR');
        const colorKey = `${lvl2.id}::${norm(colorNameSafe)}::${norm(colorCodeSafe)}`;
        if (!seenColors.has(colorKey)) {
          counters.scannedColors++;
          seenColors.add(colorKey);
        }

        const lvl3 = await ensureCategory(3, lvl2.id, colorNameSafe, toCode(colorNameSafe, colorCodeSafe));
        await ensureCategory(4, lvl3.id, colorCodeSafe, toCode(colorCodeSafe, 'CLR'));
      }

      await client.query('COMMIT');
      return reply.send({
        ok: true,
        data: {
          ...counters,
          totalCreated:
            counters.createdLevel1 + counters.createdLevel2 + counters.createdLevel3 + counters.createdLevel4,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const pool = getPool();
    const conditions = ['company_id=$1'];
    const params: unknown[] = [companyId];
    if (search) { conditions.push('(name ILIKE $2 OR code ILIKE $2)'); params.push(`%${search}%`); }
    const rows = await pool.query<DbCategory>(
      `SELECT id,parent_id,code,name,is_active FROM fabric_categories
       WHERE ${conditions.join(' AND ')} ORDER BY name ASC`,
      params,
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.get('/tree', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const pool = getPool();
    const rows = await pool.query<DbCategory>(
      `SELECT id,parent_id,code,name,is_active FROM fabric_categories
       WHERE company_id=$1 AND is_active=true ORDER BY name ASC`,
      [companyId],
    );
    return reply.send({ ok: true, data: buildTree(rows.rows) });
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT id,parent_id,code,name,is_active,created_at,updated_at
       FROM fabric_categories WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'التصنيف غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const parsed = categoryBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    // التحقق: على الأقل حقل واحد من الاسم أو الكود مطلوب
    const fieldCheck = validateAtLeastOneField(d.name, d.code);
    if (!fieldCheck.valid) {
      return sendError(reply, 400, fieldCheck.error ?? 'حقل مطلوب', 'VALIDATION');
    }
    // Validate parent belongs to same company
    if (d.parent_id) {
      const pCheck = await pool.query(
        'SELECT id FROM fabric_categories WHERE id=$1 AND company_id=$2',
        [d.parent_id, companyId],
      );
      if (!pCheck.rows.length) return sendError(reply, 404, 'التصنيف الأصل غير موجود', 'NOT_FOUND');
      const parentDepth = await categoryDepthFromRoot(pool, companyId, d.parent_id);
      if (parentDepth >= 3) {
        return sendError(
          reply,
          400,
          'لا يمكن إضافة تفرع تحت «كود اللون» — الشجرة أربع مستويات فقط: اسم الخامة، كود الخامة، اللون، كود اللون.',
          'VALIDATION',
        );
      }
    }

    const parentDepthForDuplicate = d.parent_id
      ? await categoryDepthFromRoot(pool, companyId, d.parent_id)
      : -1;

    // Check duplicate material codes only under material-name nodes.
    // Colors and color-codes imported from Excel may repeat naturally and must remain addable.
    if (parentDepthForDuplicate === 0 && d.parent_id && d.code && d.code.trim() !== '') {
      const parentCheck = await pool.query(
        `SELECT id FROM fabric_categories WHERE company_id = $1 AND parent_id = $2 AND code = $3 LIMIT 1`,
        [companyId, d.parent_id, d.code.trim()],
      );
      if (parentCheck.rows.length) {
        return sendError(reply, 409, 'كود الخامة موجود مسبقاً ضمن اسم الخامة نفسه', 'DUPLICATE');
      }
    }

    try {
      const row = await pool.query(
        `INSERT INTO fabric_categories(company_id,parent_id,code,name)
         VALUES($1,$2,$3,$4) RETURNING id,parent_id,code,name,is_active,created_at`,
        [companyId, d.parent_id ?? null, d.code ?? null, d.name ?? null],
      );
      return reply.status(201).send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      throw e;
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = categoryBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    // Prevent self-reference
    if (d.parent_id === id) return sendError(reply, 400, 'لا يمكن أن يكون التصنيف أصلاً لنفسه', 'VALIDATION');
    const pool = getPool();
    if (d.parent_id) {
      const pCheck = await pool.query(
        'SELECT id FROM fabric_categories WHERE id=$1 AND company_id=$2',
        [d.parent_id, companyId],
      );
      if (!pCheck.rows.length) return sendError(reply, 404, 'التصنيف الأصل غير موجود', 'NOT_FOUND');
      const parentDepth = await categoryDepthFromRoot(pool, companyId, d.parent_id);
      const below = subtreeHeightFromFlat(
        (await pool.query<DbCategory>(
          `SELECT id,parent_id,code,name,is_active FROM fabric_categories WHERE company_id=$1`,
          [companyId],
        )).rows,
        id,
      );
      if (parentDepth + 1 + below > 3) {
        return sendError(
          reply,
          400,
          'نقل التصنيف يتجاوز أربع مستويات (اسم الخامة → كود الخامة → اللون → كود اللون). اختر أصلاً أعلى في الشجرة أو أزل التفرعات السفلى.',
          'VALIDATION',
        );
      }
    }

    const parentDepthForDuplicate = d.parent_id
      ? await categoryDepthFromRoot(pool, companyId, d.parent_id)
      : -1;

    // Check duplicate material codes only under material-name nodes.
    if (parentDepthForDuplicate === 0 && d.parent_id && d.code && d.code.trim() !== '') {
      const parentCheck = await pool.query(
        `SELECT id FROM fabric_categories WHERE company_id = $1 AND parent_id = $2 AND code = $3 AND id != $4 LIMIT 1`,
        [companyId, d.parent_id, d.code.trim(), id],
      );
      if (parentCheck.rows.length) {
        return sendError(reply, 409, 'كود الخامة موجود مسبقاً ضمن اسم الخامة نفسه', 'DUPLICATE');
      }
    }

    try {
      const row = await pool.query(
        `UPDATE fabric_categories SET name=$3,code=$4,parent_id=$5,updated_at=now()
         WHERE id=$1 AND company_id=$2
         RETURNING id,parent_id,code,name,is_active,updated_at`,
        [id, companyId, d.name ?? '', d.code ?? '', d.parent_id ?? null],
      );
      if (!row.rows.length) return sendError(reply, 404, 'التصنيف غير موجود', 'NOT_FOUND');
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      throw e;
    }
  });

  app.patch('/:id/toggle-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `UPDATE fabric_categories SET is_active=NOT is_active,updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id,is_active`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'التصنيف غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });
};
