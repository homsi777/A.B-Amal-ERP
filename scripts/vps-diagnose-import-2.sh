#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp || exit 1
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

echo "=== ALL CONFIRMED AHMET SURYA FULL FILE IMPORTS ==="
psql "$DATABASE_URL" <<'SQL'
SELECT id, confirmed_at::date AS day, created_roll_count, created_purchase_invoice_id IS NOT NULL AS invoice
FROM purchase_import_batches
WHERE file_name = 'AHMET BARAKAT SURYA 1.xls' AND status = 'CONFIRMED'
ORDER BY confirmed_at;
SQL

echo ""
echo "=== ROLL COUNTS PER CONFIRMED BATCH ==="
psql "$DATABASE_URL" <<'SQL'
SELECT b.id, b.confirmed_at::date, fr.status, COUNT(*)
FROM purchase_import_batches b
JOIN fabric_rolls fr ON fr.import_batch_id = b.id
WHERE b.file_name = 'AHMET BARAKAT SURYA 1.xls' AND b.status = 'CONFIRMED'
GROUP BY b.id, b.confirmed_at, fr.status
ORDER BY b.confirmed_at, fr.status;
SQL

echo ""
echo "=== TODAY BATCH: WHY RESERVED? ==="
psql "$DATABASE_URL" <<'SQL'
SELECT fr.status, fr.reservation_type, COUNT(*)
FROM fabric_rolls fr
WHERE fr.import_batch_id = '52d9c5e6-6ad4-41fa-a015-be0ee9c4307f'
GROUP BY fr.status, fr.reservation_type
ORDER BY COUNT(*) DESC;
SQL

echo ""
echo "=== ROYAL JAKAR ITEMS ==="
psql "$DATABASE_URL" <<'SQL'
SELECT id, name, internal_code, supplier_code FROM fabric_items
WHERE lower(name) LIKE '%royal%' ORDER BY internal_code;
SQL

echo ""
echo "=== ITEMS USED IN MORE THAN ONE CONFIRMED IMPORT ==="
psql "$DATABASE_URL" <<'SQL'
SELECT fi.name, fi.internal_code, COUNT(DISTINCT b.id) AS import_times
FROM fabric_items fi
JOIN purchase_import_rows pir ON pir.matched_item_id = fi.id
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE b.file_name = 'AHMET BARAKAT SURYA 1.xls' AND b.status = 'CONFIRMED'
GROUP BY fi.id, fi.name, fi.internal_code
HAVING COUNT(DISTINCT b.id) > 1
ORDER BY import_times DESC
LIMIT 15;
SQL

echo ""
echo "=== TOTAL ROLLS IN SYSTEM (AVAILABLE) ==="
psql "$DATABASE_URL" <<'SQL'
SELECT COUNT(*) AS available_rolls, ROUND(SUM(length_m)::numeric,0) AS total_m
FROM fabric_rolls WHERE status = 'AVAILABLE';
SQL
