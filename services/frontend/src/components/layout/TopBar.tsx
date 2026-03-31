'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getAccessToken, decodeJwtPayload } from '@/lib/auth';
import { User } from 'lucide-react';

const pageTitles: Record<string, string> = {
  '/contractor/dashboard': 'לוח בקרה',
  '/contractor/requests': 'בקשות עבודה',
  '/contractor/requests/new': 'בקשת עבודה חדשה',
  '/contractor/deals': 'עסקאות',
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.includes('/match')) return 'תוצאות התאמה';
  if (pathname.includes('/deals/')) return 'פרטי עסקה';
  if (pathname.includes('/requests/')) return 'בקשת עבודה';
  return 'שיבוץ פלטפורמה';
}

export default function TopBar() {
  const pathname = usePathname();
  const [email, setEmail] = useState<string>('');

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      const payload = decodeJwtPayload(token);
      if (payload && typeof payload.email === 'string') {
        setEmail(payload.email);
      } else if (payload && typeof payload.sub === 'string') {
        setEmail(payload.sub);
      }
    }
  }, []);

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
      <h1 className="text-lg font-semibold text-slate-900 text-start">
        {getPageTitle(pathname)}
      </h1>
      {email && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <User className="h-4 w-4" />
          <span>{email}</span>
        </div>
      )}
    </header>
  );
}
