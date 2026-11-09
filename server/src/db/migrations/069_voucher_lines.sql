-- إضافية بحتة — جدول جديد لبنود السند (تقسيم سند قبض/دفع واحد على أكثر من
-- حساب خزينة/وسيلة دفع). سند قديم بلا أي صف هنا يبقى يعمل بالضبط كما اليوم
-- (vouchers.cashbox_id/amount/payment_method مباشرة) — وجود بنود هنا هو الحالة
-- الجديدة الاختيارية فقط. عمود check_id (لربط بند بشيك من خزينة الشيكات) يُضاف
-- لاحقاً بمigration جدول checks نفسه (070) تفادياً لمرجع أمامي على جدول غير موجود بعد.
CREATE TABLE voucher_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  voucher_id uuid NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  cashbox_id uuid NOT NULL REFERENCES cashboxes(id),
  payment_method text NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH', 'BANK', 'WALLET', 'CHECK')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency_code text NOT NULL DEFAULT 'USD',
  exchange_rate_to_usd numeric(14,6),
  amount_usd numeric(14,2),
  transaction_ref text,
  transaction_date date,
  attachment_image text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_voucher_lines_voucher ON voucher_lines(voucher_id);
CREATE INDEX idx_voucher_lines_cashbox ON voucher_lines(cashbox_id);
