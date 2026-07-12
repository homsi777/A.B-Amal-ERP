#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
SELECT row_no, normalized_data->>'materialName', normalized_data->>'materialCode'
FROM purchase_import_rows
WHERE batch_id='2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND (normalized_data::text ILIKE '%astr%' OR normalized_data::text ILIKE '%ekos%')
LIMIT 5;

\echo '=== SURYA ASTRLI rows with rolls ==='
SELECT pir.row_no,
       pir.normalized_data->>'supplierMaterialCode' AS desen,
       fi.name, fi.internal_code, r.barcode, r.status
FROM purchase_import_rows pir
LEFT JOIN fabric_rolls r ON r.id = pir.created_roll_id
LEFT JOIN fabric_items fi ON fi.id = r.item_id
WHERE pir.batch_id IN (
  SELECT id FROM purchase_import_batches WHERE file_name='AHMET BARAKAT SURYA 1.xls' AND status='CONFIRMED'
)
AND pir.normalized_data->>'materialName' ILIKE '%astrl%'
ORDER BY pir.batch_id, pir.row_no;
SQL
