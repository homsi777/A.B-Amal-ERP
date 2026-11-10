-- إضافية بحتة — أرشيف كشف حساب قديم للعملاء (عرض فقط، لا تأثير محاسبي). تُستورَد
-- هذه الجداول من ملفات Excel مُصدَّرة من برنامج محاسبي قديم ملغي عن الخدمة، وتُعرَض
-- للمراجعة فقط — لا FK من أي جدول محاسبي حقيقي (فواتير/سندات/GL) إليها، ولا FK منها
-- إلى أي جدول محاسبي حقيقي، فلا تأثير إطلاقاً على الفواتير/المخزون/حسابات العميل
-- الحية الحالية.
CREATE TABLE customer_legacy_statement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  sheet_name text,
  row_count integer NOT NULL DEFAULT 0,
  opening_balance_debit numeric(14,2) NOT NULL DEFAULT 0,
  opening_balance_credit numeric(14,2) NOT NULL DEFAULT 0,
  closing_balance_debit numeric(14,2) NOT NULL DEFAULT 0,
  closing_balance_credit numeric(14,2) NOT NULL DEFAULT 0,
  total_debit numeric(14,2) NOT NULL DEFAULT 0,
  total_credit numeric(14,2) NOT NULL DEFAULT 0,
  imported_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_legacy_statement_batches_customer
  ON customer_legacy_statement_batches(customer_id);

CREATE TABLE customer_legacy_statement_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES customer_legacy_statement_batches(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  header_row_index integer NOT NULL,
  document_type text,
  document_no text,
  document_date date,
  document_ref text,
  description text,
  unit_price numeric(14,2),
  quantity numeric(14,3),
  bonus numeric(14,3),
  piece_count numeric(14,3),
  line_total numeric(14,2),
  unit text,
  warehouse_name text,
  roll_lot_no text,
  item_code text,
  net_amount numeric(14,2),
  price_with_tax numeric(14,2),
  debit numeric(14,2) NOT NULL DEFAULT 0,
  credit numeric(14,2) NOT NULL DEFAULT 0,
  net_debit numeric(14,2) NOT NULL DEFAULT 0,
  net_credit numeric(14,2) NOT NULL DEFAULT 0,
  currency_code text,
  raw_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_legacy_statement_entries_batch
  ON customer_legacy_statement_entries(batch_id, row_index);
CREATE INDEX idx_customer_legacy_statement_entries_customer
  ON customer_legacy_statement_entries(customer_id, row_index);
