import type { PoolClient } from 'pg';
import { cleanString } from './importColumnDetector.js';

export function isPlaceholderColorCode(code: string): boolean {
  const c = cleanString(code).toLowerCase();
  if (!c) return true;
  if (c === '#000' || c === '#000000' || c === '000000' || c === '000' || c === 'black') return true;
  return false;
}

export function resolveImportColorLabels(nd: {
  colorName?: unknown;
  colorNameTr?: unknown;
  colorCode?: unknown;
  supplierColorCode?: unknown;
}): { nameAr: string; nameTr: string; colorCode: string; supplierColorCode: string } {
  const nameAr = cleanString(nd.colorName);
  const nameTr = cleanString(nd.colorNameTr);
  const rawCode = cleanString(nd.colorCode);
  const supplierColorCode = cleanString(nd.supplierColorCode);
  const colorCode = !isPlaceholderColorCode(rawCode) ? rawCode : supplierColorCode;
  return {
    nameAr: nameAr || nameTr,
    nameTr: nameTr || nameAr,
    colorCode: !isPlaceholderColorCode(colorCode) ? colorCode : '',
    supplierColorCode,
  };
}

export async function resolveFabricColorForImport(
  client: PoolClient,
  companyId: string,
  nd: {
    colorName?: unknown;
    colorNameTr?: unknown;
    colorCode?: unknown;
    supplierColorCode?: unknown;
  },
  opts: { createIfMissing: boolean; rowNo?: number },
): Promise<{ id: string | null; created: boolean }> {
  const { nameAr, nameTr, colorCode, supplierColorCode } = resolveImportColorLabels(nd);
  if (!nameAr && !nameTr && !colorCode && !supplierColorCode) {
    return { id: null, created: false };
  }

  const tryFind = async (sql: string, value: string): Promise<string | null> => {
    const r = await client.query<{ id: string }>(sql, [companyId, value]);
    return r.rows[0]?.id ?? null;
  };

  // Excel «اللون» wins over shared «كود اللون» (e.g. many rows with ورق شجر).
  for (const name of [nameAr, nameTr]) {
    if (!name) continue;
    const id = await tryFind(
      `SELECT id FROM fabric_colors
       WHERE (company_id=$1 OR company_id IS NULL) AND is_active=true
         AND (
           lower(trim(coalesce(name_ar, '')))=lower(trim($2))
           OR lower(trim(coalesce(name_tr, '')))=lower(trim($2))
         )
       ORDER BY company_id NULLS LAST, created_at
       LIMIT 1`,
      name,
    );
    if (id) return { id, created: false };
  }

  if (!nameAr && !nameTr) {
    if (colorCode) {
      const id = await tryFind(
        `SELECT id FROM fabric_colors
         WHERE (company_id=$1 OR company_id IS NULL) AND is_active=true
           AND lower(trim(color_code))=lower(trim($2))
         ORDER BY company_id NULLS LAST, created_at
         LIMIT 1`,
        colorCode,
      );
      if (id) return { id, created: false };
    }

    if (supplierColorCode) {
      const id = await tryFind(
        `SELECT id FROM fabric_colors
         WHERE (company_id=$1 OR company_id IS NULL) AND is_active=true
           AND lower(trim(supplier_color_code))=lower(trim($2))
         ORDER BY company_id NULLS LAST, created_at
         LIMIT 1`,
        supplierColorCode,
      );
      if (id) return { id, created: false };
    }
  }

  if (!opts.createIfMissing) return { id: null, created: false };

  const insertNameAr = nameAr || nameTr || null;
  const insertNameTr = nameTr && nameTr !== nameAr ? nameTr : null;
  const insertCode = colorCode || null;
  const insertSupplierCode = supplierColorCode || null;

  if (!insertNameAr && !insertCode && !insertSupplierCode) {
    return { id: null, created: false };
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO fabric_colors (company_id, name_ar, name_tr, color_code, supplier_color_code, is_active)
     VALUES ($1,$2,$3,$4,$5,true)
     RETURNING id`,
    [companyId, insertNameAr, insertNameTr, insertCode, insertSupplierCode],
  );
  return { id: inserted.rows[0].id, created: true };
}
