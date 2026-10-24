-- مطابقة كميات إرسال المصنعية مع فواتير الشراء الواردة لاحقاً من نفس المورد
-- (نفس الخامة، بصرف النظر عن اللون) — بالمتر، FIFO على مستوى كل سطر إرسال
-- (كل توب أُرسل)، عبر كل مهام المصنعية المفتوحة لهذا المورد وليس إرسالية
-- واحدة محددة. تسجيل/تقرير فقط بالكامل — لا تنشأ عنها أي حركة مخزون أو قيد
-- محاسبي بذاتها (المخزون والمحاسبة يتأثران فقط من فاتورة الشراء نفسها كما
-- كانا قبل هذا الملف تماماً).

ALTER TABLE external_job_lines
  ADD COLUMN matched_length_m numeric(14,3) NOT NULL DEFAULT 0
    CHECK (matched_length_m >= 0);

-- سجل كل عملية استهلاك على حدة (من فاتورة شراء، أو اعتماد نقص من المحاسب) —
-- يسمح بمعرفة بالضبط أي سطر إرسال اقتُطع لأي فاتورة، ويبقى الأساس الوحيد
-- لحساب "الكمية المتبقية لم ترد بعد" لكل سطر (sent_length_m - SUM matches).
CREATE TABLE external_job_line_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  external_job_line_id uuid NOT NULL REFERENCES external_job_lines(id),
  match_type text NOT NULL CHECK (match_type IN ('PURCHASE_INVOICE', 'SHORTAGE_APPROVED')),
  purchase_invoice_id uuid REFERENCES purchase_invoices(id),
  purchase_invoice_line_id uuid REFERENCES purchase_invoice_lines(id),
  matched_length_m numeric(14,3) NOT NULL CHECK (matched_length_m > 0),
  notes text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_job_line_matches_invoice_fields_check
    CHECK (match_type <> 'PURCHASE_INVOICE' OR (purchase_invoice_id IS NOT NULL AND purchase_invoice_line_id IS NOT NULL))
);

CREATE INDEX idx_ejlm_line ON external_job_line_matches(external_job_line_id);
CREATE INDEX idx_ejlm_company ON external_job_line_matches(company_id);
CREATE INDEX idx_ejlm_invoice ON external_job_line_matches(purchase_invoice_id) WHERE purchase_invoice_id IS NOT NULL;
