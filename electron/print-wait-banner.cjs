/**
 * Tiny banner printed before `concurrently` boots backend + Vite + Electron.
 * Reminds the user not to press Ctrl+C during the ~25s cold-start so they
 * don't accidentally kill the launcher before Electron has had a chance to
 * spawn the window. The launcher itself prints a heartbeat each second.
 */
const lines = [
  '',
  '╔════════════════════════════════════════════════════════════════════╗',
  '║   ALamal-AB Obada · بدء بيئة التطوير الكاملة                       ║',
  '║   جارٍ تشغيل: Backend + Vite + Electron                            ║',
  '║                                                                    ║',
  '║   ⏳ الإقلاع البارد ~25 ثانية. سيتم طباعة سطر تقدّم كل ثانية:       ║',
  '║         [launcher] ✓ backend ready                                 ║',
  '║         [launcher] ✓ vite ready                                    ║',
  '║         [launcher] 🚀 launching Electron now                       ║',
  '║         [main] window shown (ready-to-show)                        ║',
  '║                                                                    ║',
  '║   ⛔ لا تضغطي Ctrl+C — حتى لو بدا الأمر بطيئاً، التقدّم يحصل!       ║',
  '║       فقط انتظري حتى تظهر نافذة ALamal-AB على شاشتك.               ║',
  '║                                                                    ║',
  '║   ⚠ npm run electron:dev:stack أو :raw — يفتح النفق + DATABASE_URL أولاً.       ║',
  '║   ⚠ عند التعطّل: npm run dev:free-ports ثم أعد التشغيل.                        ║',
  '║   ⚠ قبل التشغيل: أوقف أي نسخة سابقة — المنفذ 4030 يجب أن يكون               ║',
  '║       خالياً (EXE مضمّن، npm run server:start، إلخ).               ║',
  '║       عند التعطّل: npm run dev:free-port                            ║',
  '╚════════════════════════════════════════════════════════════════════╝',
  '',
];
process.stdout.write(lines.join('\n'));
