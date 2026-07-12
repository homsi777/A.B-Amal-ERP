#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
BATCH12='52d9c5e6-6ad4-41fa-a015-be0ee9c4307f'

psql "$DATABASE_URL" <<SQL
\echo '=== Jul12: distinct excel names per matched item ==='
SELECT fi.id, fi.name AS db_name, fi.internal_code,
       array_agg(DISTINCT pir.normalized_data->>'materialName') AS excel_names,
       array_agg(DISTINCT pir.normalized_data->>'supplierMaterialCode') AS excel_codes
FROM purchase_import_rows pir
JOIN fabric_items fi ON fi.id = pir.matched_item_id
WHERE pir.batch_id = '$BATCH12' AND pir.matched_item_id IS NOT NULL
GROUP BY fi.id, fi.name, fi.internal_code
ORDER BY fi.name;

\echo '=== Items where db_name not in excel_names for same row match ==='
SELECT fi.id, fi.name AS db_name, fi.internal_code,
       pir.normalized_data->>'materialName' AS excel_name,
       pir.normalized_data->>'supplierMaterialCode' AS excel_code,
       COUNT(*) AS rows
FROM purchase_import_rows pir
JOIN fabric_items fi ON fi.id = pir.matched_item_id
WHERE pir.batch_id = '$BATCH12'
  AND lower(trim(fi.name)) <> lower(trim(pir.normalized_data->>'materialName'))
GROUP BY 1,2,3,4,5
ORDER BY rows DESC;

\echo '=== Jul12 matched items: oldest roll created_at vs item name history hint ==='
SELECT fi.id, fi.name, fi.internal_code,
       MIN(fr.created_at)::date AS first_roll,
       MAX(fr.created_at)::date AS last_roll
FROM fabric_items fi
JOIN purchase_import_rows pir ON pir.matched_item_id = fi.id AND pir.batch_id='$BATCH12'
JOIN fabric_rolls fr ON fr.item_id = fi.id
GROUP BY fi.id, fi.name, fi.internal_code
ORDER BY first_roll;
SQL
