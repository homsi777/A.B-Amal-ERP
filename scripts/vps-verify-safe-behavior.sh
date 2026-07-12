#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

echo "=== API health ==="
curl -s http://127.0.0.1:4020/api/health/live
echo ""

echo "=== No new confirmed SURYA import ==="
psql "$DATABASE_URL" -c "
SELECT count(*) AS confirmed_after_restore
FROM purchase_import_batches
WHERE file_name='AHMET BARAKAT SURYA 1.xls'
  AND status='CONFIRMED'
  AND confirmed_at > '2026-07-12 20:26:11+00';"

echo ""
echo "=== Screenshot barcodes remain absent ==="
psql "$DATABASE_URL" -c "
SELECT count(*) AS screenshot_barcodes_present
FROM fabric_rolls
WHERE barcode IN
 ('3288701','3288702','3288817','3288818','3288712',
  '3288826','3288827','3288828','3288829','3288830');"

echo ""
echo "=== Duplicate CLO-2 materials remain separate ==="
psql "$DATABASE_URL" -c "
SELECT name, internal_code, supplier_code,
       count(r.id) FILTER (WHERE r.status IN ('AVAILABLE','RESERVED')) AS live
FROM fabric_items fi
LEFT JOIN fabric_rolls r ON r.item_id=fi.id
WHERE lower(trim(fi.internal_code))='clo-2'
   OR lower(trim(coalesce(fi.supplier_code,'')))='clo-2'
GROUP BY fi.id, fi.name, fi.internal_code, fi.supplier_code
ORDER BY name;"

echo ""
echo "=== Category L1/L2 paths for CLO-2 ==="
psql "$DATABASE_URL" -c "
SELECT p.name AS material_name, c.name AS code_name, c.code AS code,
       count(fi.id) AS explicitly_linked_items
FROM fabric_categories c
JOIN fabric_categories p ON p.id=c.parent_id
LEFT JOIN fabric_items fi
  ON fi.company_id=c.company_id
 AND fi.category_id IN (p.id, c.id)
 AND lower(trim(fi.name))=lower(trim(p.name))
WHERE lower(trim(COALESCE(NULLIF(c.code,''),c.name)))='clo-2'
GROUP BY p.id,p.name,c.id,c.name,c.code
ORDER BY p.name;"

echo ""
echo "=== Protected stock references ==="
psql "$DATABASE_URL" -c "
SELECT r.barcode, fi.name, fi.internal_code, r.status, r.length_m
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id=r.item_id
WHERE r.barcode IN ('1000143','1000150')
ORDER BY r.barcode;"
