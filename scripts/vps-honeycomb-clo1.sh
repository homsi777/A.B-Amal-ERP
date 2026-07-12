#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
SELECT r.barcode, fi.name, fi.internal_code, r.status,
       pir.normalized_data->>'materialName' AS excel_name,
       pir.normalized_data->>'materialCode' AS excel_code
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
LEFT JOIN purchase_import_rows pir ON pir.created_roll_id = r.id
WHERE fi.id = '0ae239a3-3aca-43e2-a271-a5e70d8c443f'
ORDER BY r.barcode;

SELECT id, name, internal_code FROM fabric_items
WHERE lower(trim(internal_code)) IN ('clo-1','clo1') AND name ILIKE '%honey%';
SQL
