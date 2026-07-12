#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

BARCODES="3288696,3288697,3288698,3288700,3288701,3288702,3288704,3288705,3288706,3288708"

echo "=== Screenshot barcodes — IN EXCEL/IMPORT FILE (all SURYA batches) ==="
psql "$DATABASE_URL" -c "
SELECT b.file_name, b.status, b.confirmed_at::date,
       pir.normalized_data->>'barcode' AS barcode,
       pir.normalized_data->>'materialName' AS excel_material,
       pir.normalized_data->>'supplierMaterialCode' AS excel_desen,
       pir.normalized_data->>'colorNameTr' AS excel_color,
       pir.normalized_data->>'lengthM' AS metres
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE pir.normalized_data->>'barcode' IN ('3288696','3288697','3288698','3288700','3288701','3288702','3288704','3288705','3288706','3288708')
ORDER BY pir.normalized_data->>'barcode', b.created_at DESC;"

echo ""
echo "=== Screenshot barcodes — CURRENT LIVE DB (after restore) ==="
psql "$DATABASE_URL" -c "
SELECT r.barcode, fi.name AS db_material, fi.internal_code AS db_code,
       fi.supplier_code, r.status, r.length_m,
       b.status AS import_batch_status, b.confirmed_at::date
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
LEFT JOIN purchase_import_rows pir ON pir.created_roll_id = r.id
LEFT JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE r.barcode IN ('3288696','3288697','3288698','3288700','3288701','3288702','3288704','3288705','3288706','3288708')
ORDER BY r.barcode;"

echo ""
echo "=== MISMATCH check: excel says WINTER but DB says ASTRLI ==="
psql "$DATABASE_URL" -c "
WITH excel AS (
  SELECT DISTINCT ON (pir.normalized_data->>'barcode')
    pir.normalized_data->>'barcode' AS barcode,
    pir.normalized_data->>'materialName' AS excel_mat,
    pir.normalized_data->>'supplierMaterialCode' AS excel_desen
  FROM purchase_import_rows pir
  JOIN purchase_import_batches b ON b.id = pir.batch_id
  WHERE b.file_name = 'AHMET BARAKAT SURYA 1.xls'
    AND pir.normalized_data->>'barcode' IN ('3288696','3288697','3288698','3288700','3288701','3288702','3288704','3288705','3288706','3288708')
  ORDER BY pir.normalized_data->>'barcode', b.created_at DESC
),
live AS (
  SELECT r.barcode, fi.name AS db_mat, fi.internal_code AS db_code, r.status
  FROM fabric_rolls r
  JOIN fabric_items fi ON fi.id = r.item_id
  WHERE r.barcode IN (SELECT barcode FROM excel)
    AND r.status IN ('AVAILABLE','RESERVED')
)
SELECT e.barcode, e.excel_mat, e.excel_desen, l.db_mat, l.db_code, l.status,
       CASE WHEN lower(trim(e.excel_mat)) = lower(trim(l.db_mat)) THEN 'MATCH' ELSE '*** MISMATCH ***' END AS verdict
FROM excel e
LEFT JOIN live l ON l.barcode = e.barcode
ORDER BY e.barcode;"
