#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
BATCH="${1:-70f1a8f7-f391-4172-b9f5-2d49287eaeb9}"

psql "$DATABASE_URL" -c "
SELECT pir.normalized_data->>'materialName' AS surya_name,
       pir.normalized_data->>'supplierMaterialCode' AS code,
       fi.name AS matched_name, fi.internal_code, pir.status
FROM purchase_import_rows pir
LEFT JOIN fabric_items fi ON fi.id = pir.matched_item_id
WHERE pir.batch_id='$BATCH'
  AND (pir.normalized_data->>'materialName' ILIKE 'astrl%' OR pir.normalized_data->>'materialName' ILIKE 'kumsal%')
ORDER BY pir.row_no LIMIT 12;"

psql "$DATABASE_URL" -c "
SELECT count(*) AS honeycomb_matches
FROM purchase_import_rows pir
JOIN fabric_items fi ON fi.id=pir.matched_item_id
WHERE pir.batch_id='$BATCH' AND fi.name ILIKE 'honeycomb';"

psql "$DATABASE_URL" -c "
SELECT pir.normalized_data->>'materialName' AS excel_name,
       pir.normalized_data->>'supplierMaterialCode' AS code,
       fi.name AS matched_name, fi.internal_code,
       count(*) AS rows
FROM purchase_import_rows pir
LEFT JOIN fabric_items fi ON fi.id=pir.matched_item_id
WHERE pir.batch_id='$BATCH'
  AND pir.normalized_data->>'materialName' ILIKE 'w%nter%sardonlu%'
GROUP BY 1,2,3,4
ORDER BY 2;"
