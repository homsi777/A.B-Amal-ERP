#!/bin/bash
# Pre-import collision analysis: SURYA file vs current DB
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

psql "$DATABASE_URL" <<'SQL'
\echo '=== SURYA materials vs DB items (code-only match — THE RISK) ==='
WITH surya AS (
  SELECT DISTINCT
    pir.normalized_data->>'materialName' AS surya_name,
    coalesce(nullif(pir.normalized_data->>'supplierMaterialCode',''),
             nullif(pir.normalized_data->>'materialCode','')) AS surya_code
  FROM purchase_import_rows pir
  JOIN purchase_import_batches b ON b.id = pir.batch_id
  WHERE b.file_name = 'AHMET BARAKAT SURYA 1.xls' AND b.status = 'CANCELLED'
    AND coalesce(pir.normalized_data->>'supplierMaterialCode','') <> ''
)
SELECT s.surya_name, s.surya_code,
       fi.name AS db_item_name, fi.internal_code, fi.supplier_code,
       (SELECT count(*) FROM fabric_rolls r WHERE r.item_id=fi.id AND r.status IN ('AVAILABLE','RESERVED')) AS live_rolls,
       (SELECT count(*) FROM fabric_rolls r
        JOIN purchase_import_rows p2 ON p2.created_roll_id=r.id
        JOIN purchase_import_batches b2 ON b2.id=p2.batch_id
        WHERE r.item_id=fi.id AND b2.file_name ILIKE '%حلب%') AS aleppo_rolls
FROM surya s
JOIN fabric_items fi ON fi.is_active = true
  AND (
    lower(trim(fi.internal_code)) = lower(trim(s.surya_code))
    OR lower(trim(coalesce(fi.supplier_code,''))) = lower(trim(s.surya_code))
  )
WHERE lower(trim(fi.name)) <> lower(trim(s.surya_name))
ORDER BY live_rolls DESC, s.surya_name;

\echo '=== Barcodes in cancelled SURYA batch vs existing live rolls ==='
SELECT pir.normalized_data->>'barcode' AS surya_barcode,
       r.barcode AS existing_roll, r.status, fi.name
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
LEFT JOIN fabric_rolls r ON r.company_id = pir.company_id
  AND lower(trim(r.barcode)) = lower(trim(pir.normalized_data->>'barcode'))
LEFT JOIN fabric_items fi ON fi.id = r.item_id
WHERE b.file_name = 'AHMET BARAKAT SURYA 1.xls' AND b.status = 'CANCELLED'
  AND coalesce(pir.normalized_data->>'barcode','') <> ''
  AND r.id IS NOT NULL
LIMIT 20;

\echo '=== Is safe import code deployed? (grep key functions on server) ==='
SQL
grep -n "findFabricItemByImportDesignCode\|applyPurchaseImportMaterialCodes\|findOrCreateImportFabricItem" ~/ab-amal-erp/server/src/routes/purchaseImportRoutes.ts 2>/dev/null | head -8
grep -n "name = COALESCE" ~/ab-amal-erp/server/src/utils/purchaseImportMaterialCodes.ts 2>/dev/null | head -3
