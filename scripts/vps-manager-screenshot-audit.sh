#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

BCS="3288701,3288702,3288817,3288818,3288712,3288826,3288827,3288828,3288829,3288830"

echo "=== 1) Screenshot barcodes — CURRENT DB (any status) ==="
psql "$DATABASE_URL" -c "
SELECT r.barcode, fi.name AS material, fi.internal_code, fi.supplier_code,
       r.status, r.length_m, r.updated_at::date,
       b.status AS import_batch, b.confirmed_at::date
FROM fabric_rolls r
LEFT JOIN fabric_items fi ON fi.id=r.item_id
LEFT JOIN purchase_import_rows pir ON pir.created_roll_id=r.id
LEFT JOIN purchase_import_batches b ON b.id=pir.batch_id
WHERE r.barcode IN ('3288701','3288702','3288817','3288818','3288712','3288826','3288827','3288828','3288829','3288830')
ORDER BY r.barcode;"

echo ""
echo "=== 2) Same barcodes in Excel file ==="
psql "$DATABASE_URL" -c "
SELECT DISTINCT ON (pir.normalized_data->>'barcode')
       pir.normalized_data->>'barcode' AS barcode,
       pir.normalized_data->>'materialName' AS excel_name,
       pir.normalized_data->>'supplierMaterialCode' AS excel_code,
       pir.normalized_data->>'colorNameTr' AS color
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id=pir.batch_id
WHERE b.file_name='AHMET BARAKAT SURYA 1.xls'
  AND pir.normalized_data->>'barcode' IN ('3288701','3288702','3288817','3288818','3288712','3288826','3288827','3288828','3288829','3288830')
ORDER BY pir.normalized_data->>'barcode', b.created_at DESC;"

echo ""
echo "=== 3) ASTRLI EKOSE / CLO-2 item — how many live rolls now? ==="
psql "$DATABASE_URL" -c "
SELECT fi.id, fi.name, fi.internal_code, fi.supplier_code,
       count(r.id) FILTER (WHERE r.status IN ('AVAILABLE','RESERVED')) AS live,
       count(r.id) AS total
FROM fabric_items fi
LEFT JOIN fabric_rolls r ON r.item_id=fi.id
WHERE fi.name ILIKE 'astrl%'
GROUP BY fi.id
ORDER BY live DESC, fi.name;"

echo ""
echo "=== 4) WİNTER SARDONLU / CLO-2 item — live rolls now? ==="
psql "$DATABASE_URL" -c "
SELECT fi.id, fi.name, fi.internal_code,
       count(r.id) FILTER (WHERE r.status IN ('AVAILABLE','RESERVED')) AS live,
       count(r.id) AS total
FROM fabric_items fi
LEFT JOIN fabric_rolls r ON r.item_id=fi.id
WHERE fi.name ILIKE '%sardonlu%' OR fi.internal_code ILIKE 'clo-2'
GROUP BY fi.id
ORDER BY live DESC;"

echo ""
echo "=== 5) Jul11 bad batch — how many WINTER rows matched ASTRLI? ==="
psql "$DATABASE_URL" -c "
SELECT count(*) AS winter_rows_on_astrli_item
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id=pir.batch_id
JOIN fabric_items fi ON fi.id=pir.matched_item_id
WHERE b.id='6a38ba26-15c7-4e13-9c9d-df64b07dec88'
  AND pir.normalized_data->>'materialName' ILIKE 'w%nter%sardonlu%'
  AND fi.name ILIKE 'astrl%';"
