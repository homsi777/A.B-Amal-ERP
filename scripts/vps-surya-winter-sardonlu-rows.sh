#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
BATCH=71148335-4bb6-4157-b06f-b1c83cfc04ae

echo "=== WİNTER SARDONLU — summary in import file ==="
psql "$DATABASE_URL" -c "
SELECT pir.normalized_data->>'supplierMaterialCode' AS desen_code,
       pir.normalized_data->>'colorNameTr' AS color_tr,
       pir.normalized_data->>'colorCode' AS variant_no,
       count(*) AS rolls,
       round(sum((pir.normalized_data->>'lengthM')::numeric), 2) AS total_m
FROM purchase_import_rows pir
WHERE pir.batch_id='$BATCH'
  AND pir.normalized_data->>'materialName' ILIKE 'w%nter%sardonlu%'
GROUP BY 1,2,3
ORDER BY desen_code, color_tr;"

echo ""
echo "=== WİNTER SARDONLU — all rows (detail) ==="
psql "$DATABASE_URL" -c "
SELECT pir.row_no,
       pir.normalized_data->>'barcode' AS barcode,
       pir.normalized_data->>'materialName' AS material,
       pir.normalized_data->>'supplierMaterialCode' AS desen,
       pir.normalized_data->>'colorNameTr' AS color,
       pir.normalized_data->>'colorCode' AS variant,
       pir.normalized_data->>'lengthM' AS metres,
       fi.name AS matched_item,
       fi.internal_code AS item_code
FROM purchase_import_rows pir
LEFT JOIN fabric_items fi ON fi.id = COALESCE(pir.matched_item_id, (
  SELECT r.item_id FROM fabric_rolls r WHERE r.id = pir.created_roll_id LIMIT 1
))
WHERE pir.batch_id='$BATCH'
  AND pir.normalized_data->>'materialName' ILIKE 'w%nter%sardonlu%'
ORDER BY pir.row_no;"
