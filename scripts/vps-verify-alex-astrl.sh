#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
\echo '=== ALEXANDRA rolls after fix ==='
SELECT r.barcode, fi.name, fi.internal_code, fi.supplier_code, r.status
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
WHERE fi.name ILIKE '%alexandra%'
ORDER BY r.barcode LIMIT 10;

\echo '=== ASTRLI rolls after fix ==='
SELECT r.barcode, fi.name, fi.internal_code, fi.supplier_code, r.status
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
WHERE fi.name ILIKE '%astrl%'
ORDER BY fi.internal_code, r.barcode;

\echo '=== fabric_items ALEX/ASTRLI ==='
SELECT name, internal_code, supplier_code,
       (SELECT count(*) FROM fabric_rolls fr WHERE fr.item_id=fi.id AND fr.status IN ('AVAILABLE','RESERVED')) AS active_rolls
FROM fabric_items fi
WHERE name ILIKE '%alexandra%' OR name ILIKE '%astrl%'
ORDER BY name, internal_code;
SQL
