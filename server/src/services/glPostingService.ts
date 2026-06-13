import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { generateDocumentNo } from '../utils/documentNumbers.js';
import { ensureCompanyGlCoa, ensureCompanyInvoiceGlAccounts, getGlAccountIdByKey, GL_KEYS } from './glCoaService.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function postVoucherToGl(
  client: PoolClient,
  input: {
    companyId: string;
    voucherId: string;
    voucherNo: string;
    voucherDate: string;
    voucherType: 'RECEIPT' | 'PAYMENT';
    amount: number;
    amountUsd: number;
    currencyCode: string;
    exchangeRateToUsd: number;
    cashboxId: string;
    partyType: string | null;
    partyId: string | null;
    description: string | null;
    userId: string | null;
  },
): Promise<void> {
  await ensureCompanyGlCoa(client, input.companyId);

  const dup = await client.query(
    `SELECT id FROM journal_entries WHERE company_id=$1 AND source_type='VOUCHER' AND source_id=$2`,
    [input.companyId, input.voucherId],
  );
  if (dup.rows.length) return;

  const amt = round2(input.amountUsd);
  if (amt <= 0) return;

  const cashId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.CASH);
  const arId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.AR);
  const apId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.AP);
  const suspRec = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.SUSPENSE_RECEIPT);
  const suspPay = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.SUSPENSE_PAYMENT);

  const pt = input.partyType;
  const pid = input.partyId;
  const ccy = 'USD';
  const desc = input.description ?? `${input.voucherType === 'RECEIPT' ? 'قبض' : 'صرف'} ${input.voucherNo}`;
  const entryDate = input.voucherDate.slice(0, 10);

  const lines: Array<{
    glAccountId: string;
    debit: number;
    credit: number;
    currencyCode: string;
    description: string;
    cashboxId?: string | null;
    partyType?: string | null;
    partyId?: string | null;
  }> = [];

  if (input.voucherType === 'RECEIPT') {
    lines.push({
      glAccountId: cashId,
      debit: amt,
      credit: 0,
      currencyCode: ccy,
      description: desc,
      cashboxId: input.cashboxId,
    });
    if (pt === 'CUSTOMER') {
      lines.push({
        glAccountId: arId,
        debit: 0,
        credit: amt,
        currencyCode: ccy,
        description: `تسوية ذمم عميل — ${input.voucherNo}`,
        partyType: 'CUSTOMER',
        partyId: pid,
      });
    } else if (pt === 'SUPPLIER') {
      lines.push({
        glAccountId: apId,
        debit: 0,
        credit: amt,
        currencyCode: ccy,
        description: `تخفيض ذمة مورد — ${input.voucherNo}`,
        partyType: 'SUPPLIER',
        partyId: pid,
      });
    } else {
      lines.push({
        glAccountId: suspRec,
        debit: 0,
        credit: amt,
        currencyCode: ccy,
        description: `قبض غير مصنف — ${input.voucherNo}`,
      });
    }
  } else {
    if (pt === 'SUPPLIER') {
      lines.push({
        glAccountId: apId,
        debit: amt,
        credit: 0,
        currencyCode: ccy,
        description: `صرف لمورد — ${input.voucherNo}`,
        partyType: 'SUPPLIER',
        partyId: pid,
      });
    } else if (pt === 'CUSTOMER') {
      lines.push({
        glAccountId: arId,
        debit: amt,
        credit: 0,
        currencyCode: ccy,
        description: `سداد/صرف لعميل — ${input.voucherNo}`,
        partyType: 'CUSTOMER',
        partyId: pid,
      });
    } else {
      lines.push({
        glAccountId: suspPay,
        debit: amt,
        credit: 0,
        currencyCode: ccy,
        description: `صرف غير مصنف — ${input.voucherNo}`,
      });
    }
    lines.push({
      glAccountId: cashId,
      debit: 0,
      credit: amt,
      currencyCode: ccy,
      description: desc,
      cashboxId: input.cashboxId,
    });
  }

  await insertBalancedJournal(client, {
    companyId: input.companyId,
    entryDate,
    description: desc,
    sourceType: 'VOUCHER',
    sourceId: input.voucherId,
    userId: input.userId,
    lines,
  });
}

export async function reverseVoucherGl(
  client: PoolClient,
  input: {
    companyId: string;
    voucherId: string;
    voucherNo: string;
    userId: string | null;
  },
): Promise<void> {
  await reverseJournalBySource(client, {
    companyId: input.companyId,
    originalSourceType: 'VOUCHER',
    originalSourceId: input.voucherId,
    reversalSourceType: 'VOUCHER_REVERSAL',
    reversalSourceId: input.voucherId,
    description: `عكس قيد سند ${input.voucherNo}`,
    userId: input.userId,
  });
}

export async function postReturnInvoiceToGl(
  client: PoolClient,
  input: {
    companyId: string;
    returnInvoiceId: string;
    returnNo: string;
    returnDate: string;
    returnType: 'SALES_RETURN' | 'PURCHASE_RETURN';
    totalAmountUsd: number;
    currencyCode: string;
    customerId: string | null;
    supplierId: string | null;
    userId: string | null;
    /** When set, skip all GL lines (including COGS) — physical stock may still move elsewhere. */
    settlementType?: string | null;
    cashboxId?: string | null;
    /** Per returned roll — restores inventory and reverses COGS (sales returns only). */
    linesForCogs?: SalesInvoiceLineCogsInput[];
  },
): Promise<void> {
  await ensureCompanyGlCoa(client, input.companyId);
  if (input.settlementType === 'NO_FINANCIAL_EFFECT') return;

  const dup = await client.query(
    `SELECT id FROM journal_entries WHERE company_id=$1 AND source_type='RETURN_INVOICE' AND source_id=$2`,
    [input.companyId, input.returnInvoiceId],
  );
  if (dup.rows.length) return;

  const amt = round2(input.totalAmountUsd);
  if (amt <= 0) return;

  const cogsLines =
    input.returnType === 'SALES_RETURN' && input.linesForCogs?.length
      ? input.linesForCogs
      : [];
  const cogsTotal = round2(
    cogsLines.reduce((sum, ln) => {
      const uc = ln.unitCostPerMeter;
      if (uc == null || uc <= 0) return sum;
      const cost = round2(ln.quantityMeters * uc);
      return sum + (cost > 0 ? cost : 0);
    }, 0),
  );
  if (cogsTotal > 0) {
    await ensureCompanyInvoiceGlAccounts(client, input.companyId);
  }

  const arId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.AR);
  const apId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.AP);
  const cashId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.CASH);
  const salesRet = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.SALES_RETURNS);
  const purchRet = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.PURCHASE_RETURNS);
  const ccy = 'USD';
  const entryDate = input.returnDate.slice(0, 10);
  const isCashRefund = input.settlementType === 'CASH_REFUND';

  const lines: {
    glAccountId: string;
    debit: number;
    credit: number;
    currencyCode: string;
    description: string;
    cashboxId?: string | null;
    partyType?: string | null;
    partyId?: string | null;
  }[] = [];

  if (input.returnType === 'SALES_RETURN') {
    lines.push({
      glAccountId: salesRet,
      debit: amt,
      credit: 0,
      currencyCode: ccy,
      description: `مرتجع مبيعات ${input.returnNo}`,
    });
    if (isCashRefund) {
      lines.push({
        glAccountId: cashId,
        debit: 0,
        credit: amt,
        currencyCode: ccy,
        description: `رد نقدي — مرتجع ${input.returnNo}`,
        cashboxId: input.cashboxId ?? null,
      });
    } else {
      lines.push({
        glAccountId: arId,
        debit: 0,
        credit: amt,
        currencyCode: ccy,
        description: `تخفيض ذمة عميل — ${input.returnNo}`,
        partyType: 'CUSTOMER',
        partyId: input.customerId,
      });
    }
    const invId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.INVENTORY);
    const cogsId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.COGS);
    for (const ln of cogsLines) {
      const uc = ln.unitCostPerMeter;
      if (uc == null || uc <= 0) continue;
      const cost = round2(ln.quantityMeters * uc);
      if (cost <= 0) continue;
      lines.push({
        glAccountId: invId,
        debit: cost,
        credit: 0,
        currencyCode: ccy,
        description: `إعادة مخزون — ${input.returnNo}`,
      });
      lines.push({
        glAccountId: cogsId,
        debit: 0,
        credit: cost,
        currencyCode: ccy,
        description: `عكس تكلفة — ${input.returnNo}`,
      });
    }
  } else {
    if (isCashRefund) {
      lines.push({
        glAccountId: cashId,
        debit: amt,
        credit: 0,
        currencyCode: ccy,
        description: `استرداد نقدي — مرتجع ${input.returnNo}`,
        cashboxId: input.cashboxId ?? null,
      });
    } else {
      lines.push({
        glAccountId: apId,
        debit: amt,
        credit: 0,
        currencyCode: ccy,
        description: `تخفيض ذمة مورد — ${input.returnNo}`,
        partyType: 'SUPPLIER',
        partyId: input.supplierId,
      });
    }
    lines.push({
      glAccountId: purchRet,
      debit: 0,
      credit: amt,
      currencyCode: ccy,
      description: `مرتجع مشتريات ${input.returnNo}`,
    });
  }

  await insertBalancedJournal(client, {
    companyId: input.companyId,
    entryDate,
    description: `مرتجع ${input.returnNo}`,
    sourceType: 'RETURN_INVOICE',
    sourceId: input.returnInvoiceId,
    userId: input.userId,
    lines,
  });
}

export async function reverseReturnInvoiceGl(
  client: PoolClient,
  input: {
    companyId: string;
    returnInvoiceId: string;
    returnNo: string;
    userId: string | null;
  },
): Promise<void> {
  await reverseJournalBySource(client, {
    companyId: input.companyId,
    originalSourceType: 'RETURN_INVOICE',
    originalSourceId: input.returnInvoiceId,
    reversalSourceType: 'RETURN_INVOICE_REVERSAL',
    reversalSourceId: input.returnInvoiceId,
    description: `عكس قيد مرتجع ${input.returnNo}`,
    userId: input.userId,
  });
}

export async function postPayrollAccrualToGl(
  client: PoolClient,
  input: {
    companyId: string;
    payrollRunId: string;
    payrollNo: string;
    periodDate: string;
    totalNet: number;
    currencyCode: string;
    userId: string | null;
  },
): Promise<void> {
  await ensureCompanyGlCoa(client, input.companyId);
  const dup = await client.query(
    `SELECT id FROM journal_entries WHERE company_id=$1 AND source_type='PAYROLL_ACCRUAL' AND source_id=$2`,
    [input.companyId, input.payrollRunId],
  );
  if (dup.rows.length) return;

  const amt = round2(input.totalNet);
  if (amt <= 0) return;

  const expId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.PAYROLL_EXPENSE);
  const payId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.PAYROLL_PAYABLE);
  const ccy = input.currencyCode || 'USD';

  await insertBalancedJournal(client, {
    companyId: input.companyId,
    entryDate: input.periodDate.slice(0, 10),
    description: `استحقاق رواتب ${input.payrollNo}`,
    sourceType: 'PAYROLL_ACCRUAL',
    sourceId: input.payrollRunId,
    userId: input.userId,
    lines: [
      {
        glAccountId: expId,
        debit: amt,
        credit: 0,
        currencyCode: ccy,
        description: `مصروف رواتب ${input.payrollNo}`,
      },
      {
        glAccountId: payId,
        debit: 0,
        credit: amt,
        currencyCode: ccy,
        description: `رواتب مستحقة ${input.payrollNo}`,
      },
    ],
  });
}

export async function postPayrollPaymentToGl(
  client: PoolClient,
  input: {
    companyId: string;
    payrollRunId: string;
    payrollNo: string;
    paymentDate: string;
    totalNet: number;
    currencyCode: string;
    cashboxId: string;
    userId: string | null;
  },
): Promise<void> {
  await ensureCompanyGlCoa(client, input.companyId);
  const dup = await client.query(
    `SELECT id FROM journal_entries WHERE company_id=$1 AND source_type='PAYROLL_PAYMENT' AND source_id=$2`,
    [input.companyId, input.payrollRunId],
  );
  if (dup.rows.length) return;

  const amt = round2(input.totalNet);
  if (amt <= 0) return;

  const payId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.PAYROLL_PAYABLE);
  const cashId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.CASH);
  const ccy = input.currencyCode || 'USD';

  await insertBalancedJournal(client, {
    companyId: input.companyId,
    entryDate: input.paymentDate.slice(0, 10),
    description: `دفع رواتب ${input.payrollNo} — من الخزينة`,
    sourceType: 'PAYROLL_PAYMENT',
    sourceId: input.payrollRunId,
    userId: input.userId,
    lines: [
      {
        glAccountId: payId,
        debit: amt,
        credit: 0,
        currencyCode: ccy,
        description: `شطب ذمة رواتب ${input.payrollNo}`,
      },
      {
        glAccountId: cashId,
        debit: 0,
        credit: amt,
        currencyCode: ccy,
        description: `صرف صافي رواتب ${input.payrollNo}`,
        cashboxId: input.cashboxId,
      },
    ],
  });
}

export async function reversePayrollAccrualGl(
  client: PoolClient,
  input: { companyId: string; payrollRunId: string; payrollNo: string; userId: string | null },
): Promise<void> {
  await reverseJournalBySource(client, {
    companyId: input.companyId,
    originalSourceType: 'PAYROLL_ACCRUAL',
    originalSourceId: input.payrollRunId,
    reversalSourceType: 'PAYROLL_REVERSAL',
    reversalSourceId: input.payrollRunId,
    description: `عكس استحقاق رواتب ${input.payrollNo}`,
    userId: input.userId,
  });
}

export type SalesInvoiceLineCogsInput = {
  quantityMeters: number;
  unitCostPerMeter: number | null;
};

/** Revenue + AR (+ optional COGS / inventory from roll unit costs). Idempotent per invoice id. */
export async function postSalesInvoiceToGl(
  client: PoolClient,
  input: {
    companyId: string;
    salesInvoiceId: string;
    invoiceNo: string;
    invoiceDate: string;
    customerId: string;
    totalAmountUsd: number;
    currencyCode: string;
    userId: string | null;
    linesForCogs: SalesInvoiceLineCogsInput[];
  },
): Promise<void> {
  await ensureCompanyInvoiceGlAccounts(client, input.companyId);
  const dup = await client.query(
    `SELECT id FROM journal_entries WHERE company_id=$1 AND source_type='SALES_INVOICE' AND source_id=$2`,
    [input.companyId, input.salesInvoiceId],
  );
  if (dup.rows.length) return;

  const total = round2(input.totalAmountUsd);
  if (total <= 0) return;

  const arId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.AR);
  const revId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.SALES_REVENUE);
  const cogsId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.COGS);
  const invId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.INVENTORY);

  const ccy = 'USD';
  const entryDate = input.invoiceDate.slice(0, 10);

  const lines: Array<{
    glAccountId: string;
    debit: number;
    credit: number;
    currencyCode: string;
    description: string;
    cashboxId?: string | null;
    partyType?: string | null;
    partyId?: string | null;
  }> = [
    {
      glAccountId: arId,
      debit: total,
      credit: 0,
      currencyCode: ccy,
      description: `فاتورة مبيعات ${input.invoiceNo}`,
      partyType: 'CUSTOMER',
      partyId: input.customerId,
    },
    {
      glAccountId: revId,
      debit: 0,
      credit: total,
      currencyCode: ccy,
      description: `إيراد — ${input.invoiceNo}`,
    },
  ];

  for (const ln of input.linesForCogs) {
    const uc = ln.unitCostPerMeter;
    if (uc == null || uc <= 0) continue;
    const qty = round2(ln.quantityMeters);
    const cost = round2(qty * uc);
    if (cost <= 0) continue;
    lines.push({
      glAccountId: cogsId,
      debit: cost,
      credit: 0,
      currencyCode: ccy,
      description: `تكلفة — ${input.invoiceNo}`,
    });
    lines.push({
      glAccountId: invId,
      debit: 0,
      credit: cost,
      currencyCode: ccy,
      description: `شطب مخزون — ${input.invoiceNo}`,
    });
  }

  await insertBalancedJournal(client, {
    companyId: input.companyId,
    entryDate,
    description: `فاتورة مبيعات ${input.invoiceNo}`,
    sourceType: 'SALES_INVOICE',
    sourceId: input.salesInvoiceId,
    userId: input.userId,
    lines,
  });
}

export async function reverseSalesInvoiceGl(
  client: PoolClient,
  input: { companyId: string; salesInvoiceId: string; invoiceNo: string; userId: string | null },
): Promise<void> {
  await reverseJournalBySource(client, {
    companyId: input.companyId,
    originalSourceType: 'SALES_INVOICE',
    originalSourceId: input.salesInvoiceId,
    reversalSourceType: 'SALES_INVOICE_REVERSAL',
    reversalSourceId: input.salesInvoiceId,
    description: `عكس قيد فاتورة مبيعات ${input.invoiceNo}`,
    userId: input.userId,
  });
}

/** Dr Inventory / Cr AP. Idempotent per purchase invoice id. */
export async function postPurchaseInvoiceToGl(
  client: PoolClient,
  input: {
    companyId: string;
    purchaseInvoiceId: string;
    invoiceNo: string;
    invoiceDate: string;
    supplierId: string;
    totalAmountUsd: number;
    currencyCode: string;
    userId: string | null;
  },
): Promise<void> {
  await ensureCompanyInvoiceGlAccounts(client, input.companyId);
  const dup = await client.query(
    `SELECT id FROM journal_entries WHERE company_id=$1 AND source_type='PURCHASE_INVOICE' AND source_id=$2`,
    [input.companyId, input.purchaseInvoiceId],
  );
  if (dup.rows.length) return;

  const total = round2(input.totalAmountUsd);
  if (total <= 0) return;

  const invId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.INVENTORY);
  const apId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.AP);
  const ccy = 'USD';
  const entryDate = input.invoiceDate.slice(0, 10);

  await insertBalancedJournal(client, {
    companyId: input.companyId,
    entryDate,
    description: `فاتورة مشتريات ${input.invoiceNo}`,
    sourceType: 'PURCHASE_INVOICE',
    sourceId: input.purchaseInvoiceId,
    userId: input.userId,
    lines: [
      {
        glAccountId: invId,
        debit: total,
        credit: 0,
        currencyCode: ccy,
        description: `زيادة مخزون — ${input.invoiceNo}`,
      },
      {
        glAccountId: apId,
        debit: 0,
        credit: total,
        currencyCode: ccy,
        description: `ذمة مورد — ${input.invoiceNo}`,
        partyType: 'SUPPLIER',
        partyId: input.supplierId,
      },
    ],
  });
}

/** تكاليف الاستيراد (شحن/جمارك...) — تُحمَّل على المخزون دون زيادة ذمة المورد */
export async function postImportLandingCostsToGl(
  client: PoolClient,
  input: {
    companyId: string;
    batchId: string;
    purchaseInvoiceId: string;
    invoiceNo: string;
    invoiceDate: string;
    landingAmountUsd: number;
    userId: string | null;
  },
): Promise<void> {
  await ensureCompanyInvoiceGlAccounts(client, input.companyId);
  const dup = await client.query(
    `SELECT id FROM journal_entries WHERE company_id=$1 AND source_type='IMPORT_LANDING_COST' AND source_id=$2`,
    [input.companyId, input.batchId],
  );
  if (dup.rows.length) return;

  const amt = round2(input.landingAmountUsd);
  if (amt <= 0) return;

  const invId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.INVENTORY);
  const suspPay = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.SUSPENSE_PAYMENT);
  const ccy = 'USD';
  const entryDate = input.invoiceDate.slice(0, 10);

  await insertBalancedJournal(client, {
    companyId: input.companyId,
    entryDate,
    description: `تكاليف استيراد — ${input.invoiceNo}`,
    sourceType: 'IMPORT_LANDING_COST',
    sourceId: input.batchId,
    userId: input.userId,
    lines: [
      {
        glAccountId: invId,
        debit: amt,
        credit: 0,
        currencyCode: ccy,
        description: `تكاليف وصول مخزون — ${input.invoiceNo}`,
      },
      {
        glAccountId: suspPay,
        debit: 0,
        credit: amt,
        currencyCode: ccy,
        description: `تكاليف استيراد (غير مورد) — ${input.invoiceNo}`,
      },
    ],
  });
}

export async function reversePurchaseInvoiceGl(
  client: PoolClient,
  input: { companyId: string; purchaseInvoiceId: string; invoiceNo: string; userId: string | null },
): Promise<void> {
  await reverseJournalBySource(client, {
    companyId: input.companyId,
    originalSourceType: 'PURCHASE_INVOICE',
    originalSourceId: input.purchaseInvoiceId,
    reversalSourceType: 'PURCHASE_INVOICE_REVERSAL',
    reversalSourceId: input.purchaseInvoiceId,
    description: `عكس قيد فاتورة مشتريات ${input.invoiceNo}`,
    userId: input.userId,
  });
}

async function insertBalancedJournal(
  client: PoolClient,
  params: {
    companyId: string;
    entryDate: string;
    description: string;
    sourceType: string;
    sourceId: string;
    userId: string | null;
    lines: Array<{
      glAccountId: string;
      debit: number;
      credit: number;
      currencyCode: string;
      description: string;
      cashboxId?: string | null;
      partyType?: string | null;
      partyId?: string | null;
    }>;
  },
): Promise<string> {
  const sumD = round2(params.lines.reduce((s, l) => s + l.debit, 0));
  const sumC = round2(params.lines.reduce((s, l) => s + l.credit, 0));
  if (sumD !== sumC) {
    throw Object.assign(new Error(`قيد GL غير متوازن: مدين ${sumD} دائن ${sumC}`), { code: 'GL_UNBALANCED' });
  }

  const entryNo = generateDocumentNo('JE');
  const ins = await client.query<{ id: string }>(
    `INSERT INTO journal_entries (company_id, entry_no, entry_date, description, source_type, source_id, status, created_by_user_id)
     VALUES ($1,$2,$3::date,$4,$5,$6,'POSTED',$7) RETURNING id`,
    [params.companyId, entryNo, params.entryDate, params.description, params.sourceType, params.sourceId, params.userId],
  );
  const entryId = ins.rows[0].id;
  let i = 0;
  for (const ln of params.lines) {
    i++;
    await client.query(
      `INSERT INTO journal_lines (
         company_id, entry_id, line_no, gl_account_id, cashbox_id, party_type, party_id, description, debit, credit, currency_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        params.companyId,
        entryId,
        i,
        ln.glAccountId,
        ln.cashboxId ?? null,
        ln.partyType ?? null,
        ln.partyId ?? null,
        ln.description,
        ln.debit,
        ln.credit,
        ln.currencyCode,
      ],
    );
  }
  return entryId;
}

async function reverseJournalBySource(
  client: PoolClient,
  input: {
    companyId: string;
    originalSourceType: string;
    originalSourceId: string;
    reversalSourceType: string;
    reversalSourceId: string;
    description: string;
    userId: string | null;
  },
): Promise<void> {
  const exist = await client.query<{ id: string }>(
    `SELECT id FROM journal_entries WHERE company_id=$1 AND source_type=$2 AND source_id=$3`,
    [input.companyId, input.originalSourceType, input.originalSourceId],
  );
  if (!exist.rows.length) return;

  const revDup = await client.query(
    `SELECT id FROM journal_entries WHERE company_id=$1 AND source_type=$2 AND source_id=$3`,
    [input.companyId, input.reversalSourceType, input.reversalSourceId],
  );
  if (revDup.rows.length) return;

  const origEntryId = exist.rows[0].id;
  const lines = await client.query(
    `SELECT gl_account_id, cashbox_id, party_type, party_id, description, debit, credit, currency_code
     FROM journal_lines WHERE entry_id=$1 ORDER BY line_no`,
    [origEntryId],
  );

  const entryNo = generateDocumentNo('JE');
  const entryDate = new Date().toISOString().slice(0, 10);
  const insE = await client.query<{ id: string }>(
    `INSERT INTO journal_entries (
       company_id, entry_no, entry_date, description, source_type, source_id, status, reversed_entry_id, created_by_user_id
     ) VALUES ($1,$2,$3::date,$4,$5,$6,'POSTED',$7,$8) RETURNING id`,
    [
      input.companyId,
      entryNo,
      entryDate,
      input.description,
      input.reversalSourceType,
      input.reversalSourceId,
      origEntryId,
      input.userId,
    ],
  );
  const newEntryId = insE.rows[0].id;
  let lineNo = 0;
  for (const ln of lines.rows) {
    lineNo++;
    await client.query(
      `INSERT INTO journal_lines (
         company_id, entry_id, line_no, gl_account_id, cashbox_id, party_type, party_id, description, debit, credit, currency_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.companyId,
        newEntryId,
        lineNo,
        ln.gl_account_id,
        ln.cashbox_id,
        ln.party_type,
        ln.party_id,
        `عكس: ${ln.description ?? ''}`.trim(),
        Number(ln.credit),
        Number(ln.debit),
        ln.currency_code,
      ],
    );
  }
}

export type ManualJournalLineInput = {
  glAccountId: string;
  debit: number;
  credit: number;
  currencyCode?: string;
  description?: string | null;
  cashboxId?: string | null;
  partyType?: string | null;
  partyId?: string | null;
};

export async function postManualJournal(
  client: PoolClient,
  input: {
    companyId: string;
    entryDate: string;
    description: string;
    userId: string | null;
    lines: ManualJournalLineInput[];
  },
): Promise<string> {
  await ensureCompanyGlCoa(client, input.companyId);
  const ccyDefault = 'USD';
  const lines = input.lines.map((l) => ({
    glAccountId: l.glAccountId,
    debit: round2(l.debit),
    credit: round2(l.credit),
    currencyCode: l.currencyCode || ccyDefault,
    description: (l.description?.trim() || input.description) as string,
    cashboxId: l.cashboxId ?? null,
    partyType: l.partyType ?? null,
    partyId: l.partyId ?? null,
  }));

  for (const l of lines) {
    if (l.debit < 0 || l.credit < 0) {
      throw Object.assign(new Error('مبالغ سالبة غير مسموحة'), { code: 'VALIDATION' });
    }
    if (l.debit > 0 && l.credit > 0) {
      throw Object.assign(new Error('السطر لا يجمع مدين ودائناً معاً'), { code: 'VALIDATION' });
    }
    if (l.debit === 0 && l.credit === 0) {
      throw Object.assign(new Error('سطر فارغ'), { code: 'VALIDATION' });
    }
  }

  return insertBalancedJournal(client, {
    companyId: input.companyId,
    entryDate: input.entryDate.slice(0, 10),
    description: input.description,
    sourceType: 'MANUAL',
    sourceId: randomUUID(),
    userId: input.userId,
    lines,
  });
}
