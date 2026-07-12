#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
-- Fix CLO-1 item name for Aleppo HONEYCOMB→ASTRLI rows (134-143)
UPDATE fabric_items fi
SET name = 'ASTRLI EKOSE',
    supplier_code = 'CLO-1',
    updated_at = now()
FROM fabric_rolls r
WHERE r.item_id = fi.id
  AND r.barcode BETWEEN '1000133' AND '1000142';

SELECT r.barcode, fi.name, fi.internal_code, fi.supplier_code, r.status
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
WHERE r.barcode BETWEEN '1000133' AND '1000151'
ORDER BY r.barcode;
SQL
