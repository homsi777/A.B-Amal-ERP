import { getPool } from '../db/pool.js';

const EPS = 0.02;

export type AuditIssue = {
  invoiceType: 'SALES' | 'PURCHASE' | 'SYSTEM';
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  issueCode: string;
  expectedValue: string | null;
  actualValue: string | null;
  difference: string | null;
  severity: 'warning' | 'critical';
  explanationAr: string;
};

export type FinancialAuditReport = {
  generatedAt: string;
  companyId: string;
  invoiceConsistency: AuditIssue[];
  duplicateGlSources: AuditIssue[];
  duplicateCashboxSources: AuditIssue[];
  confirmedReturnsWithoutGl: AuditIssue[];
  confirmedCashRefundWithoutCashbox: AuditIssue[];
  cancelledCashRefundUnreversedCashbox: AuditIssue[];
  summary: {
    totalIssues: number;
    critical: number;
    warning: number;
  };
};

function issue(
  partial: Omit<AuditIssue, 'invoiceType'> & { invoiceType?: AuditIssue['invoiceType'] },
): AuditIssue {
  return { invoiceType: partial.invoiceType ?? 'SYSTEM', ...partial };
}

async function auditSalesInvoices(companyId: string): Promise<AuditIssue[]> {
  const pool = getPool();
  const rows = await pool.query<{
    id: string;
    invoice_no: string;
    document_status: string;
    currency_code: string;
    subtotal: string;
    discount_total: string;
    tax_total: string;
    total_amount: string;
    paid_amount: string;
    remaining_amount: string;
    exchange_rate_to_usd: string;
    line_gross_sum: string;
    line_discount_sum: string;
    line_total_sum: string;
    line_count: string;
  }>(
    `SELECT si.id, si.invoice_no, si.document_status, si.currency_code,
            si.subtotal, si.discount_total, si.tax_total, si.total_amount,
            si.paid_amount, si.remaining_amount, si.exchange_rate_to_usd,
            COALESCE(SUM(ROUND(sil.quantity * sil.unit_price, 2)), 0)::numeric AS line_gross_sum,
            COALESCE(SUM(sil.line_discount), 0)::numeric AS line_discount_sum,
            COALESCE(SUM(sil.line_total), 0)::numeric AS line_total_sum,
            COUNT(sil.id)::int AS line_count
     FROM sales_invoices si
     LEFT JOIN sales_invoice_lines sil ON sil.invoice_id = si.id AND sil.company_id = si.company_id
     WHERE si.company_id = $1
     GROUP BY si.id`,
    [companyId],
  );

  const out: AuditIssue[] = [];
  for (const r of rows.rows) {
    const base = {
      invoiceType: 'SALES' as const,
      invoiceId: r.id,
      invoiceNumber: r.invoice_no,
      status: r.document_status,
    };
    const subtotal = Number(r.subtotal);
    const lineGross = Number(r.line_gross_sum);
    if (Math.abs(subtotal - lineGross) > EPS) {
      out.push(
        issue({
          ...base,
          issueCode: 'SUBTOTAL_MISMATCH',
          expectedValue: String(lineGross),
          actualValue: String(subtotal),
          difference: String(round2(subtotal - lineGross)),
          severity: 'critical',
          explanationAr: 'المجموع الفرعي لا يطابق مجموع إجماليات الأسطر (قبل الخصم)',
        }),
      );
    }
    const discount = Number(r.discount_total);
    const lineDisc = Number(r.line_discount_sum);
    if (Math.abs(discount - lineDisc) > EPS && lineDisc > EPS) {
      out.push(
        issue({
          ...base,
          issueCode: 'DISCOUNT_MISMATCH',
          expectedValue: String(lineDisc),
          actualValue: String(discount),
          difference: String(round2(discount - lineDisc)),
          severity: 'warning',
          explanationAr: 'إجمالي الخصم لا يطابق مجموع خصومات الأسطر',
        }),
      );
    }
    const tax = Number(r.tax_total);
    const total = Number(r.total_amount);
    const expectedTotal = round2(subtotal - discount + tax);
    if (Math.abs(total - expectedTotal) > EPS) {
      out.push(
        issue({
          ...base,
          issueCode: 'TOTAL_FORMULA_MISMATCH',
          expectedValue: String(expectedTotal),
          actualValue: String(total),
          difference: String(round2(total - expectedTotal)),
          severity: 'critical',
          explanationAr: 'إجمالي الفاتورة لا يطابق (المجموع − الخصم + الضريبة)',
        }),
      );
    }
    const lineTotalSum = Number(r.line_total_sum);
    const expectedFromLines = round2(lineTotalSum + tax);
    if (Math.abs(total - expectedFromLines) > EPS) {
      out.push(
        issue({
          ...base,
          issueCode: 'TOTAL_LINES_MISMATCH',
          expectedValue: String(expectedFromLines),
          actualValue: String(total),
          difference: String(round2(total - expectedFromLines)),
          severity: 'warning',
          explanationAr: 'إجمالي الفاتورة لا يطابق (مجموع صافي الأسطر + الضريبة)',
        }),
      );
    }
    const paid = Number(r.paid_amount);
    const remaining = Number(r.remaining_amount);
    if (Math.abs(paid + remaining - total) > EPS) {
      out.push(
        issue({
          ...base,
          issueCode: 'PAID_REMAINING_MISMATCH',
          expectedValue: String(total),
          actualValue: String(round2(paid + remaining)),
          difference: String(round2(paid + remaining - total)),
          severity: 'critical',
          explanationAr: 'المحصل + المتبقي لا يطابق إجمالي الفاتورة',
        }),
      );
    }
    if (remaining < -EPS) {
      out.push(
        issue({
          ...base,
          issueCode: 'NEGATIVE_REMAINING',
          expectedValue: '>= 0',
          actualValue: String(remaining),
          difference: String(remaining),
          severity: 'critical',
          explanationAr: 'المتبقي سالب على فاتورة البيع',
        }),
      );
    }
    if (r.document_status === 'CONFIRMED' && Number(r.line_count) === 0) {
      out.push(
        issue({
          ...base,
          issueCode: 'CONFIRMED_NO_LINES',
          expectedValue: '> 0',
          actualValue: '0',
          difference: null,
          severity: 'critical',
          explanationAr: 'فاتورة بيع مؤكدة بدون أسطر',
        }),
      );
    }
    const rate = Number(r.exchange_rate_to_usd);
    if (r.currency_code !== 'USD' && (!Number.isFinite(rate) || rate <= 0)) {
      out.push(
        issue({
          ...base,
          issueCode: 'INVALID_EXCHANGE_RATE',
          expectedValue: '> 0',
          actualValue: String(rate),
          difference: null,
          severity: 'warning',
          explanationAr: 'سعر صرف غير صالح لفاتورة بعملة أجنبية',
        }),
      );
    }
  }

  const lineChecks = await pool.query<{
    invoice_id: string;
    invoice_no: string;
    document_status: string;
    line_no: number;
    quantity: string;
    unit_price: string;
    line_discount: string;
    line_total: string;
  }>(
    `SELECT si.id AS invoice_id, si.invoice_no, si.document_status, sil.line_no,
            sil.quantity, sil.unit_price, sil.line_discount, sil.line_total
     FROM sales_invoice_lines sil
     JOIN sales_invoices si ON si.id = sil.invoice_id AND si.company_id = sil.company_id
     WHERE sil.company_id = $1`,
    [companyId],
  );
  for (const ln of lineChecks.rows) {
    const gross = round2(Number(ln.quantity) * Number(ln.unit_price));
    const expected = round2(gross - Number(ln.line_discount));
    if (Math.abs(expected - Number(ln.line_total)) > EPS) {
      out.push(
        issue({
          invoiceType: 'SALES',
          invoiceId: ln.invoice_id,
          invoiceNumber: ln.invoice_no,
          status: ln.document_status,
          issueCode: 'LINE_TOTAL_MISMATCH',
          expectedValue: String(expected),
          actualValue: ln.line_total,
          difference: String(round2(Number(ln.line_total) - expected)),
          severity: 'warning',
          explanationAr: `سطر ${ln.line_no}: إجمالي السطر لا يطابق الكمية × السعر − الخصم`,
        }),
      );
    }
  }
  return out;
}

async function auditPurchaseInvoices(companyId: string): Promise<AuditIssue[]> {
  const pool = getPool();
  const rows = await pool.query<{
    id: string;
    invoice_no: string;
    document_status: string;
    currency_code: string;
    subtotal: string;
    discount_total: string;
    tax_total: string;
    total_amount: string;
    paid_amount: string;
    remaining_amount: string;
    exchange_rate_to_usd: string;
    line_gross_sum: string;
    line_discount_sum: string;
    line_total_sum: string;
    line_count: string;
  }>(
    `SELECT pi.id, pi.invoice_no, pi.document_status, pi.currency_code,
            pi.subtotal, pi.discount_total, pi.tax_total, pi.total_amount,
            pi.paid_amount, pi.remaining_amount, pi.exchange_rate_to_usd,
            COALESCE(SUM(ROUND(pil.quantity * pil.unit_cost, 2)), 0)::numeric AS line_gross_sum,
            COALESCE(SUM(pil.line_discount), 0)::numeric AS line_discount_sum,
            COALESCE(SUM(pil.line_total), 0)::numeric AS line_total_sum,
            COUNT(pil.id)::int AS line_count
     FROM purchase_invoices pi
     LEFT JOIN purchase_invoice_lines pil ON pil.invoice_id = pi.id AND pil.company_id = pi.company_id
     WHERE pi.company_id = $1
     GROUP BY pi.id`,
    [companyId],
  );

  const out: AuditIssue[] = [];
  for (const r of rows.rows) {
    const base = {
      invoiceType: 'PURCHASE' as const,
      invoiceId: r.id,
      invoiceNumber: r.invoice_no,
      status: r.document_status,
    };
    const subtotal = Number(r.subtotal);
    const lineGross = Number(r.line_gross_sum);
    if (Math.abs(subtotal - lineGross) > EPS) {
      out.push(
        issue({
          ...base,
          issueCode: 'SUBTOTAL_MISMATCH',
          expectedValue: String(lineGross),
          actualValue: String(subtotal),
          difference: String(round2(subtotal - lineGross)),
          severity: 'critical',
          explanationAr: 'المجموع الفرعي لا يطابق مجموع إجماليات أسطر الشراء',
        }),
      );
    }
    const total = Number(r.total_amount);
    const discount = Number(r.discount_total);
    const tax = Number(r.tax_total);
    const expectedTotal = round2(subtotal - discount + tax);
    if (Math.abs(total - expectedTotal) > EPS) {
      out.push(
        issue({
          ...base,
          issueCode: 'TOTAL_FORMULA_MISMATCH',
          expectedValue: String(expectedTotal),
          actualValue: String(total),
          difference: String(round2(total - expectedTotal)),
          severity: 'critical',
          explanationAr: 'إجمالي فاتورة الشراء لا يطابق (المجموع − الخصم + الضريبة)',
        }),
      );
    }
    const paid = Number(r.paid_amount);
    const remaining = Number(r.remaining_amount);
    if (Math.abs(paid + remaining - total) > EPS) {
      out.push(
        issue({
          ...base,
          issueCode: 'PAID_REMAINING_MISMATCH',
          expectedValue: String(total),
          actualValue: String(round2(paid + remaining)),
          difference: String(round2(paid + remaining - total)),
          severity: 'critical',
          explanationAr: 'المسدد + المتبقي لا يطابق إجمالي فاتورة الشراء',
        }),
      );
    }
    if (remaining < -EPS) {
      out.push(
        issue({
          ...base,
          issueCode: 'NEGATIVE_REMAINING',
          expectedValue: '>= 0',
          actualValue: String(remaining),
          difference: String(remaining),
          severity: 'critical',
          explanationAr: 'المتبقي سالب على فاتورة الشراء',
        }),
      );
    }
    if (r.document_status === 'CONFIRMED' && Number(r.line_count) === 0) {
      out.push(
        issue({
          ...base,
          issueCode: 'CONFIRMED_NO_LINES',
          expectedValue: '> 0',
          actualValue: '0',
          difference: null,
          severity: 'critical',
          explanationAr: 'فاتورة شراء مؤكدة بدون أسطر',
        }),
      );
    }
    if (r.currency_code !== 'USD' && Number(r.exchange_rate_to_usd) <= 0) {
      out.push(
        issue({
          ...base,
          issueCode: 'INVALID_EXCHANGE_RATE',
          expectedValue: '> 0',
          actualValue: r.exchange_rate_to_usd,
          difference: null,
          severity: 'warning',
          explanationAr: 'سعر صرف غير صالح لفاتورة شراء بعملة أجنبية',
        }),
      );
    }
  }
  return out;
}

async function auditDuplicateGl(companyId: string): Promise<AuditIssue[]> {
  const pool = getPool();
  const dup = await pool.query<{
    source_type: string;
    source_id: string;
    cnt: string;
  }>(
    `SELECT source_type, source_id, COUNT(*)::int AS cnt
     FROM journal_entries
     WHERE company_id = $1
       AND source_id IS NOT NULL
       AND source_type IN (
         'VOUCHER', 'RETURN_INVOICE', 'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT',
         'SALES_INVOICE', 'PURCHASE_INVOICE'
       )
     GROUP BY source_type, source_id
     HAVING COUNT(*) > 1`,
    [companyId],
  );
  return dup.rows.map((r) =>
    issue({
      invoiceType: 'SYSTEM',
      invoiceId: r.source_id,
      invoiceNumber: r.source_type,
      status: 'POSTED',
      issueCode: 'DUPLICATE_GL_SOURCE',
      expectedValue: '1',
      actualValue: r.cnt,
      difference: String(Number(r.cnt) - 1),
      severity: 'critical',
      explanationAr: `قيود محاسبية مكررة لنفس المصدر (${r.source_type})`,
    }),
  );
}

async function auditDuplicateCashbox(companyId: string): Promise<AuditIssue[]> {
  const pool = getPool();
  const dup = await pool.query<{
    source_type: string;
    source_id: string;
    movement_type: string;
    cnt: string;
  }>(
    `SELECT source_type, source_id, movement_type, COUNT(*)::int AS cnt
     FROM cashbox_movements
     WHERE company_id = $1
       AND source_id IS NOT NULL
       AND source_type IN ('RETURN_INVOICE', 'VOUCHER')
       AND movement_type IN ('PAYMENT', 'RECEIPT')
     GROUP BY source_type, source_id, movement_type
     HAVING COUNT(*) > 1`,
    [companyId],
  );
  return dup.rows.map((r) =>
    issue({
      invoiceType: 'SYSTEM',
      invoiceId: r.source_id,
      invoiceNumber: `${r.source_type}/${r.movement_type}`,
      status: 'POSTED',
      issueCode: 'DUPLICATE_CASHBOX_SOURCE',
      expectedValue: '1',
      actualValue: r.cnt,
      difference: String(Number(r.cnt) - 1),
      severity: 'critical',
      explanationAr: 'حركة صندوق مكررة لنفس المستند',
    }),
  );
}

async function auditReturnsWithoutGl(companyId: string): Promise<AuditIssue[]> {
  const pool = getPool();
  const rows = await pool.query<{
    id: string;
    return_no: string;
    status: string;
    settlement_type: string | null;
  }>(
    `SELECT ri.id, ri.return_no, ri.status, ri.settlement_type
     FROM return_invoices ri
     WHERE ri.company_id = $1
       AND ri.status = 'CONFIRMED'
       AND COALESCE(ri.settlement_type, '') <> 'NO_FINANCIAL_EFFECT'
       AND NOT EXISTS (
         SELECT 1 FROM journal_entries je
         WHERE je.company_id = ri.company_id
           AND je.source_type = 'RETURN_INVOICE'
           AND je.source_id = ri.id
       )`,
    [companyId],
  );
  return rows.rows.map((r) =>
    issue({
      invoiceType: 'SYSTEM',
      invoiceId: r.id,
      invoiceNumber: r.return_no,
      status: r.status,
      issueCode: 'RETURN_WITHOUT_GL',
      expectedValue: 'GL posting',
      actualValue: 'none',
      difference: null,
      severity: 'critical',
      explanationAr: 'مرتجع مؤكد بدون قيد محاسبي مطابق',
    }),
  );
}

async function auditCashRefundWithoutCashbox(companyId: string): Promise<AuditIssue[]> {
  const pool = getPool();
  const rows = await pool.query<{ id: string; return_no: string; status: string }>(
    `SELECT ri.id, ri.return_no, ri.status
     FROM return_invoices ri
     WHERE ri.company_id = $1
       AND ri.status = 'CONFIRMED'
       AND ri.settlement_type = 'CASH_REFUND'
       AND COALESCE(ri.total_amount, 0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM cashbox_movements cm
         WHERE cm.company_id = ri.company_id
           AND cm.source_type = 'RETURN_INVOICE'
           AND cm.source_id = ri.id
           AND cm.movement_type IN ('PAYMENT', 'RECEIPT')
       )`,
    [companyId],
  );
  return rows.rows.map((r) =>
    issue({
      invoiceType: 'SYSTEM',
      invoiceId: r.id,
      invoiceNumber: r.return_no,
      status: r.status,
      issueCode: 'CASH_REFUND_WITHOUT_CASHBOX',
      expectedValue: 'cashbox movement',
      actualValue: 'none',
      difference: null,
      severity: 'critical',
      explanationAr: 'مرتجع نقدي مؤكد بدون حركة صندوق',
    }),
  );
}

async function auditCancelledCashRefundUnreversed(companyId: string): Promise<AuditIssue[]> {
  const pool = getPool();
  const rows = await pool.query<{ id: string; return_no: string; status: string }>(
    `SELECT ri.id, ri.return_no, ri.status
     FROM return_invoices ri
     WHERE ri.company_id = $1
       AND ri.status = 'CANCELLED'
       AND ri.settlement_type = 'CASH_REFUND'
       AND EXISTS (
         SELECT 1 FROM cashbox_movements cm
         WHERE cm.company_id = ri.company_id
           AND cm.source_type = 'RETURN_INVOICE'
           AND cm.source_id = ri.id
           AND cm.movement_type IN ('PAYMENT', 'RECEIPT')
       )
       AND NOT EXISTS (
         SELECT 1 FROM cashbox_movements cm2
         WHERE cm2.company_id = ri.company_id
           AND cm2.source_type = 'RETURN_INVOICE_REVERSAL'
           AND cm2.source_id = ri.id
       )`,
    [companyId],
  );
  return rows.rows.map((r) =>
    issue({
      invoiceType: 'SYSTEM',
      invoiceId: r.id,
      invoiceNumber: r.return_no,
      status: r.status,
      issueCode: 'CANCELLED_CASH_REFUND_UNREVERSED',
      expectedValue: 'reversal movement',
      actualValue: 'none',
      difference: null,
      severity: 'critical',
      explanationAr:
        'مرتجع نقدي ملغى مع حركة صندوق أصلية دون حركة عكسية — لا يمكن إلغاء مرتجع نقدي مؤكد لأنه يحتوي على حركة صندوق دون عكس',
    }),
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function runFinancialAudit(companyId: string): Promise<FinancialAuditReport> {
  const [sales, purchase, dupGl, dupCash, noGl, noCashbox, unreversed] = await Promise.all([
    auditSalesInvoices(companyId),
    auditPurchaseInvoices(companyId),
    auditDuplicateGl(companyId),
    auditDuplicateCashbox(companyId),
    auditReturnsWithoutGl(companyId),
    auditCashRefundWithoutCashbox(companyId),
    auditCancelledCashRefundUnreversed(companyId),
  ]);

  const invoiceConsistency = [...sales, ...purchase];
  const all = [
    ...invoiceConsistency,
    ...dupGl,
    ...dupCash,
    ...noGl,
    ...noCashbox,
    ...unreversed,
  ];

  return {
    generatedAt: new Date().toISOString(),
    companyId,
    invoiceConsistency,
    duplicateGlSources: dupGl,
    duplicateCashboxSources: dupCash,
    confirmedReturnsWithoutGl: noGl,
    confirmedCashRefundWithoutCashbox: noCashbox,
    cancelledCashRefundUnreversedCashbox: unreversed,
    summary: {
      totalIssues: all.length,
      critical: all.filter((i) => i.severity === 'critical').length,
      warning: all.filter((i) => i.severity === 'warning').length,
    },
  };
}
