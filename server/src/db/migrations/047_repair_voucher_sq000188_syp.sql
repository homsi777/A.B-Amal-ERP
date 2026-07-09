-- إصلاح يدوي: سند قبض SQ000188 (#000188) — خالد لبابيدي
-- كان مسجّلاً USD 3,500,000 بينما المبلغ الفعلي 3,500,000 ليرة سورية.
-- يُطبَّق على قاعدة البيانات السحابية عند: npm run server:migrate

DO $$
DECLARE
  v_id uuid;
  v_company_id uuid;
  v_cashbox_id uuid;
  v_voucher_no text;
  v_old_amount numeric(14,2) := 3500000;
  v_new_currency text := 'SYP';
  v_new_rate numeric(18,6) := 13200;
  v_new_amount_usd numeric(14,2);
  v_entry_id uuid;
BEGIN
  SELECT v.id, v.company_id, v.cashbox_id, v.voucher_no
  INTO v_id, v_company_id, v_cashbox_id, v_voucher_no
  FROM vouchers v
  WHERE v.voucher_type = 'RECEIPT'
    AND v.status = 'CONFIRMED'
    AND v.currency_code = 'USD'
    AND v.amount = v_old_amount
    AND (
      v.voucher_no = 'SQ000188'
      OR v.voucher_no ~ '000188$'
      OR right(regexp_replace(v.voucher_no, '[^0-9]', '', 'g'), 6) = '000188'
    )
    AND (
      v.party_name ILIKE '%لبابيدي%'
      OR v.party_name ILIKE '%lababidi%'
      OR v.description ILIKE '%شام كاش%'
    )
  ORDER BY v.created_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    RAISE NOTICE '047: لم يُعثر على سند SQ000188 بحاجة للإصلاح (ربما أُصلح مسبقاً).';
    RETURN;
  END IF;

  SELECT COALESCE(er.exchange_rate_to_usd, v_new_rate)
  INTO v_new_rate
  FROM exchange_rates er
  WHERE er.company_id = v_company_id
    AND er.currency_code = 'SYP'
    AND er.is_active = true
  LIMIT 1;

  IF v_new_rate IS NULL OR v_new_rate <= 0 THEN
    v_new_rate := 13200;
  END IF;

  v_new_amount_usd := round((v_old_amount / v_new_rate)::numeric, 2);

  UPDATE vouchers
  SET
    currency_code = v_new_currency,
    exchange_rate_to_usd = v_new_rate,
    amount_usd = v_new_amount_usd,
    updated_at = now()
  WHERE id = v_id;

  UPDATE cashbox_movements
  SET
    currency_code = v_new_currency,
    exchange_rate_to_usd = v_new_rate,
    amount_usd = v_new_amount_usd
  WHERE source_type = 'VOUCHER'
    AND source_id = v_id;

  UPDATE party_activity_logs
  SET currency_code = v_new_currency
  WHERE reference_type = 'VOUCHER'
    AND reference_id = v_id;

  SELECT je.id
  INTO v_entry_id
  FROM journal_entries je
  WHERE je.company_id = v_company_id
    AND je.source_type = 'VOUCHER'
    AND je.source_id = v_id
  LIMIT 1;

  IF v_entry_id IS NOT NULL THEN
    UPDATE journal_lines
    SET
      debit = CASE WHEN debit = v_old_amount THEN v_new_amount_usd ELSE debit END,
      credit = CASE WHEN credit = v_old_amount THEN v_new_amount_usd ELSE credit END
    WHERE entry_id = v_entry_id
      AND (debit = v_old_amount OR credit = v_old_amount);
  END IF;

  RAISE NOTICE '047: تم إصلاح السند % — % SYP (≈ % USD، سعر %)',
    v_voucher_no, v_old_amount, v_new_amount_usd, v_new_rate;
END $$;
