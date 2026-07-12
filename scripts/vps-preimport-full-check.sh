#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

echo "=== Backup reminder ==="
ls -lh ~/backups/clotex-before-next-import-*.dump 2>/dev/null | tail -1 || echo "(no backup found)"

echo ""
echo "=== HONEYCOMB live rolls (must stay unchanged) ==="
psql "$DATABASE_URL" -c "
SELECT r.barcode, fi.name, fi.internal_code, r.status, r.length_m
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id=r.item_id
WHERE fi.name ILIKE 'honeycomb' AND r.status IN ('AVAILABLE','RESERVED')
ORDER BY r.barcode;"

echo ""
echo "=== ALEXANDRA / Jakar check ==="
psql "$DATABASE_URL" -c "
SELECT fi.name, fi.internal_code, fi.supplier_code,
       (SELECT count(*) FROM fabric_rolls r WHERE r.item_id=fi.id AND r.status IN ('AVAILABLE','RESERVED')) AS live
FROM fabric_items fi
WHERE fi.name ILIKE '%alexandra%' OR fi.supplier_code ILIKE 'jakar'
ORDER BY live DESC LIMIT 5;"

echo ""
echo "=== Barcode overlap: SURYA vs live rolls ==="
psql "$DATABASE_URL" -c "
SELECT pir.normalized_data->>'barcode' AS surya_barcode,
       r.barcode AS existing_roll, r.status, fi.name
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
JOIN fabric_rolls r ON r.company_id = pir.company_id
  AND lower(trim(r.barcode)) = lower(trim(pir.normalized_data->>'barcode'))
JOIN fabric_items fi ON fi.id = r.item_id
WHERE b.file_name = 'AHMET BARAKAT SURYA 1.xls' AND b.status = 'CANCELLED'
  AND coalesce(pir.normalized_data->>'barcode','') <> ''
  AND r.status IN ('AVAILABLE','RESERVED')
LIMIT 20;"

echo ""
echo "=== Cancelled SURYA batch settings ==="
psql "$DATABASE_URL" -c "
SELECT id, status, supplier_id, warehouse_id, default_location_id,
       currency_code, exchange_rate_to_usd, purchase_invoice_no, created_at
FROM purchase_import_batches
WHERE file_name='AHMET BARAKAT SURYA 1.xls'
ORDER BY created_at DESC LIMIT 2;"

echo ""
echo "=== Safe match simulation ==="
npx tsx server/src/scripts/previewSuryaPurchaseImport.ts 2>&1
