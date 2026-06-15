import type { Metadata, Viewport } from 'next';
import { Heebo } from 'next/font/google';
import { AuthProvider } from '@/lib/AuthContext';
import { EnumsProvider } from '@/features/enums/EnumsContext';
import './globals.css';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo' });

export const metadata: Metadata = {
  title: 'TagidAI — גיוס עובדים זרים לבנייה',
  description: 'TagidAI — מערכת מבוססת AI להתאמת עובדים זרים, שיבוץ וניהול תהליך הגיוס בענף הבנייה.',
  applicationName: 'TagidAI',
  icons: {
    icon: '/brand/buildup-icon.png',
    apple: '/brand/buildup-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'TagidAI',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches the manifest theme_color so the mobile chrome bar tints
  // brand-orange when the app is launched from the home screen.
  themeColor: '#F78203',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` ONLY on <html>/<body>: browser
    // extensions routinely inject root-level attributes after SSR
    // (Lusha → lusha-extension-installed, Grammarly →
    // data-new-gr-c-s-check-loaded, dark-mode add-ons → class
    // tweaks). React 19 treats those as hydration mismatches and
    // tears down the whole tree, which silently drops event
    // handlers — login form clicks then appear to do nothing.
    // The flag is scoped to the root tags only so genuine
    // mismatches inside the app still surface as warnings.
    <html lang="he" dir="rtl" className={heebo.variable} suppressHydrationWarning>
      <body className="font-sans antialiased bg-slate-50 text-slate-900" suppressHydrationWarning>
        <AuthProvider>
          <EnumsProvider>{children}</EnumsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
