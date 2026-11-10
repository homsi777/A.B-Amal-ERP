import type { PoolClient } from 'pg';
import { createSalesInvoice } from './salesInvoiceService.js';
import { postManualJournal } from './glPostingService.js';
import { postCustomerOpeningBalance } from './customerOpeningBalanceService.js';
import { ensureCompanyOpeningBalanceGlAccount, getGlAccountIdByKey, GL_KEYS } from './glCoaService.js';

type ServiceErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'DUPLICATE';

function fail(message: string, code: ServiceErrorCode): never {
  throw Object.assign(new Error(message), { code });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type LegacyImportRowInput = {
  rowIndex: number;
  headerRowIndex: number;
  documentType?: string | null;
  documentNo?: string | null;
  documentDate?: string | null;
  documentRef?: string | null;
  description?: string | null;
  unitPrice?: number | null;
  quantity?: number | null;
  bonus?: number | null;
  pieceCount?: number | null;
  lineTotal?: number | null;
  unit?: string | null;
  warehouseName?: string | null;
  rollLotNo?: string | null;
  itemCode?: string | null;
  netAmount?: number | null;
  priceWithTax?: number | null;
  debit?: number | null;
  credit?: number | null;
  netDebit?: number | null;
  netCredit?: number | null;
  currencyCode?: string | null;
  raw?: unknown;
};

export type ImportLegacyStatementInput = {
  companyId: string;
  userId: string | null;
  customerId: string;
  fileName: string;
  currencyCode: string;
  exchangeRateToUsd: number;
  rows: LegacyImportRowInput[];
  openingBalanceDebit?: number;
  openingBalanceCredit?: number;
};

export type ImportLegacyStatementResult = {
  invoicesCreated: number;
  journalEntriesCreated: number;
  openingBalancePosted: boolean;
  skipped: string[];
};

function normalizeUnit(raw: string | null | undefined): 'meter' | 'yard' | 'kg' {
  const u = (raw || '').trim();
  if (/كج|كغ|kg/i.test(u)) return 'kg';
  if (/ياردة|yard/i.test(u)) return 'yard';
  return 'meter';
}

type HeaderGroup = {
  header: LegacyImportRowInput;
  details: LegacyImportRowInput[];
};

function groupRowsByHeader(rows: LegacyImportRowInput[]): HeaderGroup[] {
  const byHeader = new Map<number, HeaderGroup>();
  const order: number[] = [];
  for (const row of rows) {
    const key = row.headerRowIndex;
    if (!byHeader.has(key)) {
      const headerRow = rows.find((r) => r.rowIndex === key) ?? row;
      byHeader.set(key, { header: headerRow, details: [] });
      order.push(key);
    }
    if (row.rowIndex !== key) byHeader.get(key)!.details.push(row);
  }
  return order.map((key) => byHeader.get(key)!);
}

async function resolveOrCreateLegacyPurchaseSupplier(
  client: PoolClient,
  companyId: string,
  baseName: string,
): Promise<string> {
  const name = `${baseName} - مشتريات قديمة`;
  const existing = await client.query(`SELECT id FROM suppliers WHERE company_id = $1 AND name = $2 LIMIT 1`, [
    companyId,
    name,
  ]);
  if (existing.rows.length) return existing.rows[0].id;

  const code = `LEGACY-SUP-${Date.now().toString(36).toUpperCase()}`;
  const ins = await client.query(
    `INSERT INTO suppliers (company_id, code, name, is_processing_party)
     VALUES ($1, $2, $3, false)
     RETURNING id`,
    [companyId, code, name],
  );
  return ins.rows[0].id;
}

async function assertCustomerBelongsToCompany(client: PoolClient, companyId: string, customerId: string): Promise<string> {
  const row = await client.query(`SELECT id, name FROM customers WHERE id = $1 AND company_id = $2`, [customerId, companyId]);
  if (!row.rows.length) fail('العميل غير موجود', 'NOT_FOUND');
  return row.rows[0].name;
}

async function alreadyImported(client: PoolClient, companyId: string, legacyImportKey: string): Promise<boolean> {
  const row = await client.query(
    `SELECT 1 FROM sales_invoice_lines WHERE company_id = $1 AND metadata->>'legacyImportKey' = $2 LIMIT 1`,
    [companyId, legacyImportKey],
  );
  return row.rows.length > 0;
}

/** يستورد كشف حساب تفصيلي (قديم) كسجلات محاسبية حقيقية: فاتورة بيع حقيقية بكل
 * بنودها لكل "فاتورة بيع"، وقيد محاسبي متوازن لكل مستند آخر (مرتجع بيع/شراء/
 * مرتجع شراء/قيد مالي)، ورصيد افتتاحي حقيقي من صف "رصيد لتاريخه" — كل هذا يظهر
 * فوراً بكشف الحساب العادي (لا أرشيف منفصل). بنود الشراء تُسجَّل تحت مورّد عام
 * واحد منفصل كلياً عن حساب العميل (AR)، لا كفاتورة شراء حقيقية (تفادياً لإنشاء
 * أثواب/دفعات مخزون وهمية — `confirmPurchaseInvoice` لا يدعم سطور "قيمة فقط"). */
export async function importLegacyStatementAsRealRecords(
  client: PoolClient,
  input: ImportLegacyStatementInput,
): Promise<ImportLegacyStatementResult> {
  if (!input.fileName.trim()) fail('اسم الملف مطلوب', 'VALIDATION');
  if (!input.rows.length) fail('لا توجد صفوف للاستيراد', 'VALIDATION');
  if (!(input.exchangeRateToUsd > 0)) fail('سعر الصرف يجب أن يكون أكبر من صفر', 'VALIDATION');

  const customerName = await assertCustomerBelongsToCompany(client, input.companyId, input.customerId);
  const currencyCode = input.currencyCode.trim().toUpperCase();
  const rate = input.exchangeRateToUsd;

  const legacyImportKey = `${input.customerId}:${input.fileName.trim()}`;
  if (await alreadyImported(client, input.companyId, legacyImportKey)) {
    fail('هذا الملف مستورد مسبقاً لهذا العميل', 'DUPLICATE');
  }

  const groups = groupRowsByHeader(input.rows);
  const skipped: string[] = [];
  let invoicesCreated = 0;
  let journalEntriesCreated = 0;

  await ensureCompanyOpeningBalanceGlAccount(client, input.companyId);
  const arId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.AR);
  const apId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.AP);
  const clearingId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.OPENING_BALANCE_EQUITY);

  let legacySupplierId: string | null = null;
  async function supplierId(): Promise<string> {
    if (!legacySupplierId) {
      legacySupplierId = await resolveOrCreateLegacyPurchaseSupplier(client, input.companyId, customerName);
    }
    return legacySupplierId;
  }

  for (const group of groups) {
    const docType = group.header.documentType?.trim() || '';
    const isOpeningRow = !group.header.documentType && group.header.description === 'رصيد لتاريخه';
    if (isOpeningRow) continue; // يُعالَج بعد الحلقة عبر openingBalanceDebit/Credit

    const headerDebit = Number(group.header.debit ?? 0);
    const headerCredit = Number(group.header.credit ?? 0);
    const docNo = group.header.documentNo || `row-${group.header.rowIndex}`;
    const docDate = group.header.documentDate || new Date().toISOString().slice(0, 10);

    if (docType === 'فاتورة بيع') {
      const lines = group.details
        .filter((d) => (d.quantity ?? 0) > 0 || (d.lineTotal ?? 0) > 0)
        .map((d) => {
          let quantity = Number(d.quantity ?? 0);
          let unitPrice = Number(d.unitPrice ?? 0);
          const lineTotal = Number(d.lineTotal ?? quantity * unitPrice);
          if (quantity > 0 && unitPrice <= 0 && lineTotal > 0) unitPrice = round2(lineTotal / quantity);
          if (quantity <= 0 && lineTotal > 0) quantity = 1;
          return {
            fabricRollId: null,
            description: d.description || 'بند مستورد من كشف حساب',
            quantity,
            unit: normalizeUnit(d.unit),
            unitPrice,
            lineDiscount: 0,
            lineTax: 0,
            lineTotal: round2(lineTotal),
            metadata: {
              statementImport: true,
              legacyImport: true,
              legacyImportKey,
              itemCode: d.itemCode || null,
              rollLotNo: d.rollLotNo || null,
              warehouseName: d.warehouseName || null,
            },
          };
        });
      if (!lines.length) {
        skipped.push(`فاتورة بيع ${docNo} (صف ${group.header.rowIndex}): بلا بنود صالحة`);
        continue;
      }
      const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      const totalAmount = headerDebit > 0 ? round2(headerDebit) : subtotal;
      try {
        await createSalesInvoice(client, input.companyId, input.userId, {
          invoiceNo: 'AUTO',
          invoiceDate: docDate,
          customerId: input.customerId,
          warehouseId: null,
          warehouseLabel: `استيراد كشف حساب قديم: ${input.fileName}`,
          currencyCode,
          exchangeRateToUsd: rate,
          notes: `مستورد من كشف حساب قديم — رقم المستند الأصلي: ${docNo}`,
          subtotal,
          discountTotal: 0,
          taxTotal: 0,
          totalAmount,
          paidAmount: 0,
          remainingAmount: totalAmount,
          paymentStatus: 'unpaid',
          confirm: true,
          lines,
        });
        invoicesCreated++;
      } catch (err) {
        skipped.push(`فاتورة بيع ${docNo} (صف ${group.header.rowIndex}): ${err instanceof Error ? err.message : 'خطأ غير معروف'}`);
      }
      continue;
    }

    // كل الأنواع الأخرى (مرتجع بيع/شراء/مرتجع شراء/قيد مالي) → قيد محاسبي متوازن
    const isPurchaseSide = docType === 'فاتورة شراء' || docType === 'فاتورة مرتجع شراء';
    const partyAccountId = isPurchaseSide ? apId : arId;
    const partyType = isPurchaseSide ? 'SUPPLIER' : 'CUSTOMER';
    const partyId = isPurchaseSide ? await supplierId() : input.customerId;

    const usdDebit = round2(headerDebit / rate);
    const usdCredit = round2(headerCredit / rate);
    if (usdDebit <= 0 && usdCredit <= 0) {
      skipped.push(`${docType || 'قيد'} ${docNo} (صف ${group.header.rowIndex}): بلا قيمة`);
      continue;
    }

    const description = `${docType || 'قيد مستورد'} ${docNo} — مستورد من ${input.fileName} (الأصل: ${round2(
      headerDebit || headerCredit,
    )} ${currencyCode} @ سعر الصرف ${rate})`;

    try {
      await postManualJournal(client, {
        companyId: input.companyId,
        entryDate: docDate,
        description,
        userId: input.userId,
        lines: [
          { glAccountId: partyAccountId, partyType, partyId, debit: usdDebit, credit: usdCredit, description },
          { glAccountId: clearingId, debit: usdCredit, credit: usdDebit, description },
        ],
      });
      journalEntriesCreated++;
    } catch (err) {
      skipped.push(`${docType || 'قيد'} ${docNo} (صف ${group.header.rowIndex}): ${err instanceof Error ? err.message : 'خطأ غير معروف'}`);
    }
  }

  let openingBalancePosted = false;
  const openingDebit = round2(input.openingBalanceDebit ?? 0);
  const openingCredit = round2(input.openingBalanceCredit ?? 0);
  if (openingDebit > 0 || openingCredit > 0) {
    const direction: 'DEBIT' | 'CREDIT' = openingDebit >= openingCredit ? 'DEBIT' : 'CREDIT';
    const amount = direction === 'DEBIT' ? openingDebit : openingCredit;
    try {
      await postCustomerOpeningBalance(client, {
        companyId: input.companyId,
        userId: input.userId,
        customerId: input.customerId,
        amount,
        direction,
        asOfDate: new Date().toISOString().slice(0, 10),
        description: `رصيد افتتاحي من استيراد كشف حساب: ${input.fileName}`,
        currencyCode,
        exchangeRateToUsd: rate,
      });
      openingBalancePosted = true;
    } catch (err) {
      skipped.push(`الرصيد الافتتاحي: ${err instanceof Error ? err.message : 'خطأ غير معروف'}`);
    }
  }

  return { invoicesCreated, journalEntriesCreated, openingBalancePosted, skipped };
}
