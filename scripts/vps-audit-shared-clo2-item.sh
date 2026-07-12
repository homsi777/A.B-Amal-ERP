#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

ITEM=680649e5-479d-4ef1-ad6f-d37d3f8af425

echo "=== fabric_item 680649e5 (shared CLO-2 item) ==="
psql "$DATABASE_URL" -c "
SELECT id, name, internal_code, supplier_code, created_at, updated_at
FROM fabric_items WHERE id='$ITEM';"

echo ""
echo "=== Rolls on this item by import batch ==="
psql "$DATABASE_URL" -c "
SELECT b.file_name, b.status, b.confirmed_at::date,
       count(*) AS rolls,
       min(pir.normalized_data->>'materialName') AS sample_excel_name
FROM fabric_rolls r
JOIN purchase_import_rows pir ON pir.created_roll_id=r.id
JOIN purchase_import_batches b ON b.id=pir.batch_id
WHERE r.item_id='$ITEM'
GROUP BY b.id, b.file_name, b.status, b.confirmed_at
ORDER BY b.confirmed_at DESC NULLS LAST;"

echo ""
echo "=== Live rolls on this item — excel name vs displayed name ==="
psql "$DATABASE_URL" -c "
SELECT r.barcode,
       fi.name AS shown_name,
       pir.normalized_data->>'materialName' AS excel_name,
       b.confirmed_at::date
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id=r.item_id
LEFT JOIN purchase_import_rows pir ON pir.created_roll_id=r.id
LEFT JOIN purchase_import_batches b ON b.id=pir.batch_id
WHERE r.item_id='$ITEM' AND r.status IN ('AVAILABLE','RESERVED')
ORDER BY r.barcode
LIMIT 15;"

echo ""
echo "=== Latest confirmed SURYA batches today ==="
psql "$DATABASE_URL" -c "
SELECT id, status, created_roll_count, confirmed_at
FROM purchase_import_batches
WHERE file_name ILIKE '%SURYA%'
ORDER BY created_at DESC LIMIT 5;"
