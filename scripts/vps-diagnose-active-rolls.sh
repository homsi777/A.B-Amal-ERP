#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

psql "$DATABASE_URL" <<'SQL'
\echo '=== Active rolls on ROYAL 36-1 item by import batch ==='
SELECT COALESCE(fr.import_batch_id::text,'manual/old') AS batch, COUNT(*)
FROM fabric_rolls fr
WHERE fr.item_id = '5383793f-81bf-4378-8647-8b0421a61de5'
  AND fr.status IN ('AVAILABLE','RESERVED')
GROUP BY 1;

\echo '=== Active rolls on KUMSAL - wrong item? ==='
SELECT fi.internal_code, fr.status, COUNT(*),
  MIN(fr.created_at)::date AS oldest
FROM fabric_rolls fr
JOIN fabric_items fi ON fi.id = fr.item_id
WHERE fi.name ILIKE 'kumsal' AND fr.status IN ('AVAILABLE','RESERVED')
GROUP BY 1,2;

\echo '=== All fabric_items: active rolls grouped - items with multiple internal codes same name ==='
SELECT fi.name, COUNT(DISTINCT fi.internal_code) AS codes, SUM(CASE WHEN fr.status IN ('AVAILABLE','RESERVED') THEN 1 ELSE 0 END) AS active
FROM fabric_items fi
LEFT JOIN fabric_rolls fr ON fr.item_id = fi.id
GROUP BY fi.name
HAVING COUNT(DISTINCT fi.internal_code) > 1
ORDER BY active DESC
LIMIT 15;
SQL
