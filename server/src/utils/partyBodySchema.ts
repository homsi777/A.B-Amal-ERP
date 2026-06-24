import { z } from 'zod';

function nullToTrimmedString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function nullToOptionalCode(value: unknown): string | undefined {
  const s = nullToTrimmedString(value);
  return s || undefined;
}

function nullToOptionalEmail(value: unknown): string {
  const s = nullToTrimmedString(value);
  if (!s) return '';
  return z.string().email().safeParse(s).success ? s : '';
}

const nullableText = () => z.preprocess(nullToTrimmedString, z.string());

const telegramFields = {
  telegramChatId: z.preprocess(
    (v) => nullToTrimmedString(v).slice(0, 64),
    z.string(),
  ),
  telegramEnabled: z.boolean().optional().default(false),
  telegramLabel: z.preprocess(
    (v) => nullToTrimmedString(v).slice(0, 120),
    z.string(),
  ),
};

export const customerBodySchema = z.object({
  name: z.preprocess(nullToTrimmedString, z.string().min(1, 'الاسم مطلوب')),
  code: z.preprocess(nullToOptionalCode, z.string().optional()),
  phone: nullableText(),
  email: z.preprocess(nullToOptionalEmail, z.string()),
  address: nullableText(),
  notes: nullableText(),
  ...telegramFields,
});

export const supplierBodySchema = z.object({
  name: z.preprocess(nullToTrimmedString, z.string().min(1, 'الاسم مطلوب')),
  code: z.preprocess(nullToOptionalCode, z.string().optional()),
  phone: nullableText(),
  email: z.preprocess(nullToOptionalEmail, z.string()),
  address: nullableText(),
  country: nullableText(),
  notes: nullableText(),
  ...telegramFields,
});

export function formatZodValidationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'بيانات غير صالحة';
  const label = issue.path.length ? `${String(issue.path[issue.path.length - 1])}: ` : '';
  return `${label}${issue.message}`.trim();
}
