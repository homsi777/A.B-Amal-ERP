import type { ApiCategory } from './api/fabricCategoriesApi';

/** اسم خامة / لون — يُفضَّل name كما في القائمة. */
export function getCategoryLabel(category: ApiCategory | null, fallback = ''): string {
  return (category?.name || category?.code || fallback).trim();
}

/** كود خامة / كود لون — يُفضَّل code كما في القائمة (CLO3 وليس رقم المورد). */
export function getCategoryCode(category: ApiCategory | null, fallback = ''): string {
  return (category?.code || category?.name || fallback).trim();
}
