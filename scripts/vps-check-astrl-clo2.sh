#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
BATCH=71148335-4bb6-4157-b06f-b1c83cfc04ae

echo "=== ASTRLI EKOSE / CLO-2 rows in confirmed batch ==="
psql "$DATABASE_URL" -c "
SELECT pir.row_no,
       pir.normalized_data->>'materialName' AS mat,
       pir.normalized_data->>'supplierMaterialCode' AS code,
       pir.matched_item_id,
       fi.name, fi.internal_code, fi.supplier_code,
       fr.barcode, fr.status
FROM purchase_import_rows pir
LEFT JOIN fabric_items fi ON fi.id = pir.matched_item_id
LEFT JOIN fabric_rolls fr ON fr.id = pir.created_roll_id
WHERE pir.batch_id='$BATCH'
  AND pir.normalized_data->>'supplierMaterialCode' = 'CLO-2'
  AND pir.normalized_data->>'materialName' ILIKE 'astrl%'
ORDER BY pir.row_no;"

echo ""
echo "=== All fabric_items named ASTRLI EKOSE ==="
psql "$DATABASE_URL" -c "
SELECT fi.id, fi.name, fi.internal_code, fi.supplier_code, fi.created_at,
       (SELECT count(*) FROM fabric_rolls r WHERE r.item_id=fi.id AND r.status IN ('AVAILABLE','RESERVED')) AS live,
       (SELECT count(*) FROM fabric_rolls r WHERE r.item_id=fi.id) AS total_rolls
FROM fabric_items fi
WHERE fi.name ILIKE 'astrl%'
ORDER BY fi.created_at;"

echo ""
echo "=== Categories for ASTRLI / CLO-2 ==="
psql "$DATABASE_URL" -c "
SELECT fc.id, fc.name, fc.code, fc.parent_id,
       p.name AS parent_name
FROM fabric_categories fc
LEFT JOIN fabric_categories p ON p.id = fc.parent_id
WHERE fc.name ILIKE 'astrl%' OR fc.name = 'CLO-2' OR fc.code = 'CLO-2'
ORDER BY fc.created_at DESC
LIMIT 20;"

echo ""
echo "=== WİNTER SARDONLU / CLO-2 item (should NOT have ASTRLI rolls) ==="
psql "$DATABASE_URL" -c "
SELECT fi.name, fi.internal_code,
       count(r.id) AS rolls_from_surya_batch
FROM fabric_items fi
JOIN fabric_rolls r ON r.item_id=fi.id
JOIN purchase_import_rows pir ON pir.created_roll_id=r.id AND pir.batch_id='$BATCH'
WHERE fi.name ILIKE 'w%inter%sardonlu%' OR fi.internal_code ILIKE 'CLO-2'
GROUP BY fi.id, fi.name, fi.internal_code;"
