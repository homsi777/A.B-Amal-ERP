/**
 * معاينة محلية لإشعار التسليم التفصيلي — بدون نشر.
 * التشغيل: npx tsx scripts/preview-invoice-statement.ts
 * ثم افتح: preview-output/invoice-statement-preview.html
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Invoice } from '../src/types';
import { renderInvoiceStatementA4Html } from '../src/lib/printing/renderInvoiceStatementA4';

const sampleInvoice: Invoice = {
  id: 'preview-1',
  date: '2026-06-18',
  type: 'sale',
  partyId: 'cust-1',
  invoiceNumber: 'FB0000004',
  currency: 'USD',
  warehouse: 'المستودع الرئيسي',
  notes: '',
  subtotal: 606,
  discountTotal: 0,
  taxTotal: 0,
  totalAmount: 606,
  paidAmount: 0,
  remainingAmount: 606,
  status: 'unpaid',
  items: [
    {
      fabricId: '1',
      quantity: 101,
      unitType: 'meter',
      unitPrice: 2,
      total: 202,
      materialName: 'GSM',
      designCode: '2012',
      colorCode: 'V1',
      colorName: 'أحمر',
      weightKg: 22.73,
      barcode: '100001',
      rollNo: 'LOT-001',
    },
    {
      fabricId: '2',
      quantity: 101,
      unitType: 'meter',
      unitPrice: 2,
      total: 202,
      materialName: 'Printed Fabric',
      designCode: '2012',
      colorCode: 'V1',
      colorName: 'أحمر',
      weightKg: 22.73,
      barcode: '100002',
      rollNo: 'LOT-002',
    },
    {
      fabricId: '3',
      quantity: 101,
      unitType: 'meter',
      unitPrice: 2,
      total: 202,
      materialName: 'Printed Fabric',
      designCode: '2012',
      colorCode: 'V2',
      colorName: 'أزرق',
      weightKg: 22.72,
      barcode: '100003',
      rollNo: 'LOT-003',
    },
  ],
};

const html = renderInvoiceStatementA4Html({
  invoice: sampleInvoice,
  partyName: 'أحمد',
  title: 'إشعار تسليم تفصيلي',
  subtitle: 'كشف الفاتورة',
});

const outDir = resolve(process.cwd(), 'preview-output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'invoice-statement-preview.html');
writeFileSync(outPath, html, 'utf8');

console.log('تم إنشاء المعاينة:');
console.log(outPath);
console.log('');
console.log('افتح الملف في المتصفح (Chrome / Edge) لمعاينة الطباعة قبل النشر.');
