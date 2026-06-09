export function ok<T extends Record<string, unknown>>(data: T) {
  return { ok: true as const, ...data };
}

export function fail(message: string, code?: string, statusCode = 400) {
  return { ok: false as const, message, code, statusCode };
}
