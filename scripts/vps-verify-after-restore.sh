#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

echo "=== API health ==="
curl -s http://127.0.0.1:4020/api/health/live
echo ""

echo "=== Confirmed SURYA today (should be 0) ==="
psql "$DATABASE_URL" -t -A -c "
SELECT count(*) FROM purchase_import_batches
WHERE file_name='AHMET BARAKAT SURYA 1.xls'
  AND status='CONFIRMED'
  AND confirmed_at > '2026-07-12 20:30:00';"

echo ""
echo "=== HONEYCOMB live rolls ==="
psql "$DATABASE_URL" -c "
SELECT count(*) AS honeycomb_live FROM fabric_rolls r
JOIN fabric_items fi ON fi.id=r.item_id
WHERE fi.name ILIKE 'honeycomb' AND r.status IN ('AVAILABLE','RESERVED');"

echo ""
echo "=== ALEXANDRA Jakar ==="
psql "$DATABASE_URL" -c "
SELECT fi.name, fi.internal_code, fi.supplier_code,
       (SELECT count(*) FROM fabric_rolls r WHERE r.item_id=fi.id AND r.status IN ('AVAILABLE','RESERVED')) AS live
FROM fabric_items fi WHERE fi.name ILIKE 'alexandra' ORDER BY live DESC;"
