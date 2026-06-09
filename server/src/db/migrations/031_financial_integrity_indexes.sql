-- Financial integrity: prevent duplicate cash refund movements per return invoice.
-- Reversal movements use source_type RETURN_INVOICE_REVERSAL (not covered by this index).

CREATE UNIQUE INDEX IF NOT EXISTS idx_cashbox_mov_return_refund_once
  ON cashbox_movements(company_id, source_type, source_id)
  WHERE source_type = 'RETURN_INVOICE'
    AND movement_type IN ('PAYMENT', 'RECEIPT');
