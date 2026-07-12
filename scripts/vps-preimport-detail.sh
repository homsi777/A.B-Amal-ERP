#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

echo "=== ASTRLI EKOSE safe match targets ==="
psql "$DATABASE_URL" -c "
SELECT fi.name, fi.internal_code, fi.supplier_code,
       (SELECT count(*) FROM fabric_rolls r WHERE r.item_id=fi.id AND r.status IN ('AVAILABLE','RESERVED')) AS live
FROM fabric_items fi
WHERE lower(trim(fi.name)) IN ('astrlı ekose','astrlı ekose','astrlı ekose')
   OR fi.name ILIKE 'astrl%'
ORDER BY live DESC, fi.name;"

echo ""
echo "=== ALEXANDRA items (5130 vs Jakar) ==="
psql "$DATABASE_URL" -c "
SELECT fi.id, fi.name, fi.internal_code, fi.supplier_code,
       (SELECT count(*) FROM fabric_rolls r WHERE r.item_id=fi.id AND r.status IN ('AVAILABLE','RESERVED')) AS live
FROM fabric_items fi WHERE fi.name ILIKE 'alexandra' ORDER BY live DESC;"

echo ""
echo "=== KUMSAL vs pantalon (old risk) ==="
psql "$DATABASE_URL" -c "
SELECT fi.name, fi.internal_code, fi.supplier_code,
       (SELECT count(*) FROM fabric_rolls r WHERE r.item_id=fi.id AND r.status IN ('AVAILABLE','RESERVED')) AS live
FROM fabric_items fi
WHERE lower(trim(coalesce(fi.supplier_code,fi.internal_code,''))) = 'kl-199'
ORDER BY live DESC;"

echo ""
echo "=== API process ==="
ps aux | grep -E 'node|tsx|fastify' | grep -v grep | head -5
