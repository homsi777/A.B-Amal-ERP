/**
 * محلّل ملف بصمة الحضور (مثل "شيت الساعة - sewing.xlsx") — شيت واحد لكل يوم
 * بالتقويم، كل شيت بنفس الأعمدة: رقم البصمة/الاسم/التاريخ/الحضور/الانصراف/
 * التأخير/الإذن/إجمالي ساعات العمل. أعمدة التأخير/الإذن/الإجمالي غالباً فارغة
 * بالملف الخام (مراجع صيغ معطوبة بعد التصدير) — نحسب ساعات العمل من الحضور/
 * الانصراف مباشرة، ونترك التأخير/الإذن لمرحلة كشف الانتظام (تحتاج دوام مطلوب).
 */
import * as XLSX from 'xlsx';

export interface AttendanceParsedRow {
  fingerprintCode: string;
  nameInFile: string;
  attendanceDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  totalHours: number;
  sheetName: string;
}

export interface ParsedAttendanceFile {
  rows: AttendanceParsedRow[];
  sheetsProcessed: number;
  sheetsSkipped: string[];
}

const EXCEL_EPOCH_1900 = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const date = new Date(EXCEL_EPOCH_1900 + Math.floor(serial) * DAY_MS);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function excelFractionToTime(fraction: unknown): string | null {
  const n = Number(fraction);
  if (!Number.isFinite(n) || n < 0 || n >= 1) return null;
  const totalSeconds = Math.round(n * 86400);
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function hoursBetween(checkIn: string | null, checkOut: string | null): number {
  if (!checkIn || !checkOut) return 0;
  const [ih, im, is] = checkIn.split(':').map(Number);
  const [oh, om, os] = checkOut.split(':').map(Number);
  const inSeconds = ih * 3600 + im * 60 + is;
  let outSeconds = oh * 3600 + om * 60 + os;
  if (outSeconds < inSeconds) outSeconds += 86400; // شفت يعبر منتصف الليل
  return Math.round(((outSeconds - inSeconds) / 3600) * 100) / 100;
}

export async function parseAttendanceWorkbook(file: File): Promise<ParsedAttendanceFile> {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { cellDates: false });
  const rows: AttendanceParsedRow[] = [];
  const sheetsSkipped: string[] = [];
  let sheetsProcessed = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    if (raw.length < 3) {
      sheetsSkipped.push(sheetName);
      continue;
    }
    let foundAny = false;
    for (let i = 2; i < raw.length; i++) {
      const r = raw[i];
      const fingerprintCode = String(r[0] ?? '').trim();
      if (!fingerprintCode) continue;
      const attendanceDate = excelSerialToIsoDate(Number(r[2]));
      if (!attendanceDate) continue;
      const checkInTime = excelFractionToTime(r[3]);
      const checkOutTime = excelFractionToTime(r[4]);
      rows.push({
        fingerprintCode,
        nameInFile: String(r[1] ?? '').trim(),
        attendanceDate,
        checkInTime,
        checkOutTime,
        totalHours: hoursBetween(checkInTime, checkOutTime),
        sheetName,
      });
      foundAny = true;
    }
    if (foundAny) sheetsProcessed++;
    else sheetsSkipped.push(sheetName);
  }

  return { rows, sheetsProcessed, sheetsSkipped };
}
