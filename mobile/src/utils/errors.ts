export function apiErrorMessage(err: any, fallback = 'حدث خطأ غير متوقع'): string {
  const data = err?.response?.data;
  const msg = data?.message;
  if (Array.isArray(msg)) return msg.filter(Boolean).join('\n') || fallback;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  if (typeof err?.message === 'string' && err.message && err.message !== 'Network Error') {
    return err.message;
  }
  if (err?.message === 'Network Error') return 'تعذر الاتصال بالخادم';
  return fallback;
}

export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}
