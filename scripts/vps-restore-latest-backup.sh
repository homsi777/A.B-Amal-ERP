#!/bin/bash
# Restore latest clotex backup (before failed SURYA import)
set -euo pipefail
cd ~/ab-amal-erp
export PATH=/home/ubuntu/.nvm/versions/node/v22.22.3/bin:$PATH
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

DUMP="${1:-/home/ubuntu/backups/clotex-before-next-import-20260712-202611.dump}"

if [[ ! -f "$DUMP" ]]; then
  echo "ERROR: backup not found: $DUMP"
  exit 1
fi

echo "=== RESTORE from: $DUMP ==="
ls -lh "$DUMP"

echo ""
echo "=== Stop API ==="
pm2 stop clotexerp-server || true

echo ""
echo "=== Terminate DB connections ==="
psql "$DATABASE_URL" -c "
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid();" || true

echo ""
echo "=== pg_restore (clean) ==="
pg_restore --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" "$DUMP"
echo "pg_restore OK"

echo ""
echo "=== Start API ==="
pm2 start clotexerp-server || pm2 restart clotexerp-server

echo ""
echo "=== Verify after restore ==="
psql "$DATABASE_URL" -c "
SELECT id, status, created_roll_count, confirmed_at
FROM purchase_import_batches
WHERE file_name='AHMET BARAKAT SURYA 1.xls'
ORDER BY created_at DESC LIMIT 2;"

psql "$DATABASE_URL" -c "
SELECT r.barcode, fi.name, fi.internal_code, r.status
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id=r.item_id
WHERE fi.name ILIKE 'honeycomb' AND r.barcode IN ('1000150','1000143')
ORDER BY r.barcode;"

curl -s http://127.0.0.1:4020/api/health/live || true
echo ""
echo "=== RESTORE DONE ==="
