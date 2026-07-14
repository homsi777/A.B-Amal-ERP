#!/bin/bash
# Dry-run report only: candidates where shared masters may have been mutated via roll edit.
# DOES NOT MODIFY DATA. Review before any repair.
set -euo pipefail
cd ~/ab-amal-erp
DATABASE_URL=$(python3 - <<'PY'
from pathlib import Path
for line in Path('server/.env').read_text().splitlines():
    if line.startswith('DATABASE_URL='):
        print(line.split('=', 1)[1].strip().strip('"').strip("'"))
        break
PY
)

echo "=== DRY-RUN: highly shared items (potential blast radius) ==="
psql "$DATABASE_URL" -c "
SELECT left(fi.id::text,8) AS item_short,
       left(fi.name,40) AS name,
       left(fi.internal_code,30) AS code,
       count(r.id) AS live_rolls,
       fi.updated_at
FROM fabric_items fi
JOIN fabric_rolls r ON r.item_id = fi.id AND r.company_id = fi.company_id
WHERE r.status = 'AVAILABLE'
GROUP BY fi.id
HAVING count(r.id) >= 20
ORDER BY live_rolls DESC
LIMIT 20;"

echo "=== DRY-RUN: shared colors (potential blast radius) ==="
psql "$DATABASE_URL" -c "
SELECT left(fc.id::text,8) AS color_short,
       left(coalesce(fc.name_ar,''),30) AS name,
       left(coalesce(fc.color_code,''),20) AS code,
       count(r.id) AS live_rolls,
       fc.updated_at
FROM fabric_colors fc
JOIN fabric_rolls r ON r.color_id = fc.id AND r.company_id = fc.company_id
WHERE r.status = 'AVAILABLE'
GROUP BY fc.id
HAVING count(r.id) >= 50
ORDER BY live_rolls DESC
LIMIT 20;"

echo "=== NOTE ==="
echo "No automatic data repair. Shared item_id/color_id across rolls is NORMAL."
echo "Damage occurs only when resolve mutated those shared masters during roll edit."
echo "Take pg_dump before any future repair script."
