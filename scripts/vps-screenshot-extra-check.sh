#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

echo "=== Any rolls with those barcodes (any status) ==="
psql "$DATABASE_URL" -c "
SELECT r.barcode, fi.name, fi.internal_code, r.status, b.status AS batch_st
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id=r.item_id
LEFT JOIN purchase_import_rows pir ON pir.created_roll_id=r.id
LEFT JOIN purchase_import_batches b ON b.id=pir.batch_id
WHERE r.barcode IN ('3288696','3288697','3288698','3288700','3288701','3288702','3288704','3288705','3288706','3288708')
ORDER BY r.barcode, r.status;"

echo ""
echo "=== ASTRLI EKOSE in Excel — only CLO-2 row ==="
psql "$DATABASE_URL" -c "
SELECT pir.normalized_data->>'barcode' AS barcode,
       pir.normalized_data->>'materialName' AS material,
       pir.normalized_data->>'supplierMaterialCode' AS desen
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id=pir.batch_id
WHERE b.file_name='AHMET BARAKAT SURYA 1.xls'
  AND pir.normalized_data->>'materialName' ILIKE 'astrl%'
  AND pir.normalized_data->>'supplierMaterialCode'='CLO-2'
LIMIT 5;"
