#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export PATH=/home/ubuntu/.nvm/versions/node/v22.22.3/bin:$PATH
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

echo "=== Latest SURYA batch ==="
psql "$DATABASE_URL" -c "
SELECT id, status, row_count, created_roll_count, created_purchase_invoice_id,
       invoice_no, confirmed_at
FROM purchase_import_batches
WHERE file_name='AHMET BARAKAT SURYA 1.xls'
ORDER BY created_at DESC LIMIT 1;"

echo ""
echo "=== HONEYCOMB live (must be unchanged) ==="
psql "$DATABASE_URL" -c "
SELECT r.barcode, fi.name, fi.internal_code, r.status, r.length_m
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id=r.item_id
WHERE fi.name ILIKE 'honeycomb' AND r.status IN ('AVAILABLE','RESERVED')
  AND r.barcode IN ('1000143','1000144','1000145','1000146','1000147','1000148','1000149','1000150','1000151')
ORDER BY r.barcode;"

echo ""
echo "=== ALEXANDRA Jakar ==="
psql "$DATABASE_URL" -c "
SELECT fi.name, fi.internal_code, fi.supplier_code,
       (SELECT count(*) FROM fabric_rolls r WHERE r.item_id=fi.id AND r.status IN ('AVAILABLE','RESERVED')) AS live
FROM fabric_items fi
WHERE fi.name ILIKE 'alexandra' ORDER BY live DESC;"

echo ""
echo "=== Any SURYA roll wrongly on HONEYCOMB item? ==="
psql "$DATABASE_URL" -c "
SELECT count(*) AS wrong_honeycomb_links
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id=pir.batch_id
JOIN fabric_items fi ON fi.id=pir.matched_item_id
WHERE b.file_name='AHMET BARAKAT SURYA 1.xls' AND b.status='CONFIRMED'
  AND fi.name ILIKE 'honeycomb'
  AND pir.normalized_data->>'materialName' ILIKE 'astrl%';"

echo ""
echo "=== New rolls count by material (top 10) ==="
psql "$DATABASE_URL" -c "
SELECT fi.name, fi.internal_code, count(*) AS rolls
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id=r.item_id
JOIN purchase_import_rows pir ON pir.created_roll_id=r.id
JOIN purchase_import_batches b ON b.id=pir.batch_id
WHERE b.file_name='AHMET BARAKAT SURYA 1.xls' AND b.status='CONFIRMED'
  AND b.created_at > now() - interval '1 hour'
GROUP BY fi.name, fi.internal_code
ORDER BY rolls DESC LIMIT 10;"
