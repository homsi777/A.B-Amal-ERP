-- Customer orders: database-backed reservation/order registry.
-- These documents do not post financial/accounting entries by themselves.

CREATE TABLE customer_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_no text NOT NULL,
  order_date date NOT NULL DEFAULT (current_date),
  customer_id uuid NOT NULL REFERENCES customers(id),
  currency_code text NOT NULL DEFAULT 'USD',
  warehouse_label text,
  notes text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_supply', 'partial_ready', 'ready_pickup', 'completed', 'cancelled')),
  template_id uuid,
  expected_date date,
  advance_payment numeric(14,2) NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_orders_company_order_no UNIQUE (company_id, order_no),
  CONSTRAINT customer_orders_advance_chk CHECK (advance_payment >= 0)
);

CREATE INDEX idx_customer_orders_company ON customer_orders(company_id);
CREATE INDEX idx_customer_orders_company_date ON customer_orders(company_id, order_date DESC);
CREATE INDEX idx_customer_orders_customer ON customer_orders(company_id, customer_id);
CREATE INDEX idx_customer_orders_status ON customer_orders(company_id, status);
CREATE INDEX idx_customer_orders_expected ON customer_orders(company_id, expected_date)
  WHERE expected_date IS NOT NULL;

CREATE TABLE customer_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  material_name text NOT NULL DEFAULT '',
  dsam_number text NOT NULL DEFAULT '',
  roll_no text NOT NULL DEFAULT '',
  color_code text NOT NULL DEFAULT '',
  color_name text NOT NULL DEFAULT '',
  length numeric(14,3) NOT NULL DEFAULT 0,
  width_cm numeric(14,2) NOT NULL DEFAULT 0,
  gsm numeric(14,2) NOT NULL DEFAULT 0,
  weight numeric(14,3) NOT NULL DEFAULT 0,
  price numeric(14,4) NOT NULL DEFAULT 0,
  note text,
  image_url text,
  reference_barcode text,
  unit_type text NOT NULL DEFAULT 'meter' CHECK (unit_type IN ('meter', 'yard')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_order_lines_order_line UNIQUE (order_id, line_no),
  CONSTRAINT customer_order_lines_numbers_chk CHECK (
    length >= 0 AND width_cm >= 0 AND gsm >= 0 AND weight >= 0 AND price >= 0
  )
);

CREATE INDEX idx_customer_order_lines_order ON customer_order_lines(order_id);
CREATE INDEX idx_customer_order_lines_reference ON customer_order_lines(company_id, reference_barcode)
  WHERE reference_barcode IS NOT NULL;

CREATE TABLE customer_order_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_order_templates_company_name UNIQUE (company_id, name)
);

CREATE INDEX idx_customer_order_templates_company ON customer_order_templates(company_id);

CREATE TABLE customer_order_template_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES customer_order_templates(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  material_name text NOT NULL DEFAULT '',
  dsam_number text NOT NULL DEFAULT '',
  roll_no text NOT NULL DEFAULT '',
  color_code text NOT NULL DEFAULT '',
  color_name text NOT NULL DEFAULT '',
  length numeric(14,3) NOT NULL DEFAULT 0,
  width_cm numeric(14,2) NOT NULL DEFAULT 0,
  gsm numeric(14,2) NOT NULL DEFAULT 0,
  price numeric(14,4) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_order_template_lines_line UNIQUE (template_id, line_no),
  CONSTRAINT customer_order_template_lines_numbers_chk CHECK (
    length >= 0 AND width_cm >= 0 AND gsm >= 0 AND price >= 0
  )
);

CREATE INDEX idx_customer_order_template_lines_template ON customer_order_template_lines(template_id);
