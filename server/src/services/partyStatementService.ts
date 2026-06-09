import { getPool } from '../db/pool.js';

type PartyKind = 'CUSTOMER' | 'SUPPLIER';

export type PartyStatementFilters = {
  fromDate?: string;
  toDate?: string;
  currency?: string;
};

type StatementSourceRow = {
  row_date: string;
  created_at: string;
  type: string;
  type_label: string;
  document_no: string;
  description: string;
  debit: string;
  credit: string;
  debit_usd: string;
  credit_usd: string;
  currency_code: string;
  source_type: string;
  source_id: string;
  status: string;
  notes: string | null;
};

function toIsoDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

async function loadCustomer(companyId: string, customerId: string) {
  const row = await getPool().query(
    `SELECT id, code, name, phone, email, address, notes, telegram_chat_id, telegram_enabled, telegram_label
     FROM customers WHERE id=$1 AND company_id=$2`,
    [customerId, companyId],
  );
  return row.rows[0] ?? null;
}

async function loadSupplier(companyId: string, supplierId: string) {
  const row = await getPool().query(
    `SELECT id, code, name, phone, email, address, country, notes, telegram_chat_id, telegram_enabled, telegram_label
     FROM suppliers WHERE id=$1 AND company_id=$2`,
    [supplierId, companyId],
  );
  return row.rows[0] ?? null;
}

function customerRowsQuery(period: 'opening' | 'period', filters: PartyStatementFilters) {
  const params: unknown[] = [];
  const p = { value: 1 };
  const dateCondition = (alias: string, col: string) => {
    const conditions: string[] = [];
    if (period === 'opening' && filters.fromDate) {
      conditions.push(`${alias}.${col} < $${p.value}::date`);
      params.push(filters.fromDate);
      p.value++;
    } else if (period === 'period') {
      if (filters.fromDate) {
        conditions.push(`${alias}.${col} >= $${p.value}::date`);
        params.push(filters.fromDate);
        p.value++;
      }
      if (filters.toDate) {
        conditions.push(`${alias}.${col} <= $${p.value}::date`);
        params.push(filters.toDate);
        p.value++;
      }
    }
    if (filters.currency) {
      conditions.push(`${alias}.currency_code = $${p.value}`);
      params.push(filters.currency);
      p.value++;
    }
    return conditions.length ? ` AND ${conditions.join(' AND ')}` : '';
  };

  const sql = `
    SELECT si.invoice_date AS row_date, si.created_at, 'SALES_INVOICE' AS type, 'فاتورة بيع' AS type_label,
           si.invoice_no AS document_no, 'فاتورة بيع مؤكدة' AS description,
           si.total_amount AS debit, 0::numeric AS credit, si.currency_code,
           COALESCE(si.total_amount_usd, CASE WHEN si.currency_code='USD' THEN si.total_amount ELSE si.total_amount / NULLIF(si.exchange_rate_to_usd, 0) END) AS debit_usd,
           0::numeric AS credit_usd,
           'SALES_INVOICE' AS source_type, si.id AS source_id, si.document_status AS status, si.notes
    FROM sales_invoices si
    WHERE si.company_id=$${p.value++} AND si.customer_id=$${p.value++} AND si.document_status='CONFIRMED'
    ${dateCondition('si', 'invoice_date')}

    UNION ALL
    SELECT v.voucher_date AS row_date, v.created_at, 'RECEIPT_VOUCHER' AS type, 'سند قبض' AS type_label,
           v.voucher_no AS document_no, COALESCE(v.description, 'سند قبض مؤكد') AS description,
           0::numeric AS debit, v.amount AS credit, v.currency_code,
           0::numeric AS debit_usd,
           COALESCE(v.amount_usd, CASE WHEN v.currency_code='USD' THEN v.amount ELSE v.amount / NULLIF(v.exchange_rate_to_usd, 0) END) AS credit_usd,
           'VOUCHER' AS source_type, v.id AS source_id, v.status, v.notes
    FROM vouchers v
    WHERE v.company_id=$1 AND v.party_id=$2 AND v.party_type='CUSTOMER' AND v.voucher_type='RECEIPT' AND v.status='CONFIRMED'
    ${dateCondition('v', 'voucher_date')}

    UNION ALL
    SELECT v.voucher_date AS row_date, v.created_at, 'PAYMENT_VOUCHER' AS type, 'سند دفع للعميل' AS type_label,
           v.voucher_no AS document_no, COALESCE(v.description, 'سند دفع مؤكد') AS description,
           v.amount AS debit, 0::numeric AS credit, v.currency_code,
           COALESCE(v.amount_usd, CASE WHEN v.currency_code='USD' THEN v.amount ELSE v.amount / NULLIF(v.exchange_rate_to_usd, 0) END) AS debit_usd,
           0::numeric AS credit_usd,
           'VOUCHER' AS source_type, v.id AS source_id, v.status, v.notes
    FROM vouchers v
    WHERE v.company_id=$1 AND v.party_id=$2 AND v.party_type='CUSTOMER' AND v.voucher_type='PAYMENT' AND v.status='CONFIRMED'
    ${dateCondition('v', 'voucher_date')}

    UNION ALL
    SELECT r.return_date AS row_date, r.created_at, 'SALES_RETURN' AS type, 'مرتجع بيع' AS type_label,
           r.return_no AS document_no, 'مرتجع بيع مؤكد' AS description,
           0::numeric AS debit, r.total_amount AS credit, r.currency_code,
           0::numeric AS debit_usd,
           COALESCE(r.total_amount_usd, CASE WHEN r.currency_code='USD' THEN r.total_amount ELSE r.total_amount / NULLIF(r.exchange_rate_to_usd, 0) END) AS credit_usd,
           'RETURN_INVOICE' AS source_type, r.id AS source_id, r.status, r.notes
    FROM return_invoices r
    WHERE r.company_id=$1 AND r.customer_id=$2 AND r.return_type='SALES_RETURN' AND r.status='CONFIRMED'
      AND COALESCE(r.settlement_type, 'CREDIT_BALANCE') <> 'NO_FINANCIAL_EFFECT'
    ${dateCondition('r', 'return_date')}

    UNION ALL
    SELECT je.entry_date AS row_date, je.created_at, 'CUSTOMER_JOURNAL' AS type, 'قيد مالي' AS type_label,
           je.entry_no AS document_no, COALESCE(jl.description, je.description, 'قيد مالي على ذمة العميل') AS description,
           jl.debit AS debit, jl.credit AS credit, jl.currency_code,
           jl.debit AS debit_usd, jl.credit AS credit_usd,
           je.source_type AS source_type, je.id AS source_id, je.status, je.description AS notes
    FROM journal_lines jl
    INNER JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
    WHERE jl.company_id=$1 AND jl.party_id=$2 AND jl.party_type='CUSTOMER'
      AND je.status='POSTED' AND je.source_type IN ('MANUAL', 'OPENING', 'SYSTEM')
    ${dateCondition('je', 'entry_date')}
  `;
  params.splice(0, 0);
  return { sql, params };
}

function supplierRowsQuery(period: 'opening' | 'period', filters: PartyStatementFilters) {
  const params: unknown[] = [];
  const p = { value: 1 };
  const dateCondition = (alias: string, col: string) => {
    const conditions: string[] = [];
    if (period === 'opening' && filters.fromDate) {
      conditions.push(`${alias}.${col} < $${p.value}::date`);
      params.push(filters.fromDate);
      p.value++;
    } else if (period === 'period') {
      if (filters.fromDate) {
        conditions.push(`${alias}.${col} >= $${p.value}::date`);
        params.push(filters.fromDate);
        p.value++;
      }
      if (filters.toDate) {
        conditions.push(`${alias}.${col} <= $${p.value}::date`);
        params.push(filters.toDate);
        p.value++;
      }
    }
    if (filters.currency) {
      conditions.push(`${alias}.currency_code = $${p.value}`);
      params.push(filters.currency);
      p.value++;
    }
    return conditions.length ? ` AND ${conditions.join(' AND ')}` : '';
  };

  const sql = `
    SELECT pi.invoice_date AS row_date, pi.created_at, 'PURCHASE_INVOICE' AS type, 'فاتورة شراء' AS type_label,
           pi.invoice_no AS document_no, 'فاتورة شراء مؤكدة' AS description,
           0::numeric AS debit, pi.total_amount AS credit, pi.currency_code,
           0::numeric AS debit_usd,
           COALESCE(pi.total_amount_usd, CASE WHEN pi.currency_code='USD' THEN pi.total_amount ELSE pi.total_amount / NULLIF(pi.exchange_rate_to_usd, 0) END) AS credit_usd,
           'PURCHASE_INVOICE' AS source_type, pi.id AS source_id, pi.document_status AS status, pi.notes
    FROM purchase_invoices pi
    WHERE pi.company_id=$${p.value++} AND pi.supplier_id=$${p.value++} AND pi.document_status='CONFIRMED'
    ${dateCondition('pi', 'invoice_date')}

    UNION ALL
    SELECT v.voucher_date AS row_date, v.created_at, 'PAYMENT_VOUCHER' AS type, 'سند دفع' AS type_label,
           v.voucher_no AS document_no, COALESCE(v.description, 'سند دفع مؤكد') AS description,
           v.amount AS debit, 0::numeric AS credit, v.currency_code,
           COALESCE(v.amount_usd, CASE WHEN v.currency_code='USD' THEN v.amount ELSE v.amount / NULLIF(v.exchange_rate_to_usd, 0) END) AS debit_usd,
           0::numeric AS credit_usd,
           'VOUCHER' AS source_type, v.id AS source_id, v.status, v.notes
    FROM vouchers v
    WHERE v.company_id=$1 AND v.party_id=$2 AND v.party_type='SUPPLIER' AND v.voucher_type='PAYMENT' AND v.status='CONFIRMED'
    ${dateCondition('v', 'voucher_date')}

    UNION ALL
    SELECT v.voucher_date AS row_date, v.created_at, 'RECEIPT_VOUCHER' AS type, 'سند قبض من المورد' AS type_label,
           v.voucher_no AS document_no, COALESCE(v.description, 'سند قبض مؤكد') AS description,
           0::numeric AS debit, v.amount AS credit, v.currency_code,
           0::numeric AS debit_usd,
           COALESCE(v.amount_usd, CASE WHEN v.currency_code='USD' THEN v.amount ELSE v.amount / NULLIF(v.exchange_rate_to_usd, 0) END) AS credit_usd,
           'VOUCHER' AS source_type, v.id AS source_id, v.status, v.notes
    FROM vouchers v
    WHERE v.company_id=$1 AND v.party_id=$2 AND v.party_type='SUPPLIER' AND v.voucher_type='RECEIPT' AND v.status='CONFIRMED'
    ${dateCondition('v', 'voucher_date')}

    UNION ALL
    SELECT r.return_date AS row_date, r.created_at, 'PURCHASE_RETURN' AS type, 'مرتجع شراء' AS type_label,
           r.return_no AS document_no, 'مرتجع شراء مؤكد' AS description,
           r.total_amount AS debit, 0::numeric AS credit, r.currency_code,
           COALESCE(r.total_amount_usd, CASE WHEN r.currency_code='USD' THEN r.total_amount ELSE r.total_amount / NULLIF(r.exchange_rate_to_usd, 0) END) AS debit_usd,
           0::numeric AS credit_usd,
           'RETURN_INVOICE' AS source_type, r.id AS source_id, r.status, r.notes
    FROM return_invoices r
    WHERE r.company_id=$1 AND r.supplier_id=$2 AND r.return_type='PURCHASE_RETURN' AND r.status='CONFIRMED'
      AND COALESCE(r.settlement_type, 'CREDIT_BALANCE') <> 'NO_FINANCIAL_EFFECT'
    ${dateCondition('r', 'return_date')}
  `;
  return { sql, params };
}

async function buildStatement(kind: PartyKind, companyId: string, partyId: string, filters: PartyStatementFilters) {
  const party = kind === 'CUSTOMER' ? await loadCustomer(companyId, partyId) : await loadSupplier(companyId, partyId);
  if (!party) throw Object.assign(new Error(kind === 'CUSTOMER' ? 'العميل غير موجود' : 'المورد غير موجود'), { code: 'NOT_FOUND' });

  const queryBuilder = kind === 'CUSTOMER' ? customerRowsQuery : supplierRowsQuery;
  const openingQuery = filters.fromDate ? queryBuilder('opening', filters) : null;
  const periodQuery = queryBuilder('period', filters);
  const pool = getPool();

  const openingRows = openingQuery
    ? (
        await pool.query<StatementSourceRow>(
          `SELECT * FROM (${openingQuery.sql}) src ORDER BY row_date ASC, created_at ASC, document_no ASC`,
          [companyId, partyId, ...openingQuery.params],
        )
      ).rows
    : [];
  const periodRows = (
    await pool.query<StatementSourceRow>(
      `SELECT * FROM (${periodQuery.sql}) src ORDER BY row_date ASC, created_at ASC, document_no ASC`,
      [companyId, partyId, ...periodQuery.params],
    )
  ).rows;

  const applyBalance = (balance: number, debit: number, credit: number) =>
    kind === 'CUSTOMER' ? balance + debit - credit : balance + credit - debit;

  let openingBalance = 0;
  openingRows.forEach((row) => {
    openingBalance = applyBalance(openingBalance, Number(row.debit_usd), Number(row.credit_usd));
  });

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows = periodRows.map((row) => {
    const debitOriginal = Number(row.debit);
    const creditOriginal = Number(row.credit);
    const debit = Number(row.debit_usd);
    const credit = Number(row.credit_usd);
    totalDebit += debit;
    totalCredit += credit;
    running = applyBalance(running, debit, credit);
    return {
      date: toIsoDate(row.row_date),
      type: row.type,
      typeLabel: row.type_label,
      documentNo: row.document_no,
      description: row.description,
      debit,
      credit,
      balance: running,
      debitOriginal,
      creditOriginal,
      currency: row.currency_code,
      sourceType: row.source_type,
      sourceId: row.source_id,
      status: row.status,
      notes: row.notes,
    };
  });

  return {
    [kind === 'CUSTOMER' ? 'customer' : 'supplier']: party,
    period: {
      from: filters.fromDate || null,
      to: filters.toDate || null,
    },
    openingBalance,
    rows,
    totals: {
      debit: totalDebit,
      credit: totalCredit,
      closingBalance: running,
    },
  };
}

export async function getCustomerStatement(companyId: string, customerId: string, filters: PartyStatementFilters) {
  return buildStatement('CUSTOMER', companyId, customerId, filters);
}

export async function getSupplierStatement(companyId: string, supplierId: string, filters: PartyStatementFilters) {
  return buildStatement('SUPPLIER', companyId, supplierId, filters);
}
