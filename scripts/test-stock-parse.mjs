import * as fs from 'fs';
import { parseStockWorkbook } from '../src/lib/stockExcelImport.ts';

async function test(path) {
  const buf = fs.readFileSync(path);
  const file = {
    name: path,
    size: buf.length,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
  const preview = await parseStockWorkbook(file);
  const sheet = preview.sheets[0];
  console.log('\n====', path, '====');
  console.log('kind:', sheet.kind, 'colors:', sheet.distinctColorCount);
  console.log('headers:', sheet.rawHeaders);
  console.log('color breakdown:', JSON.stringify(sheet.colorBreakdown));
  for (const r of sheet.rows.slice(0, 5)) {
    console.log('row', r.rowIndex, {
      item: r.itemName,
      code: r.itemCode,
      color: r.colorName,
      colorTr: r.colorNameTr,
      colorCode: r.colorCode,
      qty: r.quantity,
      w: r.widthCm,
      wt: r.actualWeightKg,
    });
  }
}

for (const f of ['ahmet bereket.xls', 'فاتورة شراء.xls']) {
  if (fs.existsSync(f)) await test(f);
}
