-- Treasury cashbox transfers.
-- Operational transfer history is separate from vouchers because vouchers only
-- represent receipt/payment documents for parties.

CREATE TABLE cashbox_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  transfer_no text NOT NULL,
  transfer_date date NOT NULL DEFAULT (current_date),
  from_cashbox_id uuid NOT NULL REFERENCES cashboxes(id),
  to_cashbox_id uuid NOT NULL REFERENCES cashboxes(id),
  amount numeric(14,2) NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  notes text,
  status text NOT NULL DEFAULT 'DRAFT',
  created_by_user_id uuid REFERENCES users(id),
  confirmed_by_user_id uuid REFERENCES users(id),
  voided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  voided_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cashbox_transfers_company_no UNIQUE (company_id, transfer_no),
  CONSTRAINT cashbox_transfers_amount_chk CHECK (amount > 0),
  CONSTRAINT cashbox_transfers_distinct_boxes_chk CHECK (from_cashbox_id <> to_cashbox_id),
  CONSTRAINT cashbox_transfers_status_chk CHECK (status IN ('DRAFT', 'CONFIRMED', 'VOID'))
);

CREATE INDEX idx_cashbox_transfers_company ON cashbox_transfers(company_id);
CREATE INDEX idx_cashbox_transfers_company_date ON cashbox_transfers(company_id, transfer_date DESC);
CREATE INDEX idx_cashbox_transfers_from_box ON cashbox_transfers(company_id, from_cashbox_id);
CREATE INDEX idx_cashbox_transfers_to_box ON cashbox_transfers(company_id, to_cashbox_id);
CREATE INDEX idx_cashbox_transfers_status ON cashbox_transfers(company_id, status);
CREATE INDEX idx_cashbox_transfers_no ON cashbox_transfers(company_id, transfer_no);
