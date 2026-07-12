#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
\echo '=== ROYAL JAKAR items after repair ==='
SELECT name, internal_code, supplier_code,
  (SELECT COUNT(*) FROM fabric_rolls fr WHERE fr.item_id=fi.id AND fr.status IN ('AVAILABLE','RESERVED')) AS active
FROM fabric_items fi
WHERE lower(name) LIKE '%royal%jakar%'
ORDER BY internal_code;

\echo '=== WINTER / ASTRLI items ==='
SELECT name, internal_code, supplier_code,
  (SELECT COUNT(*) FROM fabric_rolls fr WHERE fr.item_id=fi.id AND fr.status IN ('AVAILABLE','RESERVED')) AS active
FROM fabric_items fi
WHERE lower(name) LIKE '%winter%' OR lower(name) LIKE '%astrl%'
ORDER BY name, internal_code;

\echo '=== KUMSAL kl-199 active rolls ==='
SELECT COUNT(*) FROM fabric_rolls fr
JOIN fabric_items fi ON fi.id=fr.item_id
WHERE fi.internal_code='kl-199' AND fr.status IN ('AVAILABLE','RESERVED');
SQL
