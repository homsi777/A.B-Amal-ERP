#!/bin/bash
# Create timestamped PostgreSQL backup — read-only, no import/restore.
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

mkdir -p ~/backups
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="/home/ubuntu/backups/clotex-before-safe-import-${STAMP}.dump"

echo "=== Creating backup ==="
echo "Target: $OUT"
pg_dump -Fc --no-owner --no-privileges -f "$OUT" "$DATABASE_URL"
ls -lh "$OUT"
echo "=== DONE ==="
