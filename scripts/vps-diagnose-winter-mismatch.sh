#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

echo "=== Historical row matching for screenshot barcodes ==="
psql "$DATABASE_URL" -c "
SELECT b.id AS batch_id, b.status AS batch_status, b.created_at,
       pir.row_no, pir.normalized_data->>'barcode' AS barcode,
       pir.normalized_data->>'materialName' AS excel_name,
       pir.normalized_data->>'supplierMaterialCode' AS excel_code,
       pir.matched_item_id,
       fi.name AS matched_item_name, fi.internal_code AS matched_item_code,
       pir.created_roll_id
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id=pir.batch_id
LEFT JOIN fabric_items fi ON fi.id=pir.matched_item_id
WHERE b.file_name='AHMET BARAKAT SURYA 1.xls'
  AND pir.normalized_data->>'barcode' IN
      ('3288696','3288697','3288698','3288700','3288701','3288702','3288704','3288705','3288706','3288708')
ORDER BY b.created_at DESC, pir.row_no;"

echo ""
echo "=== Current fabric items sharing CLO-2 ==="
psql "$DATABASE_URL" -c "
SELECT fi.id, fi.name, fi.internal_code, fi.supplier_code, fi.created_at,
       count(r.id) FILTER (WHERE r.status IN ('AVAILABLE','RESERVED')) AS live_rolls,
       count(r.id) AS all_rolls
FROM fabric_items fi
LEFT JOIN fabric_rolls r ON r.item_id=fi.id
WHERE lower(trim(fi.internal_code))='clo-2'
   OR lower(trim(coalesce(fi.supplier_code,'')))='clo-2'
GROUP BY fi.id
ORDER BY fi.created_at;"

echo ""
echo "=== Audit events touching CLO-2 item names ==="
psql "$DATABASE_URL" -c "
SELECT created_at, action, entity_type, entity_id, old_values, new_values
FROM audit_logs
WHERE (old_values::text ILIKE '%CLO-2%' OR new_values::text ILIKE '%CLO-2%')
  AND entity_type ILIKE '%fabric%'
ORDER BY created_at DESC LIMIT 30;" 2>/dev/null || true
