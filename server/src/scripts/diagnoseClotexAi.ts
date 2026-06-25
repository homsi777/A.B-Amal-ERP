/**
 * تشخيص مساعد CLOTEX على السيرفر (VPS).
 * الاستخدام: npm run ai:diagnose
 * أو: tsx server/src/scripts/diagnoseClotexAi.ts
 */
import { getPool } from '../db/pool.js';
import { getAiSettingsMasked, resolveAiModel, resolveOpenAiApiKey, testOpenAiConnection } from '../services/ai/aiSettingsService.js';

async function checkOpenAiReachability(): Promise<void> {
  console.log('\n── 1) الوصول إلى api.openai.com (بدون مفتاح) ──');
  const started = Date.now();
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: 'Bearer sk-test' },
      signal: AbortSignal.timeout(15_000),
    });
    const ms = Date.now() - started;
    const body = await res.text();
    // 401 = وصلنا للخادم لكن المفتاح وهمي (هذا جيد للتشخيص)
    if (res.status === 401) {
      console.log(`✅ الاتصال بالشبكة ناجح (${ms}ms) — الخادم يرد (401 متوقع بدون مفتاح صالح)`);
      return;
    }
    if (res.ok) {
      console.log(`✅ الاتصال ناجح (${ms}ms) — HTTP ${res.status}`);
      return;
    }
    console.log(`⚠️  وصلنا لـ OpenAI لكن HTTP ${res.status} (${ms}ms)`);
    console.log(`   مقتطف: ${body.slice(0, 200)}`);
  } catch (error) {
    const ms = Date.now() - started;
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`❌ فشل الوصول إلى OpenAI (${ms}ms)`);
    console.log(`   الخطأ: ${msg}`);
    console.log('   → غالباً السيرفر لا يصل لـ api.openai.com (حاجز شبكة / حاجة VPN أو بروكسي على السيرفر).');
  }
}

async function checkDbTables(): Promise<string | null> {
  console.log('\n── 2) جداول قاعدة البيانات ──');
  const pool = getPool();
  const tables = ['ai_assistant_settings', 'ai_chat_sessions', 'ai_chat_messages'];
  for (const t of tables) {
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [t],
    );
    console.log(rows[0]?.exists ? `✅ ${t}` : `❌ ${t} — نفّذ: npm run server:migrate`);
  }

  const companies = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM companies ORDER BY created_at LIMIT 3`,
  );
  if (!companies.rows.length) {
    console.log('❌ لا توجد شركة في النظام');
    return null;
  }
  const companyId = companies.rows[0].id;
  console.log(`   شركة للاختبار: ${companies.rows[0].name} (${companyId})`);
  return companyId;
}

async function checkSettings(companyId: string): Promise<void> {
  console.log('\n── 3) إعدادات CLOTEX المحفوظة ──');
  const settings = await getAiSettingsMasked(companyId);
  console.log(`   مفعّل: ${settings.enabled ? 'نعم' : 'لا'}`);
  console.log(`   النموذج: ${settings.model}`);
  console.log(`   مفتاح محفوظ: ${settings.hasApiKey ? 'نعم' : 'لا'}`);
  if (settings.maskedApiKey) console.log(`   المفتاح المقنّع: ${settings.maskedApiKey}`);

  if (!settings.enabled) {
    console.log('⚠️  المساعد غير مفعّل — فعّله من الإعدادات.');
  }
  if (!settings.hasApiKey) {
    console.log('⚠️  لا يوجد مفتاح محفوظ — احفظ المفتاح من الإعدادات.');
  }
}

async function checkKeyDecrypt(companyId: string): Promise<boolean> {
  console.log('\n── 4) فك تشفير المفتاح ──');
  try {
    const key = await resolveOpenAiApiKey(companyId);
    if (!key) {
      console.log('❌ لا يمكن قراءة المفتاح (غير مفعّل أو غير محفوظ)');
      return false;
    }
    console.log(`✅ المفتاح يُقرأ بنجاح (ينتهي بـ ...${key.slice(-4)})`);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`❌ فشل فك التشفير: ${msg}`);
    console.log('   → أعد حفظ المفتاح من الإعدادات (قد يكون SETTINGS_ENCRYPTION_KEY أو JWT_SECRET تغيّر).');
    return false;
  }
}

async function checkOpenAiWithKey(companyId: string): Promise<void> {
  console.log('\n── 5) اختبار OpenAI بالمفتاح المحفوظ ──');
  const model = await resolveAiModel(companyId);
  try {
    const result = await testOpenAiConnection(companyId);
    console.log(`✅ نجح الاتصال — النموذج: ${result.model}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`❌ فشل اختبار OpenAI (النموذج: ${model})`);
    console.log(`   الخطأ: ${msg}`);
    if (/model/i.test(msg) && /not found|does not exist|invalid/i.test(msg)) {
      console.log('   → جرّب تغيير النموذج إلى gpt-4o-mini من الإعدادات.');
    }
    if (/timeout|fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(msg)) {
      console.log('   → مشكلة شبكة من السيرفر إلى OpenAI — قد تحتاج VPN/بروكسي على السيرفر.');
    }
  }
}

async function main() {
  console.log('=== تشخيص مساعد CLOTEX ===');
  console.log(`الوقت: ${new Date().toISOString()}`);

  await checkOpenAiReachability();

  const companyId = await checkDbTables();
  if (!companyId) {
    process.exit(1);
  }

  await checkSettings(companyId);
  const hasKey = await checkKeyDecrypt(companyId);
  if (hasKey) {
    await checkOpenAiWithKey(companyId);
  }

  console.log('\n── انتهى التشخيص ──\n');
  await getPool().end();
}

main().catch((error) => {
  console.error('[diagnose] فشل:', error instanceof Error ? error.message : error);
  process.exit(1);
});
