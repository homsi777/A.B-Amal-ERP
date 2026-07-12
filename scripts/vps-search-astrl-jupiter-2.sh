#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
\echo '=== fuzzy: jupitter/jupter/jupitar ==='
SELECT name, internal_code FROM fabric_items
WHERE name ILIKE '%jupit%' OR name ILIKE '%jupitter%' OR internal_code ILIKE '%jupit%';

\echo '=== honeycomb vs astrli history ==='
SELECT name, internal_code, (SELECT count(*) FROM fabric_rolls r WHERE r.item_id=fi.id) AS rolls
FROM fabric_items fi WHERE name ILIKE '%honey%' OR name ILIKE '%ekose%';

\echo '=== was ASTRLI item id ever jupiter? (matched_item audit) ==='
SELECT pir.row_no, pir.matched_item_id, fi.name, fi.internal_code
FROM purchase_import_rows pir
LEFT JOIN fabric_items fi ON fi.id = pir.matched_item_id
WHERE pir.normalized_data->>'materialName' ILIKE '%astrl%'
  AND (fi.name ILIKE '%jupi%' OR pir.matched_item_id IN (
    SELECT id FROM fabric_items WHERE name ILIKE '%jupi%'
  ))
LIMIT 10;

\echo '=== raw import text search astrli+jupi in same row ==='
SELECT row_no, normalized_data::text
FROM purchase_import_rows
WHERE normalized_data::text ILIKE '%astrl%' AND normalized_data::text ILIKE '%jup%'
LIMIT 5;

\echo '=== SURYA file: any jupiter near astrli ==='
SELECT row_no, normalized_data
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE b.file_name ILIKE '%SURYA%'
  AND row_no BETWEEN 8 AND 15
ORDER BY b.file_name, row_no
LIMIT 20;

\echo '=== similarity: items with CLO code that were jupiter or honeycomb ==='
SELECT fi.name, fi.internal_code, count(r.id) AS rolls
FROM fabric_items fi
LEFT JOIN fabric_rolls r ON r.item_id = fi.id
WHERE fi.internal_code ILIKE 'CLO%' OR fi.internal_code ILIKE '1000' OR fi.internal_code ILIKE '4000'
GROUP BY fi.name, fi.internal_code
HAVING fi.name ILIKE '%jupi%' OR fi.name ILIKE '%astrl%' OR fi.name ILIKE '%honey%'
ORDER BY fi.name, fi.internal_code;
SQL
