#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
\echo '=== Aleppo rows 140-155 (ASTRLI area) ==='
SELECT row_no,
       normalized_data->>'materialName' AS name,
       normalized_data->>'materialCode' AS code,
       normalized_data->>'supplierMaterialCode' AS desen,
       normalized_data->>'colorName' AS color
FROM purchase_import_rows
WHERE batch_id='2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND row_no BETWEEN 140 AND 155
ORDER BY row_no;

\echo '=== Aleppo ALEXANDRA rows ==='
SELECT row_no,
       normalized_data->>'materialName' AS name,
       normalized_data->>'materialCode' AS code,
       normalized_data->>'supplierMaterialCode' AS desen,
       normalized_data->>'colorName' AS color
FROM purchase_import_rows
WHERE batch_id='2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND normalized_data->>'materialName' ILIKE '%alex%'
ORDER BY row_no;

\echo '=== Aleppo distinct ASTRLI codes ==='
SELECT DISTINCT
       normalized_data->>'materialName' AS name,
       normalized_data->>'materialCode' AS code,
       normalized_data->>'supplierMaterialCode' AS desen
FROM purchase_import_rows
WHERE batch_id='2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND normalized_data->>'materialName' ILIKE '%astrl%';

\echo '=== What manager sees in categories under Alexandra ==='
SELECT c.name, c.code, c.level
FROM fabric_categories c
WHERE c.parent_id = '181f0efd-7659-4a1e-94a7-bb3b2e318bb6'
   OR c.id = '181f0efd-7659-4a1e-94a7-bb3b2e318bb6'
ORDER BY c.level, c.name;

\echo '=== What manager sees in categories under ASTRLI ==='
SELECT c.name, c.code, c.level
FROM fabric_categories c
WHERE c.parent_id = '4dc19e1b-51d1-4222-93f9-17887e8bad4b'
   OR c.id = '4dc19e1b-51d1-4222-93f9-17887e8bad4b'
ORDER BY c.level, c.name;
SQL
