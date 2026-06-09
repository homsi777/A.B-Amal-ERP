-- Unit on return lines (meter/yard) for inventory math consistent with sales invoices
ALTER TABLE return_invoice_lines
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'meter';

ALTER TABLE return_invoice_lines DROP CONSTRAINT IF EXISTS return_invoice_lines_unit_chk;
ALTER TABLE return_invoice_lines
  ADD CONSTRAINT return_invoice_lines_unit_chk CHECK (unit IN ('meter', 'yard'));

UPDATE return_invoice_lines SET unit = 'meter' WHERE unit IS NULL OR unit NOT IN ('meter', 'yard');
