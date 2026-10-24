-- شاشة بيانات أولية قبل "إنشاء مادة" (عملية إدخال خامة) — تحدد مسبقاً الجهة
-- المورّدة، المستودع، البيع الجماعي المرتبط، رقم أوردر تسلسلي للشركة، ونوع
-- الإجراء (مصنعية/مخزون/مرتجع/شراء)، وتربط كل الأتواب المُنشأة بعدها بهذه
-- العملية ليُنفَّذ الإجراء المطلوب تلقائياً عند الإنهاء. إضافي بالكامل — لا
-- يمس أي جدول أو تدفق موجود؛ إنشاء مادة بدون عملية إدخال (الوضع الحالي) يستمر
-- يعمل كما هو تماماً (العمود الجديد بـfabric_rolls اختياري/NULL).

-- "بيع جماعي" — سجل مستقل يُنشأ ويُدار من شاشته الخاصة، ثم يُختار من شاشة
-- عملية الإدخال. مفهوم جديد كلياً، غير مرتبط بأي جدول فواتير قائم بالمنطق
-- (invoice_id فقط مرجع توضيحي للفاتورة المذكورة، بلا أي تأثير محاسبي منه).
CREATE TABLE bulk_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id),
  sale_date date NOT NULL,
  notes text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bulk_sales_company ON bulk_sales(company_id);
CREATE INDEX idx_bulk_sales_customer ON bulk_sales(company_id, customer_id);

-- عملية إدخال الخامة — سطر واحد لكل مرة تُفتح الشاشة الأولية وتُحفظ.
-- bulk_sale_id فريد (UNIQUE) لأن كل بيع جماعي يُستخدَم لعملية واحدة فقط.
CREATE TABLE intake_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_no text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  bulk_sale_id uuid NOT NULL UNIQUE REFERENCES bulk_sales(id),
  action_type text NOT NULL CHECK (action_type IN ('PROCESSING', 'STOCK', 'RETURN', 'PURCHASE')),
  -- مطلوب فقط عند RETURN (فاتورة المرتجع تُخصَم من حساب هذا العميل).
  customer_id uuid REFERENCES customers(id),
  -- مطلوبان فقط عند PROCESSING (نفس حقلي مهمة المصنعية بالموديول الحالي).
  fabric_stage text CHECK (fabric_stage IS NULL OR fabric_stage IN ('RAW', 'FINISHED')),
  preparation_type_id uuid REFERENCES external_job_preparation_types(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COMPLETED', 'VOID')),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_operations_return_requires_customer
    CHECK (action_type <> 'RETURN' OR customer_id IS NOT NULL),
  CONSTRAINT intake_operations_processing_requires_fields
    CHECK (action_type <> 'PROCESSING' OR (fabric_stage IS NOT NULL AND preparation_type_id IS NOT NULL))
);

CREATE INDEX idx_intake_operations_company ON intake_operations(company_id, status);
CREATE INDEX idx_intake_operations_supplier ON intake_operations(company_id, supplier_id);

-- إرسالية بسيطة (بدون تسعير إلزامي عند الإنشاء) لإجرائي "مخزون" و"شراء" فقط —
-- "مصنعية" يستخدم موديول المهام الخارجية الموجود أصلاً (external_jobs)،
-- و"مرتجع" يستخدم فاتورة مرتجع حقيقية (return_invoices) — كلاهما موجود مسبقاً.
CREATE TABLE intake_dispatch_slips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  intake_operation_id uuid NOT NULL UNIQUE REFERENCES intake_operations(id),
  slip_no text NOT NULL,
  slip_type text NOT NULL CHECK (slip_type IN ('STOCK', 'PURCHASE')),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_intake_dispatch_slips_company ON intake_dispatch_slips(company_id);

-- بند الإرسالية — توب واحد لكل بند. unit_price/line_total قابلان للإدخال لاحقاً
-- (التسعير يصبح متاحاً بعد إنشاء الإرسالية، كما طُلب صريحاً) — NULL عند الإنشاء.
CREATE TABLE intake_dispatch_slip_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slip_id uuid NOT NULL REFERENCES intake_dispatch_slips(id) ON DELETE CASCADE,
  fabric_roll_id uuid NOT NULL REFERENCES fabric_rolls(id),
  unit_price numeric(12,4),
  line_total numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slip_id, fabric_roll_id)
);

CREATE INDEX idx_intake_dispatch_slip_lines_slip ON intake_dispatch_slip_lines(slip_id);

-- نتيجة تنفيذ الإجراء — واحد فقط من الثلاثة يُملأ، بحسب action_type. يُضاف
-- بعد إنشاء الجدولين المرجعيين لتفادي اعتماد دائري بين الجداول.
ALTER TABLE intake_operations
  ADD COLUMN result_external_job_id uuid REFERENCES external_jobs(id),
  ADD COLUMN result_dispatch_slip_id uuid REFERENCES intake_dispatch_slips(id),
  ADD COLUMN result_return_invoice_id uuid REFERENCES return_invoices(id);

-- يربط كل توب جديد بعملية الإدخال التي أُنشئ ضمنها (اختياري — NULL لكل
-- الأتواب المُنشأة بالطريقة العادية دون عملية إدخال، كما كانت دائماً).
ALTER TABLE fabric_rolls ADD COLUMN intake_operation_id uuid REFERENCES intake_operations(id);
CREATE INDEX idx_fabric_rolls_intake_operation ON fabric_rolls(intake_operation_id) WHERE intake_operation_id IS NOT NULL;
