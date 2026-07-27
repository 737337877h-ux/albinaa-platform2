'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, tokenStore } from '@/lib/api';
import { friendlyApiError } from '@/lib/errors';
import { Button, ErrorNote, Field, Input } from '@/components/ui/primitives';
import { BrandLogo } from '@/components/brand';

const schema = z.object({
  username: z.string().min(2, 'اسم المستخدم قصير جدًا'),
  password: z.string().min(6, 'كلمة المرور 6 أحرف على الأقل'),
  remember: z.boolean().optional(),
});
type Form = z.infer<typeof schema>;

/** صياغة خاصة بالدخول (401 هنا تعني بيانات خاطئة، لا "انتهاء جلسة"). */
function friendlyError(err: unknown): string {
  return err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401
    ? 'بيانات الدخول غير صحيحة. تحقق من اسم المستخدم وكلمة المرور.'
    : friendlyApiError(err);
}

type Stage = 'form' | 'preparing' | 'prepare-failed';

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [stage, setStage] = useState<Stage>('form');
  const [prepareError, setPrepareError] = useState<string | null>(null);

  const {
    register, handleSubmit, formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { remember: true } });

  /**
   * تجهيز الجلسة بعد نجاح تسجيل الدخول:
   * - /auth/me حرج: فشله يعني عدم إمكانية معرفة الهوية والصلاحيات، لذا
   *   نعرض الخطأ ونبقى في الصفحة (لا Promise.allSettled يُخفي الفشل).
   * - /organizations/current غير حرج لهوية المستخدم: فشله لا يمنع الدخول،
   *   فقط يُسجَّل ونكمل — يُعاد جلبه لاحقًا داخل التطبيق عند الحاجة.
   */
  async function prepareSessionAndEnter() {
    setStage('preparing');
    setPrepareError(null);
    try {
      await qc.fetchQuery({ queryKey: ['me'], queryFn: () => api('/auth/me') });
    } catch (err) {
      setStage('prepare-failed');
      setPrepareError(friendlyError(err));
      return;
    }
    try {
      await qc.fetchQuery({ queryKey: ['organization'], queryFn: () => api('/organizations/current') });
    } catch {
      // غير حرج — لا يمنع الدخول، سيُعاد جلبه لاحقًا عند الحاجة داخل التطبيق
    }
    router.replace('/dashboard');
  }

  const login = useMutation({
    mutationFn: (data: Form) =>
      api<{ accessToken: string; refreshToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: data.username, password: data.password }),
        skipAuth: true,
      }).then((tokens) => ({ tokens, remember: data.remember ?? true })),
    onSuccess: ({ tokens, remember }) => {
      tokenStore.set(tokens.accessToken, tokens.refreshToken, remember);
      void prepareSessionAndEnter();
    },
  });

  const busy = isSubmitting || login.isPending || stage === 'preparing';

  if (stage === 'preparing') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
        <BrandLogo className="h-12 w-12" />
        <div className="flex items-center gap-2 text-sm text-concrete-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>جارٍ تجهيز جلستك…</span>
        </div>
      </main>
    );
  }

  if (stage === 'prepare-failed') {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 text-center shadow-card dark:bg-iron-800 dark:ring-1 dark:ring-white/10">
          <BrandLogo className="mx-auto h-10 w-10" />
          <ErrorNote message={prepareError ?? 'تعذّر تجهيز الجلسة'} />
          <div className="flex flex-col gap-2">
            <Button onClick={() => void prepareSessionAndEnter()}>إعادة المحاولة</Button>
            <Button
              variant="secondary"
              onClick={() => { tokenStore.clear(); setStage('form'); }}
            >
              العودة إلى تسجيل الدخول
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandLogo className="mx-auto h-12 w-12" />
          <h1 className="mt-3 font-display text-2xl font-bold">البناء الراقي</h1>
          <p className="mt-1 text-sm text-concrete-500">منصة إدارة المديونية والتحصيل</p>
        </div>

        <form
          onSubmit={handleSubmit((d) => login.mutate(d))}
          noValidate
          className="space-y-4 rounded-2xl bg-white p-6 shadow-card dark:bg-iron-800 dark:ring-1 dark:ring-white/10"
        >
          {login.isError && <ErrorNote message={friendlyError(login.error)} />}

          <Field label="اسم المستخدم" error={errors.username?.message} errorId="username-error">
            <Input
              autoFocus
              autoComplete="username"
              aria-invalid={!!errors.username || undefined}
              aria-describedby={errors.username ? 'username-error' : undefined}
              {...register('username')}
            />
          </Field>

          <Field label="كلمة المرور" error={errors.password?.message} errorId="password-error">
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                aria-invalid={!!errors.password || undefined}
                aria-describedby={errors.password ? 'password-error' : undefined}
                className="pl-10"
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 left-0 flex items-center px-3 text-concrete-500 hover:text-iron-900 dark:hover:text-concrete-100"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          <label className="flex items-center gap-2 text-sm text-concrete-700 dark:text-concrete-200">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-concrete-300 text-pine-700 focus:ring-pine-500"
              {...register('remember')}
            />
            تذكرني
          </label>

          <Button type="submit" loading={busy} className="w-full" aria-live="polite">
            {busy ? 'جارٍ تسجيل الدخول…' : 'تسجيل الدخول'}
          </Button>
        </form>
      </div>
    </main>
  );
}
