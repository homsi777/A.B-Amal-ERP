-- Adds a default selling price on fabric_items so the bulk pricing screen can
-- maintain cost (on rolls) and selling price (on items) together in one place.

ALTER TABLE fabric_items
  ADD COLUMN IF NOT EXISTS default_selling_price numeric(14,4),
  ADD COLUMN IF NOT EXISTS default_selling_currency_code text NOT NULL DEFAULT 'USD';

CREATE INDEX IF NOT EXISTS idx_fabric_items_selling_price
  ON fabric_items(company_id)
  WHERE default_selling_price IS NOT NULL;
