#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp || exit 1
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

echo "=== DB PING ==="
psql "$DATABASE_URL" -t -A -c "SELECT current_database() || ' | ' || current_user || ' | ' || now()::text;"

echo ""
echo "=== BACKUPS (quick) ==="
ls -lah ~/backups 2>/dev/null | tail -5 || echo "no ~/backups"
ls -lah /var/backups/postgresql* 2>/dev/null | tail -3 || echo "no /var/backups/postgresql"

echo ""
echo "=== LAST IMPORT BATCHES ==="
psql "$DATABASE_URL" -c "
SELECT id, file_name, status, created_roll_count, created_item_count,
       confirmed_at::date AS confirmed, created_purchase_invoice_id IS NOT NULL AS has_invoice
FROM purchase_import_batches
ORDER BY COALESCE(confirmed_at, created_at) DESC
LIMIT 10;
"

echo ""
echo "=== BATCHES MATCHING AHMET / SURYA / BARAKAT ==="
psql "$DATABASE_URL" -c "
SELECT id, file_name, status, created_roll_count, confirmed_at
FROM purchase_import_batches
WHERE lower(file_name) LIKE '%ahmet%' OR lower(file_name) LIKE '%surya%' OR lower(file_name) LIKE '%barakat%'
ORDER BY COALESCE(confirmed_at, created_at) DESC;
"

BATCH_ID=$(psql "$DATABASE_URL" -t -A -c "
SELECT id FROM purchase_import_batches
WHERE status = 'CONFIRMED'
ORDER BY confirmed_at DESC NULLS LAST
LIMIT 1;
" | tr -d '[:space:]')

if [ -z "$BATCH_ID" ]; then
  echo "No CONFIRMED batch found."
  exit 0
fi

echo ""
echo "=== LATEST CONFIRMED BATCH: $BATCH_ID ==="

echo ""
echo "=== ROLL STATUS FOR BATCH ==="
psql "$DATABASE_URL" -c "
SELECT status, COUNT(*) AS cnt
FROM fabric_rolls
WHERE import_batch_id = '$BATCH_ID'
GROUP BY status
ORDER BY cnt DESC;
"

echo ""
echo "=== ROLLS BY ITEM (this batch) ==="
psql "$DATABASE_URL" -c "
SELECT fi.name, fi.internal_code, COUNT(fr.id) AS rolls, ROUND(SUM(fr.length_m)::numeric, 1) AS total_m
FROM fabric_rolls fr
JOIN fabric_items fi ON fi.id = fr.item_id
WHERE fr.import_batch_id = '$BATCH_ID'
GROUP BY fi.name, fi.internal_code
ORDER BY rolls DESC
LIMIT 25;
"

echo ""
echo "=== ITEMS TOUCHED BY BATCH ROWS ==="
psql "$DATABASE_URL" -c "
SELECT fi.name, fi.internal_code, fi.updated_at::date AS updated, COUNT(pir.id) AS rows
FROM purchase_import_rows pir
JOIN fabric_items fi ON fi.id = pir.matched_item_id
WHERE pir.batch_id = '$BATCH_ID'
GROUP BY fi.id, fi.name, fi.internal_code, fi.updated_at
ORDER BY rows DESC
LIMIT 25;
"

echo ""
echo "=== RECENTLY UPDATED fabric_items (last 3 days) ==="
psql "$DATABASE_URL" -c "
SELECT name, internal_code, supplier_code, updated_at
FROM fabric_items
WHERE updated_at > now() - interval '3 days'
ORDER BY updated_at DESC
LIMIT 20;
"

echo ""
echo "=== DONE (read-only) ==="
