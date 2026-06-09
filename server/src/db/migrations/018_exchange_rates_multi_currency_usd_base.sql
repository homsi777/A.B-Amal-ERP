-- Multi-currency exchange rate system (USD base) + USD base value columns
-- Rule: exchange_rate_to_usd = (units of currency) per 1 USD
-- Conversion: amount_usd = amount_original / exchange_rate_to_usd

-- 0) Ensure supported currencies exist in global currencies lookup (idempotent)
INSERT INTO currencies (code, name, symbol, is_active)
VALUES
  ('USD', 'دولار أمريكي', '$', true),
  ('SYP', 'ليرة سورية', 'ل.س', true),
  ('TRY', 'ليرة تركية', '₺', true),
  ('EGP', 'جنيه مصري', 'ج.م', true)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    symbol = EXCLUDED.symbol,
    is_active = EXCLUDED.is_active;

-- 1) Exchange rates per company (current rate only)
CREATE TABLE IF NOT EXISTS exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  currency_code text NOT NULL,
  currency_name_ar text NOT NULL,
  currency_name_en text,
  currency_symbol text,
  exchange_rate_to_usd numeric(18,6) NOT NULL,
  is_base boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT (current_date),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exchange_rates_rate_chk CHECK (exchange_rate_to_usd > 0),
  CONSTRAINT exchange_rates_company_currency_uq UNIQUE (company_id, currency_code)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_company ON exchange_rates(company_id);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_company_currency ON exchange_rates(company_id, currency_code);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_company_active ON exchange_rates(company_id, is_active);

-- 1.1) Seed default exchange rates for all companies (idempotent)
-- Defaults are initial values and MUST be reviewed by the user in Settings.
INSERT INTO exchange_rates (company_id, currency_code, currency_name_ar, currency_name_en, currency_symbol, exchange_rate_to_usd, is_base, is_active)
SELECT c.id, 'USD', 'دولار أمريكي', 'United States Dollar', '$', 1::numeric, true, true
FROM companies c
ON CONFLICT (company_id, currency_code) DO NOTHING;

INSERT INTO exchange_rates (company_id, currency_code, currency_name_ar, currency_name_en, currency_symbol, exchange_rate_to_usd, is_base, is_active)
SELECT c.id, 'SYP', 'ليرة سورية', 'Syrian Pound', 'ل.س', 15000::numeric, false, true
FROM companies c
ON CONFLICT (company_id, currency_code) DO NOTHING;

INSERT INTO exchange_rates (company_id, currency_code, currency_name_ar, currency_name_en, currency_symbol, exchange_rate_to_usd, is_base, is_active)
SELECT c.id, 'TRY', 'ليرة تركية', 'Turkish Lira', '₺', 32::numeric, false, true
FROM companies c
ON CONFLICT (company_id, currency_code) DO NOTHING;

INSERT INTO exchange_rates (company_id, currency_code, currency_name_ar, currency_name_en, currency_symbol, exchange_rate_to_usd, is_base, is_active)
SELECT c.id, 'EGP', 'جنيه مصري', 'Egyptian Pound', 'ج.م', 50::numeric, false, true
FROM companies c
ON CONFLICT (company_id, currency_code) DO NOTHING;

-- 2) Document table additions (store original + USD base values; do not recalculate old docs silently)

-- 2.1) Sales invoices
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS exchange_rate_to_usd numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subtotal_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_total_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount_usd numeric(14,2) NOT NULL DEFAULT 0;

UPDATE sales_invoices
SET
  exchange_rate_to_usd = COALESCE(exchange_rate_to_usd, 1),
  subtotal_usd = COALESCE(subtotal_usd, subtotal),
  discount_total_usd = COALESCE(discount_total_usd, discount_total),
  tax_total_usd = COALESCE(tax_total_usd, tax_total),
  total_amount_usd = COALESCE(total_amount_usd, total_amount),
  paid_amount_usd = COALESCE(paid_amount_usd, paid_amount),
  remaining_amount_usd = COALESCE(remaining_amount_usd, remaining_amount)
WHERE
  subtotal_usd = 0
  AND discount_total_usd = 0
  AND tax_total_usd = 0
  AND total_amount_usd = 0
  AND paid_amount_usd = 0
  AND remaining_amount_usd = 0;

-- 2.2) Purchase invoices
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS exchange_rate_to_usd numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subtotal_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_total_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount_usd numeric(14,2) NOT NULL DEFAULT 0;

UPDATE purchase_invoices
SET
  exchange_rate_to_usd = COALESCE(exchange_rate_to_usd, 1),
  subtotal_usd = COALESCE(subtotal_usd, subtotal),
  discount_total_usd = COALESCE(discount_total_usd, discount_total),
  tax_total_usd = COALESCE(tax_total_usd, tax_total),
  total_amount_usd = COALESCE(total_amount_usd, total_amount),
  paid_amount_usd = COALESCE(paid_amount_usd, paid_amount),
  remaining_amount_usd = COALESCE(remaining_amount_usd, remaining_amount)
WHERE
  subtotal_usd = 0
  AND discount_total_usd = 0
  AND tax_total_usd = 0
  AND total_amount_usd = 0
  AND paid_amount_usd = 0
  AND remaining_amount_usd = 0;

-- 2.3) Invoice lines (optional but useful)
ALTER TABLE sales_invoice_lines
  ADD COLUMN IF NOT EXISTS unit_price_usd numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_discount_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_tax_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_total_usd numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE purchase_invoice_lines
  ADD COLUMN IF NOT EXISTS unit_cost_usd numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_discount_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_tax_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_total_usd numeric(14,2) NOT NULL DEFAULT 0;

-- 2.4) Vouchers
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS exchange_rate_to_usd numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS amount_usd numeric(14,2) NOT NULL DEFAULT 0;

UPDATE vouchers
SET
  exchange_rate_to_usd = COALESCE(exchange_rate_to_usd, 1),
  amount_usd = COALESCE(NULLIF(amount_usd, 0), amount)
WHERE amount_usd = 0;

-- 2.5) Cashbox movements
ALTER TABLE cashbox_movements
  ADD COLUMN IF NOT EXISTS exchange_rate_to_usd numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS amount_usd numeric(14,2) NOT NULL DEFAULT 0;

UPDATE cashbox_movements
SET
  exchange_rate_to_usd = COALESCE(exchange_rate_to_usd, 1),
  amount_usd = COALESCE(NULLIF(amount_usd, 0), amount)
WHERE amount_usd = 0;

-- 2.6) Return invoices (used by statements + GL)
ALTER TABLE return_invoices
  ADD COLUMN IF NOT EXISTS exchange_rate_to_usd numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subtotal_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_total_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount_usd numeric(14,2) NOT NULL DEFAULT 0;

UPDATE return_invoices
SET
  exchange_rate_to_usd = COALESCE(exchange_rate_to_usd, 1),
  subtotal_usd = COALESCE(NULLIF(subtotal_usd, 0), subtotal),
  discount_total_usd = COALESCE(NULLIF(discount_total_usd, 0), discount_total),
  tax_total_usd = COALESCE(NULLIF(tax_total_usd, 0), tax_total),
  total_amount_usd = COALESCE(NULLIF(total_amount_usd, 0), total_amount)
WHERE total_amount_usd = 0;

ALTER TABLE return_invoice_lines
  ADD COLUMN IF NOT EXISTS unit_price_usd numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_total_usd numeric(14,2) NOT NULL DEFAULT 0;

-- 2.7) Cashbox transfers (treasury transfers)
ALTER TABLE cashbox_transfers
  ADD COLUMN IF NOT EXISTS exchange_rate_to_usd numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS amount_usd numeric(14,2) NOT NULL DEFAULT 0;

UPDATE cashbox_transfers
SET
  exchange_rate_to_usd = COALESCE(exchange_rate_to_usd, 1),
  amount_usd = COALESCE(NULLIF(amount_usd, 0), amount)
WHERE amount_usd = 0;

