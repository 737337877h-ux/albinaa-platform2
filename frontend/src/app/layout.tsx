import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'البناء الراقي — إدارة المديونية والتحصيل',
  description: 'منصة إدارة المديونية والتحصيل لشركة البناء الراقي',
};

/**
 * قرار موثق: لا نعتمد next/font/google.
 * تحميل الخطوط في next/font/google يحدث أثناء البناء نفسه (وقت الشبكة غير
 * مضمون في كل بيئات CI/الشركات)، فيفشّل production build بصمت أو بخطأ شبكة
 * غامض. نستخدم بدلاً منه مكدّس خطوط نظام آمنًا يدعم العربية على كل الأنظمة
 * (Windows/macOS/Linux) بلا أي اتصال شبكة وقت البناء — معرَّف في
 * tailwind.config.ts (fontFamily.display / fontFamily.body).
 * عند توفر خط "البناء الراقي" الرسمي كملف محلي، يُضاف عبر @font-face في
 * globals.css ويُدرج اسمه أولاً في نفس المكدّسين دون تغيير أي مكوّن آخر.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
