/**
 * Desktop Settings — embedded inside System Settings as the "تطبيق سطح المكتب" tab.
 *
 * The component exports two flavors:
 *   - DesktopSettingsBody : embedded inside another page (no own header/topbar)
 *   - DesktopSettings     : standalone page wrapper kept for legacy /settings/desktop redirects
 *
 * Electron features:
 *  - List Windows printers and select default label printer
 *  - Enable/disable silent label printing
 *  - Set default label dimensions (mm)
 *  - Backend API URL configuration + connection test
 *
 * In browser mode: shows notices for Electron-only features.
 * No PostgreSQL / DB credentials shown or stored here.
 */

import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Server, Wifi, WifiOff, Save, RefreshCw, Printer,
  Monitor, CheckCircle2, AlertTriangle, Info, ToggleLeft, ToggleRight,
  Tag, FileText, TestTube2,
} from 'lucide-react';
import { getApiBaseUrl, setApiBaseUrl } from '../../lib/api/client';
import { useElectronSettings } from '../../lib/electron/useElectronSettings';
import type { PrinterInfo } from '../../electron-env.d';
import { buildSingleRollPrintHtml } from '../../components/labels/LabelCard';
import { generateQrSvg } from '../../lib/printing/qrGenerator';

type ConnectionStatus = 'idle' | 'testing' | 'ok' | 'error';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Body of the Desktop Settings — meant to be embedded inside System Settings.
 * No outer page header, no breadcrumb. Only its own form sections.
 */
export const DesktopSettingsBody: React.FC = () => {
  const { settings, loading, updateSettings, isElectron } = useElectronSettings();

  // API URL state
  const [apiUrl, setApiUrl] = useState('');
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('idle');
  const [connMessage, setConnMessage] = useState('');

  // Printer state
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printersLoading, setPrintersLoading] = useState(false);
  const [testPrintStatus, setTestPrintStatus] = useState<'idle' | 'printing' | 'ok' | 'error'>('idle');
  const [testPrintMsg, setTestPrintMsg] = useState('');

  // Local form state
  const [labelPrinter, setLabelPrinter] = useState('');
  const [a4Printer, setA4Printer] = useState('');
  const [silentLabel, setSilentLabel] = useState(false);
  const [silentA4, setSilentA4] = useState(false);
  const [widthMm, setWidthMm] = useState(100);
  const [heightMm, setHeightMm] = useState(80);
  const [printMode, setPrintMode] = useState<'A4' | 'ROLL_LABEL'>('ROLL_LABEL');

  // Save state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // Populate form from settings
  useEffect(() => {
    if (!settings) return;
    const url = settings.apiBaseUrl || getApiBaseUrl();
    setApiUrl(url);
    setLabelPrinter(settings.defaultLabelPrinterName ?? '');
    setA4Printer(settings.defaultA4PrinterName ?? '');
    setSilentLabel(settings.silentLabelPrintingEnabled ?? false);
    setSilentA4(settings.silentA4PrintingEnabled ?? false);
    setWidthMm(settings.labelWidthMm ?? 100);
    setHeightMm(settings.labelHeightMm ?? 80);
    setPrintMode(settings.defaultPrintMode ?? 'ROLL_LABEL');
  }, [settings]);

  const loadPrinters = async () => {
    if (!isElectron || !window.fabricApp) return;
    setPrintersLoading(true);
    try {
      const list = await window.fabricApp.listPrinters();
      setPrinters(list);
    } catch {
      setPrinters([]);
    } finally {
      setPrintersLoading(false);
    }
  };

  useEffect(() => {
    if (isElectron) loadPrinters();
  }, [isElectron]);

  const handleTestConnection = async () => {
    if (!apiUrl.trim()) return;
    setConnStatus('testing');
    setConnMessage('');
    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()) as { status?: string };
        setConnStatus('ok');
        setConnMessage(`متصل — الحالة: ${data.status ?? 'ok'}`);
      } else {
        setConnStatus('error');
        setConnMessage(`فشل الاتصال — HTTP ${res.status}`);
      }
    } catch (err: unknown) {
      setConnStatus('error');
      setConnMessage(`تعذر الاتصال — ${err instanceof Error ? err.message : 'خطأ في الشبكة'}`);
    }
  };

  const handleTestPrint = async () => {
    if (!isElectron || !window.fabricApp || !labelPrinter) return;
    setTestPrintStatus('printing');
    setTestPrintMsg('');
    const testHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><style>
body { font-family: 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
.box { border: 2px solid #1e293b; padding: 10mm; border-radius: 3mm; text-align: center; }
h2 { color: #1e40af; margin: 0 0 5mm; }
p { margin: 2mm 0; font-size: 10pt; }
</style></head>
<body><div class="box">
<h2 style="letter-spacing:3px;">CLOTEX</h2>
<p style="font-size:9pt;letter-spacing:4px;color:#64748b;margin-top:-2mm;">CLOTHES TEXTILE</p>
<p>اختبار الطابعة: ${labelPrinter}</p>
<p style="font-size:8pt;color:#64748b">${new Date().toLocaleDateString('ar-SA')}</p>
</div></body></html>`;
    try {
      const res = await window.fabricApp.printHtml(testHtml, {
        printerName: labelPrinter,
        silent: true,
        pageSize: 'ROLL_LABEL',
        widthMm,
        heightMm,
        printBackground: true,
        scaleFactor: 100,
      });
      if (res.ok) {
        setTestPrintStatus('ok');
        setTestPrintMsg('تم اختبار الطباعة بنجاح ✓');
      } else {
        setTestPrintStatus('error');
        setTestPrintMsg(res.error ?? 'فشل اختبار الطباعة');
      }
    } catch {
      setTestPrintStatus('error');
      setTestPrintMsg('خطأ غير متوقع أثناء اختبار الطباعة');
    }
  };

  /** طباعة نموذج لصاقة ثوب بنفس قالب الإنتاج (100×80 افتراضياً) — للمعايرة */
  const handleSampleRollLabelPrint = async () => {
    if (!isElectron || !window.fabricApp || !labelPrinter) return;
    setTestPrintStatus('printing');
    setTestPrintMsg('');
    try {
      const qrSvg = await generateQrSvg('CLOTEX-CAL-SAMPLE', { size: 220, margin: 0 });
      const html = buildSingleRollPrintHtml(
        {
          barcode: '597089894496',
          qrPayload: 'CLOTEX-CAL-SAMPLE',
          rollNo: '597089894496',
          itemName: '101',
          internalCode: '101',
          colorNameAr: 'احمر',
          colorCode: 'v-1',
          lengthM: 96,
          actualWeightKg: 21.6,
          batchNo: '597089894496',
        },
        { widthMm, heightMm, qrSvg },
      );
      const res = await window.fabricApp.printHtml(html, {
        printerName: labelPrinter,
        silent: true,
        pageSize: 'ROLL_LABEL',
        widthMm,
        heightMm,
        printBackground: true,
        scaleFactor: 100,
      });
      if (res.ok) {
        setTestPrintStatus('ok');
        setTestPrintMsg('تم طباعة نموذج اللصاقة ✓');
      } else {
        setTestPrintStatus('error');
        setTestPrintMsg(res.error ?? 'فشل طباعة النموذج');
      }
    } catch {
      setTestPrintStatus('error');
      setTestPrintMsg('خطأ أثناء طباعة نموذج اللصاقة');
    }
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      const cleanUrl = apiUrl.replace(/\/$/, '').trim();
      setApiBaseUrl(cleanUrl);

      await updateSettings({
        apiBaseUrl: cleanUrl,
        defaultLabelPrinterName: labelPrinter || null,
        defaultA4PrinterName: a4Printer || null,
        silentLabelPrintingEnabled: silentLabel,
        silentA4PrintingEnabled: silentA4,
        labelWidthMm: widthMm,
        labelHeightMm: heightMm,
        defaultPrintMode: printMode,
      });

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');
    }
  };

  const inputCls = 'w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm';
  const sectionCard = 'bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Embedded sub-header — no top-level page chrome (the host page provides it) */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-slate-900">تطبيق سطح المكتب</h3>
          <p className="text-xs text-slate-500 mt-0.5">تهيئة الاتصال، الطابعات، والطباعة الصامتة</p>
        </div>
        {isElectron && (
          <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-xs font-bold">
            <Monitor className="w-3 h-3" /> Windows Desktop
          </span>
        )}
      </div>

      {/* Browser-only notice */}
      {!isElectron && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <strong>ملاحظة:</strong> قائمة الطابعات والطباعة الصامتة متاحة داخل تطبيق Windows فقط.
            في وضع المتصفح، يُستخدم متغير البيئة <code className="bg-amber-100 px-1 rounded text-xs">VITE_API_BASE_URL</code> مع localStorage.
          </p>
        </div>
      )}

      {/* ── Silent Label Printing ── */}
      <div className={sectionCard}>
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Tag className="w-4 h-4 text-slate-500" />
          <h3 className="font-bold text-slate-800 text-sm">إعدادات الطباعة الصامتة للصاقات</h3>
        </div>

        {/* Default label printer */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">طابعة اللصاقات الافتراضية</label>
          {isElectron ? (
            <div className="flex gap-2">
              <select
                value={labelPrinter}
                onChange={(e) => setLabelPrinter(e.target.value)}
                className={`${inputCls} flex-1`}
                disabled={printersLoading}
              >
                <option value="">— لا توجد طابعة محددة —</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName || p.name}{p.isDefault ? ' ★' : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={loadPrinters}
                disabled={printersLoading}
                className="px-3 py-2 border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 transition disabled:opacity-50 flex-shrink-0"
                title="تحديث قائمة الطابعات"
              >
                <RefreshCw className={`w-4 h-4 ${printersLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-500">
              <Printer className="w-4 h-4" />
              قائمة الطابعات متاحة فقط داخل تطبيق Windows
            </div>
          )}
          {printers.length === 0 && isElectron && !printersLoading && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              لم يتم العثور على طابعات. تأكد من تثبيت طابعة على هذا الجهاز.
            </p>
          )}
        </div>

        {/* Silent label printing toggle */}
        <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3">
          <div>
            <p className="font-bold text-sm text-slate-800">تفعيل الطباعة الصامتة للصاقات</p>
            <p className="text-xs text-slate-500 mt-0.5">
              ترسَل اللصاقات مباشرة إلى الطابعة دون إظهار نافذة الطباعة
            </p>
          </div>
          <button
            onClick={() => setSilentLabel(!silentLabel)}
            disabled={!isElectron}
            className="disabled:opacity-40"
          >
            {silentLabel
              ? <ToggleRight className="w-10 h-10 text-emerald-500" />
              : <ToggleLeft className="w-10 h-10 text-slate-300" />}
          </button>
        </div>

        {silentLabel && !labelPrinter && isElectron && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            الطباعة الصامتة مفعّلة لكن لم يتم تحديد طابعة لصاقات. يرجى اختيار طابعة.
          </div>
        )}

        {/* Label dimensions */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600">عرض اللصاقة (mm)</label>
            <input
              type="number"
              min={30} max={300}
              value={widthMm}
              onChange={(e) => setWidthMm(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600">ارتفاع اللصاقة (mm)</label>
            <input
              type="number"
              min={20} max={300}
              value={heightMm}
              onChange={(e) => setHeightMm(Number(e.target.value))}
              className={inputCls}
            />
          </div>
        </div>

        {/* Test print */}
        {isElectron && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleTestPrint}
              disabled={!labelPrinter || testPrintStatus === 'printing'}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl text-sm text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
            >
              {testPrintStatus === 'printing'
                ? <RefreshCw className="w-4 h-4 animate-spin" />
                : <TestTube2 className="w-4 h-4" />}
              اختبار الطباعة
            </button>
            <button
              type="button"
              onClick={handleSampleRollLabelPrint}
              disabled={!labelPrinter || testPrintStatus === 'printing'}
              className="flex items-center gap-2 px-4 py-2 border border-indigo-200 bg-indigo-50/80 rounded-xl text-sm text-indigo-900 hover:bg-indigo-100 transition disabled:opacity-50"
              title="طباعة نموذج لصاقة ثوب (قالب CLOTEX الفعلي)"
            >
              <Tag className="w-4 h-4" />
              نموذج لصاقة 100×80
            </button>
            {testPrintStatus === 'ok' && (
              <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> {testPrintMsg}
              </span>
            )}
            {testPrintStatus === 'error' && (
              <span className="text-xs text-rose-600 font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> {testPrintMsg}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── A4 Printing ── */}
      <div className={sectionCard}>
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <FileText className="w-4 h-4 text-slate-500" />
          <h3 className="font-bold text-slate-800 text-sm">إعدادات طباعة A4</h3>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">طابعة A4 الافتراضية (اختياري)</label>
          {isElectron ? (
            <select value={a4Printer} onChange={(e) => setA4Printer(e.target.value)} className={inputCls}>
              <option value="">— نفس طابعة اللصاقات / الافتراضية —</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name}{p.isDefault ? ' ★' : ''}
                </option>
              ))}
            </select>
          ) : (
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-500">
              متاحة داخل تطبيق Windows فقط
            </div>
          )}
        </div>

        <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3">
          <div>
            <p className="font-bold text-sm text-slate-800">تفعيل الطباعة الصامتة لـ A4</p>
            <p className="text-xs text-slate-500 mt-0.5">طباعة صفحات A4 مباشرةً بدون حوار</p>
          </div>
          <button
            onClick={() => setSilentA4(!silentA4)}
            disabled={!isElectron}
            className="disabled:opacity-40"
          >
            {silentA4
              ? <ToggleRight className="w-10 h-10 text-emerald-500" />
              : <ToggleLeft className="w-10 h-10 text-slate-300" />}
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">وضع الطباعة الافتراضي</label>
          <select value={printMode} onChange={(e) => setPrintMode(e.target.value as 'A4' | 'ROLL_LABEL')} className={inputCls}>
            <option value="ROLL_LABEL">لصاقة منفصلة (100×80mm)</option>
            <option value="A4">A4 — طباعة متعددة في ورقة واحدة</option>
          </select>
        </div>
      </div>

      {/* ── API URL ── */}
      <div className={sectionCard}>
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Server className="w-4 h-4 text-slate-500" />
          <h3 className="font-bold text-slate-800 text-sm">رابط خادم الـ API</h3>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">رابط الخادم</label>
          <input
            type="url"
            value={apiUrl}
            onChange={(e) => { setApiUrl(e.target.value); setConnStatus('idle'); }}
            placeholder="http://localhost:4010"
            className={`${inputCls} font-mono`}
            dir="ltr"
          />
        </div>

        {connStatus !== 'idle' && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold
            ${connStatus === 'testing' ? 'bg-blue-50 text-blue-700' :
              connStatus === 'ok' ? 'bg-emerald-50 text-emerald-700' :
              'bg-rose-50 text-rose-700'}`}>
            {connStatus === 'testing' && <RefreshCw className="w-4 h-4 animate-spin" />}
            {connStatus === 'ok' && <CheckCircle2 className="w-4 h-4" />}
            {connStatus === 'error' && <AlertTriangle className="w-4 h-4" />}
            {connStatus === 'testing' ? 'جاري الاختبار...' : connMessage}
          </div>
        )}

        <button
          onClick={handleTestConnection}
          disabled={connStatus === 'testing' || !apiUrl.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200 transition disabled:opacity-50"
        >
          {connStatus === 'ok'
            ? <><Wifi className="w-4 h-4 text-emerald-600" /> متصل</>
            : connStatus === 'testing'
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> جاري الاختبار...</>
            : <><WifiOff className="w-4 h-4" /> اختبار الاتصال</>}
        </button>
      </div>

      {/* ── Save ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition disabled:opacity-50"
        >
          {saveStatus === 'saving'
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> جاري الحفظ...</>
            : <><Save className="w-4 h-4" /> حفظ الإعدادات</>}
        </button>
        {saveStatus === 'saved' && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-bold">
            <CheckCircle2 className="w-4 h-4" /> تم الحفظ بنجاح
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-sm text-rose-600 font-bold">فشل الحفظ</span>
        )}
      </div>

      {/* Security footer */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 space-y-1.5">
        <p className="font-bold text-blue-800 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" /> ملاحظة أمنية
        </p>
        <p>لا يتم تخزين أي من البيانات التالية في هذا التطبيق:</p>
        <ul className="list-disc list-inside space-y-0.5 mr-2">
          <li>كلمة مرور قاعدة البيانات PostgreSQL</li>
          <li>مفتاح JWT_SECRET</li>
          <li>بيانات اعتماد SSH أو VPS</li>
          <li>توكن Telegram</li>
        </ul>
        <p className="text-blue-600">الاتصال بـ PostgreSQL يتم فقط من جانب الخادم (Backend API).</p>
      </div>
    </div>
  );
};

/**
 * Legacy `/settings/desktop` route — redirects to the canonical
 * `/settings?tab=desktop` so that any existing buttons or links keep working.
 * Desktop settings are now part of System Settings.
 */
export const DesktopSettings: React.FC = () => {
  return <Navigate to="/settings?tab=desktop" replace />;
};
