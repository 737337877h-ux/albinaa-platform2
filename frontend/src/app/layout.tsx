import type { Metadata } from 'next';
import './globals.css';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'البناء الراقي — إدارة المديونية والتحصيل',
  description: 'منصة إدارة المديونية والتحصيل لشركة البناء الراقي',
};

/** Cairo وSpace Grotesk مضمّنان محليًا عبر Fontsource؛ لا اتصال خارجي وقت البناء أو التشغيل. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
