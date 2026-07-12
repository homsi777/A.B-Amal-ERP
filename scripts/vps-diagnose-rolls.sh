#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
\echo '=== active rolls ALEXANDRA / ASTRLI ==='
SELECT r.barcode, fi.name, fi.internal_code, fi.supplier_code_item, r.status, r.notes
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
WHERE (fi.name ILIKE '%alexandra%' OR fi.name ILIKE '%astrl%')
  AND r.status IN ('ACTIVE','RESERVED')
ORDER BY fi.name, r.barcode;

\echo '=== all rolls count by item ==='
SELECT fi.name, fi.internal_code, r.status, count(*)
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
WHERE fi.name ILIKE '%alexandra%' OR fi.name ILIKE '%astrl%'
GROUP BY fi.name, fi.internal_code, r.status;

\echo '=== SURYA confirmed batches rolls for alex/astrl ==='
SELECT r.barcode, fi.name, fi.internal_code, r.status, r.notes
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
WHERE r.notes ILIKE '%SURYA%'
  AND (fi.name ILIKE '%alexandra%' OR fi.name ILIKE '%astrl%')
ORDER BY fi.name, r.barcode
LIMIT 30;

\echo '=== Aleppo rolls notes ==='
SELECT r.barcode, fi.name, fi.internal_code, r.status, r.notes
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
WHERE r.notes ILIKE '%حلب%'
ORDER BY fi.name, r.barcode;

\echo '=== fabric_items a66e0627 (CLO-1/2 placeholder?) ==='
SELECT id, name, internal_code FROM fabric_items WHERE id='a66e0627-28b0-455f-a639-7dee5565f2ad';
SQL
