/** SQL fragments to resolve party (اسم الجهة) for cashbox_movements list queries. */

export const CASHBOX_MOVEMENT_PARTY_JOINS = `
  LEFT JOIN vouchers v
    ON v.id = m.source_id AND v.company_id = m.company_id
   AND m.source_type = 'VOUCHER'
  LEFT JOIN vouchers vc
    ON vc.id = m.source_id AND vc.company_id = m.company_id
   AND m.source_type = 'VOUCHER_CANCEL'
  LEFT JOIN return_invoices ri
    ON ri.id = m.source_id AND ri.company_id = m.company_id
   AND m.source_type IN ('RETURN_INVOICE', 'RETURN_INVOICE_REVERSAL')
  LEFT JOIN customers cust ON cust.id = ri.customer_id AND cust.company_id = ri.company_id
  LEFT JOIN suppliers sup ON sup.id = ri.supplier_id AND sup.company_id = ri.company_id
  LEFT JOIN operating_expenses oe
    ON oe.id = m.source_id AND oe.company_id = m.company_id
   AND m.source_type IN ('OPERATING_EXPENSE', 'OPERATING_EXPENSE_REVERSAL')
  LEFT JOIN payroll_runs pr
    ON pr.id = m.source_id AND pr.company_id = m.company_id
   AND m.source_type = 'PAYROLL_RUN'
  LEFT JOIN LATERAL (
    SELECT
      string_agg(DISTINCT e.full_name, '، ' ORDER BY e.full_name) AS names,
      COUNT(DISTINCT e.id)::int AS cnt
    FROM payroll_run_lines l
    JOIN payroll_employees e ON e.id = l.employee_id AND e.company_id = l.company_id
    WHERE l.payroll_run_id = pr.id AND l.company_id = m.company_id
  ) pr_line ON pr.id IS NOT NULL
  LEFT JOIN cashbox_transfers ct
    ON ct.id = m.source_id AND ct.company_id = m.company_id
   AND m.source_type IN ('CASHBOX_TRANSFER', 'CASHBOX_TRANSFER_VOID')
  LEFT JOIN cashboxes cb_from ON cb_from.id = ct.from_cashbox_id AND cb_from.company_id = ct.company_id
  LEFT JOIN cashboxes cb_to ON cb_to.id = ct.to_cashbox_id AND cb_to.company_id = ct.company_id
`;

export const CASHBOX_MOVEMENT_PARTY_SELECT = `
  COALESCE(
    NULLIF(trim(v.party_name), ''),
    NULLIF(trim(vc.party_name), ''),
    CASE
      WHEN ri.return_type = 'SALES_RETURN' THEN NULLIF(trim(cust.name), '')
      WHEN ri.return_type = 'PURCHASE_RETURN' THEN NULLIF(trim(sup.name), '')
    END,
    NULLIF(trim(oe.beneficiary_name), ''),
    CASE
      WHEN pr_line.cnt = 1 THEN pr_line.names
      WHEN pr_line.cnt > 1 THEN 'مسير رواتب (' || pr_line.cnt::text || ' موظف)'
    END,
    CASE
      WHEN ct.id IS NOT NULL AND m.direction = 'OUT' THEN 'مناقلة → ' || cb_to.name
      WHEN ct.id IS NOT NULL AND m.direction = 'IN' THEN 'مناقلة ← ' || cb_from.name
    END
  ) AS party_name,
  COALESCE(
    v.party_type,
    vc.party_type,
    CASE
      WHEN ri.return_type = 'SALES_RETURN' THEN 'CUSTOMER'
      WHEN ri.return_type = 'PURCHASE_RETURN' THEN 'SUPPLIER'
    END,
    CASE WHEN oe.id IS NOT NULL THEN 'OTHER' END,
    CASE WHEN pr.id IS NOT NULL THEN 'EMPLOYEE' END,
    CASE WHEN ct.id IS NOT NULL THEN 'OTHER' END
  ) AS party_type
`;
