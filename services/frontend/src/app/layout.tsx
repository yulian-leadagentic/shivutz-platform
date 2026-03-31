import type { Metadata } from 'next';
import { Heebo } from 'next/font/google';
import './globals.css';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo' });

export const metadata: Metadata = {
  title: 'שיבוץ פלטפורמה',
  description: 'פלטפורמה לשיבוץ עובדים זרים בענף הבנייה',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="font-sans antialiased bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
