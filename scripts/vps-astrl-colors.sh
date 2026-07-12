#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
SELECT pir.row_no,
       pir.normalized_data->>'supplierMaterialCode' AS desen,
       pir.normalized_data->>'colorName' AS color,
       pir.normalized_data->>'lengthM' AS len
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE b.file_name='AHMET BARAKAT SURYA 1.xls' AND b.status='CONFIRMED'
  AND pir.normalized_data->>'materialName' ILIKE '%astrl%'
ORDER BY b.confirmed_at, pir.row_no
LIMIT 20;

\echo '=== Aleppo CLO-3 rolls colors ==='
SELECT pir.row_no,
       pir.normalized_data->>'materialName' AS name,
       pir.normalized_data->>'materialCode' AS code,
       pir.normalized_data->>'colorName' AS color,
       r.barcode
FROM purchase_import_rows pir
JOIN fabric_rolls r ON r.id = pir.created_roll_id
WHERE pir.batch_id='2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND pir.row_no BETWEEN 144 AND 152
ORDER BY pir.row_no;
SQL
