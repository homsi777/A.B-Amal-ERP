-- Correct cashbox currency when the name indicates Syrian/Turkish/Egyptian pound
-- but currency_code was left as USD (common misconfiguration).

UPDATE cashboxes
SET currency_code = 'SYP', updated_at = now()
WHERE is_active = true
  AND currency_code = 'USD'
  AND (
    name ILIKE '%لير%سور%'
    OR name ILIKE '%ليره%سور%'
    OR name ILIKE '%ليرة%سور%'
    OR name ILIKE '%syrian%'
    OR name ILIKE '%syp%'
  );

UPDATE cashboxes
SET currency_code = 'TRY', updated_at = now()
WHERE is_active = true
  AND currency_code = 'USD'
  AND (
    name ILIKE '%لير%ترك%'
    OR name ILIKE '%ليرة%ترك%'
    OR name ILIKE '%turkish%'
    OR name ILIKE '%try%'
  );

UPDATE cashboxes
SET currency_code = 'EGP', updated_at = now()
WHERE is_active = true
  AND currency_code = 'USD'
  AND (
    name ILIKE '%جنيه%مصر%'
    OR name ILIKE '%egypt%'
    OR name ILIKE '%egp%'
  );
