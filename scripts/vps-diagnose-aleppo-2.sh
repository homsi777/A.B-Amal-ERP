#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

psql "$DATABASE_URL" <<'SQL'
\echo '=== Aleppo batch rolls - notes/metadata ==='
SELECT fr.barcode, fi.name, fi.internal_code,
       left(fr.notes, 80) AS notes,
       left(pil.metadata::text, 120) AS meta
FROM fabric_rolls fr
JOIN fabric_items fi ON fi.id=fr.item_id
LEFT JOIN purchase_invoice_lines pil ON pil.fabric_roll_id=fr.id
WHERE fr.import_batch_id='2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND (lower(fi.name) LIKE '%alexandra%' OR lower(fi.name) LIKE '%astrl%')
LIMIT 5;

\echo '=== stock_import_jobs table? ==='
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name LIKE '%stock%import%';

\echo '=== purchase_import for aleppo ==='
SELECT id, source_type, file_name FROM purchase_import_batches WHERE id='2baf30aa-dae7-4d48-95f3-9d1778616256';

\echo '=== sample rows from purchase_import_rows aleppo alexandra ==='
SELECT row_no, normalized_data, matched_item_id
FROM purchase_import_rows
WHERE batch_id='2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND normalized_data::text ILIKE '%alexandra%'
LIMIT 3;
SQL
