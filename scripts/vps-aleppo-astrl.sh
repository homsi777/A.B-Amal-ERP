#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
SELECT row_no, normalized_data->>'materialName' AS name,
       normalized_data->>'materialCode' AS code,
       normalized_data->>'supplierMaterialCode' AS sup,
       matched_item_id
FROM purchase_import_rows
WHERE batch_id='2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND normalized_data::text ILIKE '%astrl%'
LIMIT 10;

SELECT row_no, normalized_data
FROM purchase_import_rows
WHERE batch_id='2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND normalized_data::text ILIKE '%alexandra%'
LIMIT 2;
SQL
