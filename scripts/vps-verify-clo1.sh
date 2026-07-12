#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" -c "SELECT r.barcode, fi.name, fi.internal_code, r.status FROM fabric_rolls r JOIN fabric_items fi ON fi.id=r.item_id WHERE r.barcode BETWEEN '1000133' AND '1000142' ORDER BY r.barcode;"
psql "$DATABASE_URL" -c "SELECT name, internal_code, supplier_code FROM fabric_items WHERE name ILIKE '%astrl%' OR internal_code ILIKE 'CLO-1';"
