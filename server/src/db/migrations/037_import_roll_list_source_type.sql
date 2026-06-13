-- السماح بنوع مصدر Roll List (أعمدة ROLL NO | M | Y متوازية مثل COLOMBIA)

ALTER TABLE purchase_import_batches DROP CONSTRAINT IF EXISTS purchase_import_batches_source_type_check;
ALTER TABLE purchase_import_batches
  ADD CONSTRAINT purchase_import_batches_source_type_check
  CHECK (source_type IN (
    'PURCHASE_INVOICE',
    'OPENING_STOCK',
    'DIRECT_STOCK_IMPORT',
    'CHINA_PACKING_LIST',
    'ROLL_LIST_M_Y',
    'STOCK_IMPORT'
  ));
