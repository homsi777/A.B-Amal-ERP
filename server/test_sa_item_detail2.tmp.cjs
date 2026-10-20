const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://erp_user:700210ww@127.0.0.1:5433/fabric_erp?sslmode=disable' });

const SQL_NET_LINE_REVENUE_USD = `
  ROUND(
    CASE
      WHEN COALESCE(sil.line_discount, 0) > 0 OR COALESCE(sil.line_discount_usd, 0) > 0
        THEN COALESCE(
          sil.line_total_usd,
          CASE WHEN si.currency_code = 'USD' THEN sil.line_total ELSE sil.line_total / NULLIF(si.exchange_rate_to_usd, 0) END,
          0
        )
      WHEN si.discount_total > 0 AND si.subtotal > 0
        THEN COALESCE(
          sil.line_total_usd,
          CASE WHEN si.currency_code = 'USD' THEN sil.line_total ELSE sil.line_total / NULLIF(si.exchange_rate_to_usd, 0) END,
          0
        ) * (si.total_amount / NULLIF(si.subtotal, 0))
      ELSE COALESCE(
        sil.line_total_usd,
        CASE WHEN si.currency_code = 'USD' THEN sil.line_total ELSE sil.line_total / NULLIF(si.exchange_rate_to_usd, 0) END,
        0
      )
    END,
    4
  )::numeric`;

(async () => {
  const companyId = '03ea67f6-7ea8-4f39-90d4-645391d2d4ea';
  const params = [companyId, 'CONFIRMED', '%CLO-1%', '%CLO-1%'];
  const where = `si.company_id = $1 AND si.document_status = $2 AND fi.internal_code ILIKE $3 OR fi.name ILIKE $4`;
  // careful with precedence; wrap properly like real code does per-clause AND-joined
  const filters = [
    `si.company_id = $1`,
    `si.document_status = $2`,
    `(fi.internal_code ILIKE $3 OR fi.name ILIKE $4)`,
  ];
  const whereClause = filters.join(' AND ');

  const detailBaseSql = `
    WITH return_agg AS (
      SELECT ril.original_sales_invoice_line_id AS line_id,
             SUM(CASE WHEN ril.unit = 'yard' THEN ril.quantity * 0.9144 ELSE ril.quantity END)::numeric AS returned_meters,
             STRING_AGG(DISTINCT ri.return_no, ', ' ORDER BY ri.return_no) AS return_nos,
             STRING_AGG(DISTINCT ri.return_date::text, ', ' ORDER BY ri.return_date::text) AS return_dates
      FROM return_invoice_lines ril
      INNER JOIN return_invoices ri ON ri.id = ril.return_invoice_id AND ri.company_id = ril.company_id
      WHERE ril.company_id = $1
        AND ri.return_type = 'SALES_RETURN'
        AND ri.status = 'CONFIRMED'
        AND ril.original_sales_invoice_line_id IS NOT NULL
      GROUP BY ril.original_sales_invoice_line_id
    ),
    detail_lines AS (
      SELECT
        si.invoice_no,
        si.invoice_date::text AS sale_date,
        si.invoice_date AS sort_date,
        sil.line_no AS sort_line,
        c.name AS customer_name,
        COALESCE(NULLIF(fi.name, ''), 'بدون خامة') AS material_name,
        COALESCE(fi.internal_code, '') AS material_code,
        (CASE WHEN sil.unit = 'yard' THEN sil.quantity * 0.9144 ELSE sil.quantity END)::numeric AS quantity_meters_num,
        ${SQL_NET_LINE_REVENUE_USD} AS net_sales_usd,
        COALESCE(ra.returned_meters, 0)::numeric AS returned_meters_num,
        ra.return_dates,
        ra.return_nos
      FROM sales_invoice_lines sil
      INNER JOIN sales_invoices si ON si.id = sil.invoice_id AND si.company_id = sil.company_id
      INNER JOIN customers c ON c.id = si.customer_id AND c.company_id = si.company_id
      LEFT JOIN fabric_rolls fr ON fr.id = sil.fabric_roll_id AND fr.company_id = sil.company_id
      LEFT JOIN fabric_items fi ON fi.id = COALESCE(sil.fabric_item_id, fr.item_id) AND fi.company_id = sil.company_id
      LEFT JOIN fabric_item_variants fv ON fv.id = sil.variant_id AND fv.company_id = sil.company_id
      LEFT JOIN return_agg ra ON ra.line_id = sil.id
      WHERE ${whereClause}
    )
  `;

  const data = await pool.query(
    `${detailBaseSql}
     SELECT
       invoice_no, sale_date, customer_name, material_name, material_code,
       ROUND(quantity_meters_num, 2)::text AS quantity_meters,
       ROUND(net_sales_usd, 2)::text AS net_sales_amount,
       ROUND(returned_meters_num, 2)::text AS returned_meters,
       COALESCE(return_dates, '—') AS return_date,
       COALESCE(return_nos, '—') AS return_no,
       ROUND(quantity_meters_num - returned_meters_num, 2)::text AS net_meters,
       CASE
         WHEN returned_meters_num <= 0.0001 THEN 'مباع'
         WHEN returned_meters_num >= quantity_meters_num - 0.0001 THEN 'مرتجع كلياً'
         ELSE 'مرتجع جزئياً'
       END AS line_status
     FROM detail_lines
     ORDER BY sort_date DESC, sort_line DESC
     LIMIT 50`,
    params,
  );
  console.log(JSON.stringify(data.rows, null, 2));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
