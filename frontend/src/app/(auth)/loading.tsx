import { Loader2 } from 'lucide-react';

export default function AuthLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-concrete-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>جارٍ التحميل…</span>
      </div>
    </main>
  );
}
