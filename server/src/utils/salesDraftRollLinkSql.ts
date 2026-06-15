/**
 * يربط ثوب المخزون بفاتورة مبيعات مسودة عبر fabric_roll_id أو بيانات metadata (باركود/رقم ثوب).
 */
export const DRAFT_SALE_ROLL_MATCH_SQL = `
  (
    sil.fabric_roll_id = fr.id
    OR (
      sil.fabric_roll_id IS NULL
      AND (
        (
          NULLIF(trim(sil.metadata->>'internalRollId'), '') IS NOT NULL
          AND (sil.metadata->>'internalRollId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND (sil.metadata->>'internalRollId')::uuid = fr.id
        )
        OR (
          NULLIF(trim(sil.metadata->>'fabricRollId'), '') IS NOT NULL
          AND (sil.metadata->>'fabricRollId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND (sil.metadata->>'fabricRollId')::uuid = fr.id
        )
        OR (
          NULLIF(trim(fr.barcode), '') IS NOT NULL
          AND lower(trim(fr.barcode)) IN (
            lower(trim(coalesce(sil.metadata->>'barcode', ''))),
            lower(trim(coalesce(sil.metadata->>'supplierBarcode', ''))),
            lower(trim(coalesce(sil.metadata->>'printBarcode', '')))
          )
        )
        OR (
          NULLIF(trim(fr.roll_no), '') IS NOT NULL
          AND lower(trim(fr.roll_no)) = lower(trim(coalesce(sil.metadata->>'rollNo', sil.metadata->>'rollNumber', '')))
        )
        OR (
          NULLIF(trim(fr.supplier_roll_ref), '') IS NOT NULL
          AND lower(trim(fr.supplier_roll_ref)) IN (
            lower(trim(coalesce(sil.metadata->>'supplierBarcode', ''))),
            lower(trim(coalesce(sil.metadata->>'barcode', '')))
          )
        )
      )
    )
  )
`;

export const DRAFT_SALE_LATERAL_JOIN = `
  LEFT JOIN LATERAL (
    SELECT si.id AS draft_sales_invoice_id,
           si.invoice_no AS draft_sales_invoice_no
    FROM sales_invoice_lines sil
    INNER JOIN sales_invoices si
      ON si.id = sil.invoice_id AND si.company_id = sil.company_id
    WHERE sil.company_id = fr.company_id
      AND si.document_status = 'DRAFT'
      AND ${DRAFT_SALE_ROLL_MATCH_SQL}
    ORDER BY si.updated_at DESC NULLS LAST, si.created_at DESC
    LIMIT 1
  ) draft_sale ON true
`;
