#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export PATH=/home/ubuntu/.nvm/versions/node/v22.22.3/bin:$PATH

echo "=== Available backups ==="
ls -lht ~/backups/*.dump 2>/dev/null | head -10 || echo "(none in ~/backups)"

echo ""
echo "=== Current DB ==="
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" -t -A -c "SELECT current_database();"

echo ""
echo "=== Latest SURYA batch (before restore) ==="
psql "$DATABASE_URL" -c "
SELECT id, status, created_roll_count, confirmed_at
FROM purchase_import_batches
WHERE file_name='AHMET BARAKAT SURYA 1.xls'
ORDER BY created_at DESC LIMIT 3;"
