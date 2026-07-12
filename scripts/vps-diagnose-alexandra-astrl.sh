#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

psql "$DATABASE_URL" <<'SQL'
\echo '=== fabric_items ALEXANDRA / ASTRLI ==='
SELECT fi.id, fi.name, fi.internal_code, fi.supplier_code, fi.updated_at::date,
  COUNT(*) FILTER (WHERE fr.status IN ('AVAILABLE','RESERVED')) AS active,
  COUNT(*) FILTER (WHERE fr.status = 'INACTIVE') AS inactive,
  COUNT(*) AS total_rolls
FROM fabric_items fi
LEFT JOIN fabric_rolls fr ON fr.item_id = fi.id
WHERE lower(fi.name) LIKE '%alexandra%' OR lower(fi.name) LIKE '%astrl%'
GROUP BY fi.id, fi.name, fi.internal_code, fi.supplier_code, fi.updated_at
ORDER BY fi.name, fi.internal_code;

\echo '=== Active rolls: item code shown in inventory ==='
SELECT fi.name, fi.internal_code, fi.supplier_code, fr.barcode, fr.status, fr.import_batch_id
FROM fabric_rolls fr
JOIN fabric_items fi ON fi.id = fr.item_id
WHERE (lower(fi.name) LIKE '%alexandra%' OR lower(fi.name) LIKE '%astrl%')
  AND fr.status IN ('AVAILABLE','RESERVED')
ORDER BY fi.name, fi.internal_code
LIMIT 30;

\echo '=== Excel desen codes from import rows for these materials ==='
SELECT pir.normalized_data->>'materialName' AS mat,
       pir.normalized_data->>'supplierMaterialCode' AS desen,
       pir.normalized_data->>'internalMaterialCode' AS variant,
       COUNT(*) AS rows,
       COUNT(DISTINCT pir.matched_item_id) AS items
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE b.file_name = 'AHMET BARAKAT SURYA 1.xls'
  AND b.status = 'CONFIRMED'
  AND (
    pir.normalized_data->>'materialName' ILIKE '%ALEXANDRA%'
    OR pir.normalized_data->>'materialName' ILIKE '%ASTRLI%'
  )
GROUP BY 1,2,3
ORDER BY mat, desen;

\echo '=== matched_item_id vs excel desen (mismatch) ==='
SELECT fi.name, fi.internal_code, fi.supplier_code,
       pir.normalized_data->>'supplierMaterialCode' AS excel_desen,
       COUNT(*) AS cnt
FROM purchase_import_rows pir
JOIN fabric_items fi ON fi.id = pir.matched_item_id
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE b.file_name = 'AHMET BARAKAT SURYA 1.xls' AND b.status = 'CONFIRMED'
  AND (
    pir.normalized_data->>'materialName' ILIKE '%ALEXANDRA%'
    OR pir.normalized_data->>'materialName' ILIKE '%ASTRLI%'
  )
  AND pir.normalized_data->>'supplierMaterialCode' IS NOT NULL
  AND lower(trim(fi.internal_code)) <> lower(trim(pir.normalized_data->>'supplierMaterialCode'))
  AND lower(trim(coalesce(fi.supplier_code,''))) <> lower(trim(pir.normalized_data->>'supplierMaterialCode'))
GROUP BY 1,2,3,4
ORDER BY cnt DESC;
SQL
