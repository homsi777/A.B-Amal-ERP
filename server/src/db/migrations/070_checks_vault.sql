-- إضافية بحتة — خزينة الشيكات: جدول الشيكات نفسها + سجل تغيّر حالتها، بالإضافة
-- لعمود ربط اختياري على voucher_lines (مؤجَّل من migration 069 تفادياً لمرجع
-- أمامي على جدول غير موجود وقتها).
CREATE TABLE checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  check_no text NOT NULL,
  bank_name text NOT NULL,
  account_holder_name text,
  party_type text CHECK (party_type IS NULL OR party_type IN ('CUSTOMER', 'SUPPLIER', 'OTHER')),
  party_id uuid,
  party_name text,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency_code text NOT NULL DEFAULT 'USD',
  received_date date NOT NULL DEFAULT current_date,
  due_date date NOT NULL,
  image_data text,
  -- RECEIVED: مستلم وغير محصّل (مستحق قريباً/متأخر حالتان مشتقّتان من due_date بالواجهة، لا تُخزَّنان)
  -- DEPOSITED: أُودع بالبنك | CLEARED: محصّل فعلياً | RETURNED: مرتجع | PAID_OUT: صُرف لمورد كوسيلة دفع
  status text NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED', 'DEPOSITED', 'CLEARED', 'RETURNED', 'PAID_OUT')),
  source_voucher_line_id uuid REFERENCES voucher_lines(id),
  used_in_voucher_line_id uuid REFERENCES voucher_lines(id),
  deposited_to_cashbox_id uuid REFERENCES cashboxes(id),
  needs_review boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, check_no, bank_name)
);

CREATE INDEX idx_checks_company_status ON checks(company_id, status);
CREATE INDEX idx_checks_due_date ON checks(company_id, due_date);
CREATE INDEX idx_checks_party ON checks(company_id, party_id) WHERE party_id IS NOT NULL;

CREATE TABLE check_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  changed_by_user_id uuid REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_check_status_history_check ON check_status_history(check_id);

ALTER TABLE voucher_lines ADD COLUMN check_id uuid REFERENCES checks(id);
