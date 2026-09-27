-- ربط بنود الفاتورة (بيع/شراء) بدفعة خيط، مواز تماماً لـ fabric_roll_id —
-- بند واحد إما يشير لتوب (fabric_roll_id) أو لدفعة خيط (yarn_lot_id)، أبداً
-- الاثنين معاً.
ALTER TABLE sales_invoice_lines
  ADD COLUMN IF NOT EXISTS yarn_lot_id uuid REFERENCES yarn_lots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_inv_lines_yarn_lot ON sales_invoice_lines(company_id, yarn_lot_id)
  WHERE yarn_lot_id IS NOT NULL;

ALTER TABLE purchase_invoice_lines
  ADD COLUMN IF NOT EXISTS yarn_lot_id uuid REFERENCES yarn_lots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_inv_lines_yarn_lot ON purchase_invoice_lines(company_id, yarn_lot_id)
  WHERE yarn_lot_id IS NOT NULL;

-- توسعة مصدر لقطة التكلفة ليشمل دفعات الخيط، بنفس أسلوب التمديد المستخدم
-- سابقاً في migrations أخرى لقيود CHECK.
ALTER TABLE sales_invoice_lines DROP CONSTRAINT IF EXISTS sales_inv_lines_cost_source_chk;
ALTER TABLE sales_invoice_lines
  ADD CONSTRAINT sales_inv_lines_cost_source_chk CHECK (
    cost_source IS NULL OR cost_source IN (
      'FABRIC_ROLL_AT_CONFIRMATION',
      'YARN_LOT_AT_CONFIRMATION',
      'PURCHASE_LINE',
      'GL_COGS',
      'CURRENT_ROLL_COST_FALLBACK',
      'MISSING'
    )
  );
