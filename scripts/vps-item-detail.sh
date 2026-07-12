#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
SELECT id, name, internal_code, supplier_code, is_active
FROM fabric_items
WHERE name ILIKE '%alexandra%' OR name ILIKE '%astrl%' OR name ILIKE '%honey%'
ORDER BY name, internal_code;

\echo '=== Sample roll API fields ==='
SELECT r.barcode, fi.name AS item_name, fi.internal_code, fi.supplier_code,
       fc.name AS color_name, fc.code AS color_code
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
LEFT JOIN fabric_colors fc ON fc.id = r.color_id
WHERE r.barcode IN ('1000000','1000143')
LIMIT 5;
SQL
