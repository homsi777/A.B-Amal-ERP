-- تصحيحية — عمود تاريخ المستند بأرشيف كشف الحساب القديم كان من نوع `date`
-- الصارم، وملفات Excel القديمة تخزّن هذا التاريخ كرقم تسلسلي خام (Excel serial)
-- وليس نص تاريخ قابل للتحويل مباشرة، فكان أي صف رأس مستند (فاتورة/قيد) يُفشل
-- الإدراج بخطأ "invalid input syntax for type date". نحوّله لنص عادي — هذا
-- الجدول عرض أرشيفي فقط، لا حسابات تاريخية حقيقية تعتمد عليه.
ALTER TABLE customer_legacy_statement_entries
  ALTER COLUMN document_date TYPE text USING document_date::text;
