/** استخراج اسم القماش وكود التصميم من اسم ملف الاستيراد */

export function inferMaterialNameFromFileName(fileName: string): string {
  const base = String(fileName || '')
    .replace(/\.(xls|xlsx|csv)$/i, '')
    .trim();
  if (!base) return 'مستورد';

  const withoutPrefix = base
    .replace(/^roll\s*list(\s*for)?\s*/i, '')
    .replace(/^قائمة\s*(الأتواب|التوب)?\s*/i, '')
    .trim();

  const tokens = withoutPrefix
    .split(/[\s_\-\/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));

  if (tokens.length) return tokens[tokens.length - 1].toUpperCase();
  return withoutPrefix.toUpperCase() || 'مستورد';
}

export function inferDesignCodeFromFileName(fileName: string): string | undefined {
  const base = String(fileName || '')
    .replace(/\.(xls|xlsx|csv)$/i, '')
    .trim();
  const m = /\b(\d{2,5})\b/.exec(base);
  return m?.[1];
}

export function parseImportFileName(fileName: string): {
  materialName: string;
  designCode?: string;
} {
  return {
    materialName: inferMaterialNameFromFileName(fileName),
    designCode: inferDesignCodeFromFileName(fileName),
  };
}
