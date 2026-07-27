/**
 * عميل API موحد:
 * - يضيف Access Token تلقائيًا.
 * - عند 401: يجرب تجديدًا واحدًا عبر Refresh (بتدوير) ثم يعيد الطلب.
 * - فشل التجديد → تسجيل خروج محلي وإعادة توجيه لصفحة الدخول.
 * ملاحظة أمنية موثقة (نسخة Alpha داخلية): التوكنات في localStorage مع تدوير
 * Refresh وإبطاله من الخادم عند الخروج/التعطيل — الحماية الأساسية في الـ API.
 */
export const API = '/api';

/**
 * سياسة الجلسة المعتمدة ("تذكرني"):
 * - مفعّل  → localStorage: الجلسة تبقى بعد إغلاق المتصفح (حتى انتهاء/إبطال Refresh).
 * - معطّل → sessionStorage: الجلسة تنتهي بإغلاق المتصفح.
 * التجديد يكتب دائمًا في نفس المخزن الذي بدأت فيه الجلسة.
 */
const AT = 'albinaa.at';
const RT = 'albinaa.rt';
function activeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  if (sessionStorage.getItem(RT)) return sessionStorage;
  if (localStorage.getItem(RT)) return localStorage;
  return null;
}
const store = {
  get access() { return activeStorage()?.getItem(AT) ?? null; },
  get refresh() { return activeStorage()?.getItem(RT) ?? null; },
  set(at: string, rt: string, remember?: boolean) {
    if (typeof window === 'undefined') return;
    const target = remember === undefined
      ? (activeStorage() ?? localStorage)   // تجديد: نفس مخزن الجلسة الحالية
      : (remember ? localStorage : sessionStorage);
    // تنظيف المخزن الآخر لمنع ازدواج الجلسات
    (target === localStorage ? sessionStorage : localStorage).removeItem(AT);
    (target === localStorage ? sessionStorage : localStorage).removeItem(RT);
    target.setItem(AT, at);
    target.setItem(RT, rt);
  },
  clear() {
    if (typeof window === 'undefined') return;
    for (const s of [localStorage, sessionStorage]) { s.removeItem(AT); s.removeItem(RT); }
  },
};
export const tokenStore = store;

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (!store.refresh) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: store.refresh }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      store.set(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { skipAuth?: boolean } = {},
): Promise<T> {
  const doFetch = () =>
    fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' } : {}),
        ...(init.skipAuth || !store.access ? {} : { Authorization: `Bearer ${store.access}` }),
        ...init.headers,
      },
    });

  let res: Response;
  try {
    res = await doFetch();
  } catch {
    // فشل شبكة/CORS — لا نُسرّب رسالة المتصفح الخام
    throw new ApiError(0, 'تعذّر الاتصال بالخادم');
  }
  if (res.status === 401 && !init.skipAuth) {
    const ok = await tryRefresh();
    if (ok) res = await doFetch();
    else {
      store.clear();
      if (typeof window !== 'undefined') window.location.href = '/login';
      throw new ApiError(401, 'انتهت الجلسة — سجّل الدخول من جديد');
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = Array.isArray((body as any)?.message)
      ? (body as any).message.join('، ')
      : (body as any)?.message ?? 'حدث خطأ غير متوقع';
    throw new ApiError(res.status, msg, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
