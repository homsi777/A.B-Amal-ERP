#!/bin/bash
# READ-ONLY: compare Aleppo import source vs current DB for every roll
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
BATCH='2baf30aa-dae7-4d48-95f3-9d1778616256'

psql "$DATABASE_URL" <<SQL
\echo '========== SUMMARY: match vs mismatch =========='
WITH cmp AS (
  SELECT
    r.barcode,
    r.status,
    pir.normalized_data->>'materialName' AS excel_name,
    pir.normalized_data->>'materialCode' AS excel_code,
    fi.name AS db_name,
    fi.internal_code AS db_code,
    fi.supplier_code AS db_supplier,
    lower(trim(pir.normalized_data->>'materialName')) = lower(trim(fi.name)) AS name_ok,
    lower(trim(coalesce(pir.normalized_data->>'materialCode',''))) = lower(trim(fi.internal_code))
      OR lower(trim(coalesce(pir.normalized_data->>'materialCode',''))) = lower(trim(coalesce(fi.supplier_code,'')))
      OR (fi.internal_code LIKE 'IMP-AUTO-%' AND fi.supplier_code IS NOT NULL
          AND lower(trim(fi.supplier_code)) = lower(trim(coalesce(pir.normalized_data->>'materialCode',''))))
    AS code_ok
  FROM purchase_import_rows pir
  JOIN fabric_rolls r ON r.id = pir.created_roll_id
  JOIN fabric_items fi ON fi.id = r.item_id
  WHERE pir.batch_id = '$BATCH'
)
SELECT
  count(*) AS total_rolls,
  count(*) FILTER (WHERE name_ok AND code_ok) AS both_match,
  count(*) FILTER (WHERE NOT name_ok AND code_ok) AS name_only_wrong,
  count(*) FILTER (WHERE name_ok AND NOT code_ok) AS code_only_wrong,
  count(*) FILTER (WHERE NOT name_ok AND NOT code_ok) AS both_wrong
FROM cmp;

\echo '========== NAME mismatches (grouped) =========='
SELECT
  pir.normalized_data->>'materialName' AS excel_name,
  fi.name AS db_name,
  pir.normalized_data->>'materialCode' AS excel_code,
  fi.internal_code AS db_code,
  count(*) AS roll_count,
  count(*) FILTER (WHERE r.status IN ('AVAILABLE','RESERVED')) AS live_rolls
FROM purchase_import_rows pir
JOIN fabric_rolls r ON r.id = pir.created_roll_id
JOIN fabric_items fi ON fi.id = r.item_id
WHERE pir.batch_id = '$BATCH'
  AND lower(trim(pir.normalized_data->>'materialName')) <> lower(trim(fi.name))
GROUP BY 1,2,3,4
ORDER BY live_rolls DESC, roll_count DESC
LIMIT 40;

\echo '========== CODE mismatches (grouped) =========='
SELECT
  pir.normalized_data->>'materialName' AS excel_name,
  fi.name AS db_name,
  pir.normalized_data->>'materialCode' AS excel_code,
  fi.internal_code AS db_code,
  fi.supplier_code AS db_supplier,
  count(*) AS roll_count,
  count(*) FILTER (WHERE r.status IN ('AVAILABLE','RESERVED')) AS live_rolls
FROM purchase_import_rows pir
JOIN fabric_rolls r ON r.id = pir.created_roll_id
JOIN fabric_items fi ON fi.id = r.item_id
WHERE pir.batch_id = '$BATCH'
  AND NOT (
    lower(trim(coalesce(pir.normalized_data->>'materialCode',''))) = lower(trim(fi.internal_code))
    OR lower(trim(coalesce(pir.normalized_data->>'materialCode',''))) = lower(trim(coalesce(fi.supplier_code,'')))
    OR (fi.internal_code LIKE 'IMP-AUTO-%' AND fi.supplier_code IS NOT NULL
        AND lower(trim(fi.supplier_code)) = lower(trim(coalesce(pir.normalized_data->>'materialCode',''))))
  )
GROUP BY 1,2,3,4,5
ORDER BY live_rolls DESC, roll_count DESC
LIMIT 40;

\echo '========== Distinct materials: Excel vs DB side-by-side =========='
WITH excel AS (
  SELECT DISTINCT
    lower(trim(normalized_data->>'materialName')) AS k_name,
    normalized_data->>'materialName' AS excel_name,
    normalized_data->>'materialCode' AS excel_code,
    count(*) AS excel_rows
  FROM purchase_import_rows
  WHERE batch_id = '$BATCH'
  GROUP BY 1,2,3
),
db AS (
  SELECT DISTINCT
    lower(trim(pir.normalized_data->>'materialName')) AS k_name,
    fi.name AS db_name,
    fi.internal_code AS db_code,
    count(*) AS db_rolls
  FROM purchase_import_rows pir
  JOIN fabric_rolls r ON r.id = pir.created_roll_id
  JOIN fabric_items fi ON fi.id = r.item_id
  WHERE pir.batch_id = '$BATCH'
  GROUP BY 1,2,3
)
SELECT e.excel_name, e.excel_code, e.excel_rows,
       d.db_name, d.db_code, d.db_rolls,
       CASE WHEN lower(trim(e.excel_name)) = lower(trim(d.db_name))
            AND (
              lower(trim(coalesce(e.excel_code,''))) = lower(trim(d.db_code))
              OR d.db_code LIKE 'IMP-AUTO-%'
            ) THEN 'OK' ELSE 'DIFF' END AS status
FROM excel e
LEFT JOIN db d ON e.k_name = d.k_name
ORDER BY e.excel_name, e.excel_code
LIMIT 80;
SQL
