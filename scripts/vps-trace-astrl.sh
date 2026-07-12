#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
\echo '=== Search astrli/ekose/honeycomb in aleppo ==='
SELECT row_no,
       normalized_data->>'materialName' AS name,
       normalized_data->>'materialCode' AS code
FROM purchase_import_rows
WHERE batch_id='2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND (normalized_data::text ILIKE '%astrl%' OR normalized_data::text ILIKE '%ekose%' OR normalized_data::text ILIKE '%honey%')
ORDER BY row_no;

\echo '=== Roll 1000143 item history - qr payload ==='
SELECT r.barcode, fi.name, fi.internal_code, r.qr_payload, r.notes
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
WHERE r.barcode IN ('1000143','1000144','1000000');

\echo '=== import row for roll 1000143 ==='
SELECT pir.row_no, pir.created_roll_id, pir.normalized_data
FROM purchase_import_rows pir
WHERE pir.created_roll_id IN (
  SELECT id FROM fabric_rolls WHERE barcode IN ('1000143','1000000')
);

\echo '=== SURYA batch rolls that became ALEXANDRA/ASTRLI ==='
SELECT r.barcode, fi.name, fi.internal_code, r.status, r.notes
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
JOIN purchase_import_rows pir ON pir.created_roll_id = r.id
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE b.file_name = 'AHMET BARAKAT SURYA 1.xls'
  AND (fi.name ILIKE '%alex%' OR fi.name ILIKE '%astrl%')
ORDER BY fi.name, r.barcode
LIMIT 40;
SQL
