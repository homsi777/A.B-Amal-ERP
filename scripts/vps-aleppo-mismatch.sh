#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
SELECT r.barcode, fi.name, fi.internal_code, r.status, r.notes
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
WHERE r.barcode BETWEEN '1000143' AND '1000151'
ORDER BY r.barcode;

\echo '=== HONEYCOMB items ==='
SELECT id, name, internal_code FROM fabric_items WHERE name ILIKE '%honey%';

\echo '=== Rolls still on HONEYCOMB ==='
SELECT count(*), fi.name, fi.internal_code
FROM fabric_rolls r JOIN fabric_items fi ON fi.id = r.item_id
WHERE fi.name ILIKE '%honey%'
GROUP BY fi.name, fi.internal_code;

\echo '=== Aleppo rows 134-152 created rolls mapping ==='
SELECT pir.row_no,
       normalized_data->>'materialName' AS imp_name,
       normalized_data->>'materialCode' AS imp_code,
       fi.name AS roll_item_name,
       fi.internal_code,
       r.barcode,
       r.status
FROM purchase_import_rows pir
JOIN fabric_rolls r ON r.id = pir.created_roll_id
JOIN fabric_items fi ON fi.id = r.item_id
WHERE pir.batch_id='2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND pir.row_no BETWEEN 134 AND 152
ORDER BY pir.row_no;

\echo '=== Aleppo Alexandra rows mapping ==='
SELECT pir.row_no,
       normalized_data->>'materialName' AS imp_name,
       normalized_data->>'materialCode' AS imp_code,
       fi.name AS roll_item_name,
       fi.internal_code,
       r.barcode
FROM purchase_import_rows pir
JOIN fabric_rolls r ON r.id = pir.created_roll_id
JOIN fabric_items fi ON fi.id = r.item_id
WHERE pir.batch_id='2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND pir.row_no BETWEEN 1 AND 5
ORDER BY pir.row_no;
SQL
