/**
 * Re-link import rolls to the correct fabric_item per design code (DesenAdi).
 * Fixes wrong name/code collisions from purchase import matching by material name only.
 *
 *   npx tsx server/src/scripts/repairImportRollItemLinks.ts --file-name=AHMET
 *   npx tsx server/src/scripts/repairImportRollItemLinks.ts --file-name=AHMET --apply
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from '../db/pool.js';
import { cleanString } from '../utils/importColumnDetector.js';
import {
  reconcileImportMaterialAndColorCodes,
  sanitizeNormalizedImportRow,
} from '../utils/importMaterialCodeResolver.js';
import {
  findFabricItemByImportDesignCode,
  findOrCreateImportFabricItem,
} from '../utils/purchaseImportMaterialCodes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

function readArg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=').trim() || undefined;
  const idx = process.argv.indexOf(hit);
  return process.argv[idx + 1]?.trim() || undefined;
}

function extractRowFields(payload: unknown): {
  materialName: string;
  materialCode: string;
} {
  const row =
    payload && typeof payload === 'object'
      ? { ...(payload as Record<string, unknown>) }
      : {};
  sanitizeNormalizedImportRow(row);
  const reconciled = reconcileImportMaterialAndColorCodes({
    internalMaterialCode: cleanString(row.internalMaterialCode),
    supplierMaterialCode: cleanString(row.supplierMaterialCode),
    colorCode: cleanString(row.colorCode),
  });
  return {
    materialName: cleanString(row.materialName),
    materialCode: reconciled.materialCode,
  };
}

async function resolveCompanyId(pool: ReturnType<typeof getPool>): Promise<string> {
  const fromEnv = process.env.COMPANY_ID?.trim();
  if (fromEnv) return fromEnv;
  const c = await pool.query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
  if (!c.rows.length) throw new Error('لا توجد شركة');
  return c.rows[0].id;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const fileName = readArg('--file-name') ?? 'AHMET BARAKAT SURYA 1.xls';
  const batchIdArg = readArg('--batch-id');
  const pool = getPool();
  const companyId = await resolveCompanyId(pool);

  const batches = batchIdArg
    ? await pool.query<{ id: string; file_name: string; status: string }>(
        `SELECT id, file_name, status FROM purchase_import_batches
         WHERE company_id = $1 AND id = $2::uuid AND status = 'CONFIRMED'`,
        [companyId, batchIdArg],
      )
    : await pool.query<{ id: string; file_name: string; status: string }>(
        `SELECT id, file_name, status FROM purchase_import_batches
         WHERE company_id = $1 AND file_name = $2 AND status = 'CONFIRMED'
         ORDER BY confirmed_at ASC NULLS LAST`,
        [companyId, fileName],
      );

  const report = {
    dryRun: !apply,
    batches: batches.rows.map((b) => ({ id: b.id, fileName: b.file_name })),
    scanned: 0,
    movedRolls: 0,
    itemsCreated: 0,
    itemsRenamed: 0,
    codesFixed: 0,
    samples: [] as Array<Record<string, string>>,
  };

  const client = await pool.connect();
  try {
    if (apply) await client.query('BEGIN');

    for (const batch of batches.rows) {
      const rows = await client.query<{
        id: string;
        row_no: number;
        created_roll_id: string | null;
        normalized_data: unknown;
        raw_data: unknown;
      }>(
        `SELECT id, row_no, created_roll_id, normalized_data, raw_data
         FROM purchase_import_rows
         WHERE company_id = $1 AND batch_id = $2 AND created_roll_id IS NOT NULL
         ORDER BY row_no`,
        [companyId, batch.id],
      );

      for (const rowRec of rows.rows) {
        report.scanned += 1;
        const corrected = extractRowFields(rowRec.normalized_data ?? rowRec.raw_data);
        if (!corrected.materialName) continue;

        const rollQ = await client.query<{
          id: string;
          item_id: string;
          barcode: string | null;
          item_name: string;
          internal_code: string;
          supplier_code: string | null;
        }>(
          `SELECT fr.id, fr.item_id, fr.barcode, fi.name AS item_name,
                  fi.internal_code, fi.supplier_code
           FROM fabric_rolls fr
           JOIN fabric_items fi ON fi.id = fr.item_id
           WHERE fr.id = $1 AND fr.company_id = $2`,
          [rowRec.created_roll_id, companyId],
        );
        if (!rollQ.rows.length) continue;
        const roll = rollQ.rows[0];

        let targetId = roll.item_id;
        let targetCreated = false;
        if (corrected.materialCode) {
          const byCode = await findFabricItemByImportDesignCode(
            client,
            companyId,
            corrected.materialCode,
          );
          if (byCode) targetId = byCode;
        }
        if (apply) {
          const target = await findOrCreateImportFabricItem(
            client,
            companyId,
            corrected.materialName,
            corrected.materialCode,
          );
          targetId = target.id;
          targetCreated = target.created;
          if (target.created) report.itemsCreated += 1;
        } else if (targetId === roll.item_id && corrected.materialCode) {
          const wouldCreate = !(await findFabricItemByImportDesignCode(
            client,
            companyId,
            corrected.materialCode,
          ));
          if (wouldCreate) targetId = `new:${corrected.materialCode}`;
        }

        const code = corrected.materialCode;
        const needsMove = roll.item_id !== targetId;
        const needsRename =
          code
          && roll.item_name.toLowerCase().trim() !== corrected.materialName.toLowerCase().trim();
        const needsCodeFix =
          !!code
          && roll.internal_code.toLowerCase().trim() !== code.toLowerCase().trim()
          && roll.supplier_code?.toLowerCase().trim() !== code.toLowerCase().trim();

        if (!needsMove && !needsRename && !needsCodeFix) continue;

        if (report.samples.length < 25) {
          report.samples.push({
            batch: batch.file_name,
            row: String(rowRec.row_no),
            barcode: roll.barcode ?? '',
            fromItem: roll.item_name,
            fromCode: roll.internal_code,
            toName: corrected.materialName,
            toCode: code || '(name only)',
            action: needsMove ? 'move' : needsCodeFix ? 'fix-code' : 'rename',
          });
        }

        if (!apply) {
          if (needsMove) report.movedRolls += 1;
          if (needsCodeFix) report.codesFixed += 1;
          if (needsRename) report.itemsRenamed += 1;
          continue;
        }

        if (needsMove) {
          await client.query(
            `UPDATE fabric_rolls SET item_id = $3, updated_at = now()
             WHERE id = $1 AND company_id = $2`,
            [roll.id, companyId, targetId],
          );
          report.movedRolls += 1;
        }

        if (code) {
          const dup = await client.query<{ id: string }>(
            `SELECT id FROM fabric_items
             WHERE company_id = $1
               AND lower(trim(internal_code)) = lower(trim($2))
               AND id <> $3
             LIMIT 1`,
            [companyId, code, targetId],
          );
          if (!dup.rows.length) {
            await client.query(
              `UPDATE fabric_items SET
                 name = $3,
                 internal_code = $4,
                 supplier_code = COALESCE($5, supplier_code),
                 updated_at = now()
               WHERE id = $1 AND company_id = $2`,
              [targetId, companyId, corrected.materialName, code, code],
            );
            if (needsCodeFix || needsRename) {
              report.codesFixed += 1;
              if (needsRename) report.itemsRenamed += 1;
            }
          } else {
            await client.query(
              `UPDATE fabric_items SET name = $3, updated_at = now()
               WHERE id = $1 AND company_id = $2`,
              [targetId, companyId, corrected.materialName],
            );
            if (needsRename) report.itemsRenamed += 1;
          }
        } else if (needsRename) {
          await client.query(
            `UPDATE fabric_items SET name = $3, updated_at = now()
             WHERE id = $1 AND company_id = $2`,
            [targetId, companyId, corrected.materialName],
          );
          report.itemsRenamed += 1;
        }
      }
    }

    if (apply) await client.query('COMMIT');
  } catch (e) {
    if (apply) await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error('[repair-import-roll-links] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
