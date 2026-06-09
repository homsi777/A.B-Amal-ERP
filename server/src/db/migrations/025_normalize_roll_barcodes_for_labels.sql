-- Normalize legacy/import-generated fabric roll barcodes to the official
-- 7-digit numeric sticker policy. This fixes old values like IMP-... that are
-- too long for thermal labels and invoice scanning.

WITH max_per_company AS (
  SELECT
    company_id,
    COALESCE(MAX(barcode::int), 999999) AS base_barcode
  FROM fabric_rolls
  WHERE barcode ~ '^[0-9]{7}$'
  GROUP BY company_id
),
targets AS (
  SELECT
    fr.id,
    fr.company_id,
    (
      COALESCE(m.base_barcode, 999999)
      + ROW_NUMBER() OVER (PARTITION BY fr.company_id ORDER BY fr.created_at, fr.id)
    )::int AS next_barcode
  FROM fabric_rolls fr
  LEFT JOIN max_per_company m ON m.company_id = fr.company_id
  WHERE fr.barcode IS NULL OR fr.barcode !~ '^[0-9]{7}$'
),
barcode_map AS (
  SELECT
    id,
    company_id,
    LPAD(next_barcode::text, 7, '0') AS new_barcode
  FROM targets
  WHERE next_barcode BETWEEN 1000000 AND 9999999
)
UPDATE fabric_rolls fr
SET barcode = bm.new_barcode,
    updated_at = now()
FROM barcode_map bm
WHERE fr.id = bm.id
  AND fr.company_id = bm.company_id;

UPDATE printed_labels pl
SET barcode = fr.barcode
FROM fabric_rolls fr
WHERE pl.roll_id = fr.id
  AND pl.company_id = fr.company_id
  AND pl.barcode IS DISTINCT FROM fr.barcode;
