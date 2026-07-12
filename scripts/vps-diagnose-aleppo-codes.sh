#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

psql "$DATABASE_URL" <<'SQL'
\echo '=== All ALEXANDRA fabric_items ==='
SELECT id, name, internal_code, supplier_code,
  (SELECT COUNT(*) FROM fabric_rolls r WHERE r.item_id=fi.id AND r.status IN ('AVAILABLE','RESERVED')) AS active
FROM fabric_items fi WHERE lower(name) LIKE '%alexandra%';

\echo '=== What API returns for active ALEXANDRA rolls ==='
SELECT fr.barcode, fi.name AS item_name, fi.internal_code, fi.supplier_code,
       fc_l2.name AS cat_l2_name, fc_l2.code AS cat_l2_code
FROM fabric_rolls fr
JOIN fabric_items fi ON fi.id = fr.item_id
LEFT JOIN fabric_categories fc_l1 ON fc_l1.company_id=fi.company_id AND lower(fc_l1.name)=lower(fi.name) AND fc_l1.parent_id IS NULL
LEFT JOIN fabric_categories fc_l2 ON fc_l2.parent_id=fc_l1.id AND lower(fc_l2.code) LIKE '%5130%' OR lower(fc_l2.name)='5130'
WHERE lower(fi.name) LIKE '%alexandra%' AND fr.status IN ('AVAILABLE','RESERVED')
LIMIT 10;

\echo '=== Stock import rows metadata (Aleppo batch) for alexandra/astrl ==='
SELECT normalized_data->>'itemName' AS item_name,
       normalized_data->>'itemCode' AS item_code,
       normalized_data->>'materialName' AS mat,
       normalized_data->>'supplierMaterialCode' AS sup,
       COUNT(*)
FROM stock_import_rows
WHERE batch_id = '2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND (
    coalesce(normalized_data->>'itemName','') ILIKE '%alexandra%'
    OR coalesce(normalized_data->>'itemName','') ILIKE '%astrl%'
    OR coalesce(normalized_data->>'materialName','') ILIKE '%alexandra%'
    OR coalesce(normalized_data->>'materialName','') ILIKE '%astrl%'
  )
GROUP BY 1,2,3,4;

\echo '=== fabric_items linked to IMP-AUTO codes ==='
SELECT name, internal_code, supplier_code,
  (SELECT COUNT(*) FROM fabric_rolls r WHERE r.item_id=fi.id AND r.status IN ('AVAILABLE','RESERVED')) active
FROM fabric_items fi
WHERE internal_code ILIKE 'IMP-AUTO%' OR internal_code ILIKE 'L2_%'
  AND (lower(name) LIKE '%alexandra%' OR lower(name) LIKE '%astrl%');
SQL
