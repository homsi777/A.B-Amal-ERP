-- External jobs (مهام خارجية) — send fabric rolls to a third party (e.g. a dye
-- house) and receive them back later, changed, against an optional fee owed
-- to the supplier. The job header is the "send" card; each line is one roll
-- and carries its own receipt fields, so partial receipt is just per-line
-- state — no separate receipt table needed.

CREATE TABLE external_jobs (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_no                  text        NOT NULL,
  supplier_id             uuid        NOT NULL REFERENCES suppliers(id),
  sent_date               date        NOT NULL DEFAULT current_date,
  notes                   text,
  fee_amount              numeric(14,4) CHECK (fee_amount >= 0),
  fee_currency_code       text        REFERENCES currencies(code),
  fee_exchange_rate_to_usd numeric(18,8),
  fee_posted_at           timestamptz,
  document_status         text        NOT NULL DEFAULT 'DRAFT'
                                       CHECK (document_status IN ('DRAFT','CONFIRMED','VOIDED')),
  created_by_user_id      uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT external_jobs_company_no UNIQUE (company_id, job_no)
);

CREATE INDEX idx_external_jobs_company        ON external_jobs(company_id);
CREATE INDEX idx_external_jobs_company_status ON external_jobs(company_id, document_status);
CREATE INDEX idx_external_jobs_supplier       ON external_jobs(supplier_id);

CREATE TABLE external_job_lines (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid        NOT NULL REFERENCES external_jobs(id) ON DELETE CASCADE,
  company_id          uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  roll_id             uuid        NOT NULL REFERENCES fabric_rolls(id),

  -- Snapshot taken at send time (confirm), so the job card stays stable even
  -- if the roll record is edited elsewhere before receipt.
  sent_color_id       uuid        REFERENCES fabric_colors(id),
  sent_length_m       numeric(14,3),
  sent_barcode        text,

  line_status         text        NOT NULL DEFAULT 'SENT'
                                   CHECK (line_status IN ('SENT','RECEIVED','CANCELLED')),

  -- Receipt fields — NULL until this line is received.
  received_at         timestamptz,
  received_by_user_id uuid        REFERENCES users(id) ON DELETE SET NULL,
  new_color_id        uuid        REFERENCES fabric_colors(id),
  new_barcode         text,
  new_length_m        numeric(14,3),
  receipt_notes       text,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_external_job_lines_job      ON external_job_lines(company_id, job_id);
CREATE INDEX idx_external_job_lines_roll     ON external_job_lines(company_id, roll_id);
CREATE INDEX idx_external_job_lines_status   ON external_job_lines(company_id, line_status);

-- fabric_rolls: a roll sent to an external job is neither available nor sold —
-- it must come back through receipt before it can be sold or transferred.
ALTER TABLE fabric_rolls DROP CONSTRAINT IF EXISTS fabric_rolls_status_check;
ALTER TABLE fabric_rolls ADD CONSTRAINT fabric_rolls_status_check CHECK (status IN (
  'AVAILABLE','RESERVED','SOLD','DAMAGED','TRANSFERRED','INACTIVE','AT_EXTERNAL_JOB'
));

-- inventory_movements: new movement types for send/return of external jobs.
ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_movement_type_check CHECK (movement_type IN (
  'OPENING','PURCHASE_RECEIPT','MANUAL_CREATE',
  'TRANSFER_OUT','TRANSFER_IN',
  'RESERVE','RELEASE_RESERVATION',
  'SALE','RETURN',
  'ADJUSTMENT','DAMAGE','STATUS_CHANGE',
  'EXTERNAL_JOB_SENT','EXTERNAL_JOB_RETURNED'
));

-- journal_entries: new source types for posting/reversing the external-job fee.
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_chk;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_chk CHECK (source_type IN (
  'VOUCHER', 'VOUCHER_REVERSAL', 'RETURN_INVOICE', 'RETURN_INVOICE_REVERSAL',
  'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT', 'PAYROLL_REVERSAL', 'MANUAL', 'OPENING', 'SYSTEM',
  'SALES_INVOICE', 'SALES_INVOICE_REVERSAL',
  'PURCHASE_INVOICE', 'PURCHASE_INVOICE_REVERSAL',
  'CUSTOMER_DISCOUNT', 'CUSTOMER_DISCOUNT_REVERSAL',
  'OPERATING_EXPENSE', 'OPERATING_EXPENSE_REVERSAL',
  'EXTERNAL_JOB_FEE', 'EXTERNAL_JOB_FEE_REVERSAL'
));
