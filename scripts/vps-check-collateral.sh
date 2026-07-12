#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
BATCH='52d9c5e6-6ad4-41fa-a015-be0ee9c4307f'
psql "$DATABASE_URL" <<SQL
-- Active rolls on items touched by Jul12 import but from OTHER batches
SELECT COUNT(*) AS other_active_rolls
FROM fabric_rolls fr
WHERE fr.status IN ('AVAILABLE','RESERVED')
  AND fr.item_id IN (
    SELECT DISTINCT pir.matched_item_id
    FROM purchase_import_rows pir
    WHERE pir.batch_id = '$BATCH' AND pir.matched_item_id IS NOT NULL
  )
  AND (fr.import_batch_id IS NULL OR fr.import_batch_id <> '$BATCH');

SELECT fi.name, fi.internal_code, COUNT(*) FILTER (WHERE fr.import_batch_id = '$BATCH') AS batch_rolls,
       COUNT(*) FILTER (WHERE fr.import_batch_id IS DISTINCT FROM '$BATCH' AND fr.status IN ('AVAILABLE','RESERVED')) AS other_active
FROM fabric_items fi
JOIN fabric_rolls fr ON fr.item_id = fi.id
WHERE fi.id IN (SELECT DISTINCT matched_item_id FROM purchase_import_rows WHERE batch_id='$BATCH' AND matched_item_id IS NOT NULL)
GROUP BY fi.id, fi.name, fi.internal_code
HAVING COUNT(*) FILTER (WHERE fr.import_batch_id IS DISTINCT FROM '$BATCH' AND fr.status IN ('AVAILABLE','RESERVED')) > 0
ORDER BY other_active DESC
LIMIT 15;
SQL
