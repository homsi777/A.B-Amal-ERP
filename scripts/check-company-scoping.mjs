#!/usr/bin/env node
/**
 * فحص آلي (تقريري، غير حاجب) لاكتشاف استعلامات SQL في routes/services
 * تلمس جدولاً فيه company_id بدون أن يظهر company_id في نص الاستعلام نفسه.
 *
 * هذا فحص نصّي (heuristic) وليس تحليلاً دلالياً كاملاً — الهدف حصر
 * المرشّحين للمراجعة اليدوية، وليس إثبات صحة/خطأ قاطع لكل حالة.
 *
 * الاستخدام: node scripts/check-company-scoping.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'server/src/db/migrations');
const SCAN_DIRS = [path.join(ROOT, 'server/src/routes'), path.join(ROOT, 'server/src/services')];

// جداول نستثنيها عمداً من الفحص (لا تخص عزل بيانات شركة بعينها)
const EXCLUDE_TABLES = new Set([
  'schema_migrations',
  'companies',
  'roles',
  'permissions',
  'role_permissions',
]);

function findMatchingParen(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractCompanyScopedTables() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const scoped = new Set();
  const createTableRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gi;
  const alterAddColumnRe =
    /ALTER TABLE\s+(?:IF EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?company_id\b/gi;

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    let m;
    while ((m = createTableRe.exec(sql))) {
      const tableName = m[1].toLowerCase();
      const openParenIdx = m.index + m[0].length - 1;
      const closeParenIdx = findMatchingParen(sql, openParenIdx);
      if (closeParenIdx === -1) continue;
      const body = sql.slice(openParenIdx, closeParenIdx + 1);
      if (/\bcompany_id\b/i.test(body)) {
        scoped.add(tableName);
      }
    }

    while ((m = alterAddColumnRe.exec(sql))) {
      scoped.add(m[1].toLowerCase());
    }
  }

  for (const t of EXCLUDE_TABLES) scoped.delete(t);
  return scoped;
}

function listSourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(dir, f));
}

// يحاول التقاط استدعاءات .query(`...`) أو .query('...' أو .query(`\n...`, [...])
// ويجمع نص الاستعلام (حتى الفاصلة قبل مصفوفة الباراميترات أو القوس الختامي)
function extractQueryCalls(source) {
  const calls = [];
  const callRe = /\.query(?:<[^>]*>)?\s*\(\s*(`|'|")/g;
  let m;
  while ((m = callRe.exec(source))) {
    const quote = m[1];
    const startBody = m.index + m[0].length;
    let end = -1;
    if (quote === '`') {
      // backtick: قد يحتوي أسطر متعددة؛ نبحث عن أول backtick غير مسبوق بـ backslash
      let i = startBody;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '`') { end = i; break; }
        i++;
      }
    } else {
      let i = startBody;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { end = i; break; }
        if (source[i] === '\n') break; // سلسلة عادية لا تمتد لعدة أسطر
        i++;
      }
    }
    if (end === -1) continue;
    const text = source.slice(startBody, end);
    // رقم السطر
    const line = source.slice(0, m.index).split('\n').length;
    calls.push({ text, line });
  }
  return calls;
}

function tableNamesTouchedByQuery(queryText, scopedTables) {
  const touched = new Set();
  const re = /\b(FROM|INTO|UPDATE|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let m;
  while ((m = re.exec(queryText))) {
    const table = m[2].toLowerCase();
    if (scopedTables.has(table)) touched.add(table);
  }
  return touched;
}

function main() {
  const scopedTables = extractCompanyScopedTables();
  console.log(`[check-company-scoping] عدد الجداول المكتشفة كمرتبطة بـ company_id: ${scopedTables.size}`);

  const findings = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listSourceFiles(dir)) {
      const source = fs.readFileSync(file, 'utf8');
      const calls = extractQueryCalls(source);
      for (const call of calls) {
        const touched = tableNamesTouchedByQuery(call.text, scopedTables);
        if (touched.size === 0) continue;
        const hasCompanyId = /company_id/i.test(call.text);
        if (!hasCompanyId) {
          findings.push({
            file: path.relative(ROOT, file),
            line: call.line,
            tables: [...touched].join(', '),
            snippet: call.text.trim().slice(0, 120).replace(/\s+/g, ' '),
          });
        }
      }
    }
  }

  if (findings.length === 0) {
    console.log('[check-company-scoping] لم يُعثر على أي استعلام مشتبه به. ✔');
    return;
  }

  console.log(`\n[check-company-scoping] ${findings.length} استعلام يحتاج مراجعة يدوية:\n`);
  for (const f of findings) {
    console.log(`- ${f.file}:${f.line} [${f.tables}]`);
    console.log(`    ${f.snippet}...`);
  }
  console.log('\nملاحظة: هذا فحص نصّي تقريري (heuristic) — ليس كل نتيجة بالضرورة ثغرة حقيقية');
  console.log('(مثلاً استعلام يعتمد على id مُتحقَّق مسبقاً من شركته في نفس الطلب). راجع كل حالة يدوياً.');
}

main();
