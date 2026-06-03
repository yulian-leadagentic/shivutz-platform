'use client';

// Public mirror of /try/contractor — but for the corporation side of
// the marketplace. Reached when /login OTP recognises an unregistered
// phone with intent=corporation. Two tiles:
//
//   1. "דרישה לעובדים חדשים מחו"ל"        — IMPORT tender flow. Locked
//      behind registration since publishing tenders requires a real
//      corp identity to bid against. Tile copy explains this and routes
//      to /register/corporation.
//
//   2. "דרישה לעובדים בזמינות מיידית"      — Live feed of contractor
//      searches that are waiting for a corp response. Anonymous /
//      preview-only; the corp can browse the requirements without
//      registering. Responding to any individual request requires
//      registration (gate inside the list page).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Globe2, Zap, Lock } from 'lucide-react';
import { useProspect } from '@/features/prospect/state';
import { HomeLink } from '@/components/HomeLink';

interface Category {
  slug: 'foreign' | 'immediate';
  href: string;
  title: string;
  subtitle: string;
  icon: typeof Globe2;
  locked?: boolean;
}

const CATEGORIES: Category[] = [
  {
    slug: 'immediate',
    href: '/try/corporation/immediate',
    title: 'דרישה לעובדים בזמינות מיידית',
    subtitle: 'רשימת קבלנים שמחפשים עובדים זמינים כרגע',
    icon: Zap,
  },
  {
    slug: 'foreign',
    // Foreign-import tenders are part of the registered-only flow —
    // there's no way to publish a tender anonymously, so we send the
    // prospect straight to registration. The query string signals to
    // the register page which path they came from.
    href: '/register/corporation?from=trial&recruitment=foreign',
    title: 'דרישה לעובדים חדשים מחו"ל',
    subtitle: 'דורש הרשמה — קבלת בקשות מקבלנים לייבוא עובדים מחו"ל',
    icon: Globe2,
    locked: true,
  },
];

export default function TryCorporationEntryPage() {
  const prospect = useProspect();
  const router = useRouter();

  // Stale-tab guard — same pattern as /try/contractor. If someone
  // deep-links here without a valid prospect session, bounce to the
  // /login with the corporation intent so they re-OTP cleanly.
  useEffect(() => {
    if (prospect === null && typeof window !== 'undefined') {
      const t = setTimeout(() => {
        if (!sessionStorage.getItem('prospect')) {
          router.replace('/login?intent=corporation');
        }
      }, 50);
      return () => clearTimeout(t);
    }
  }, [prospect, router]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8 space-y-6">
        <div className="flex justify-end">
          <HomeLink />
        </div>

        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">איתור דרישות לעובדים</h1>
          <p className="text-sm text-slate-600">בחר את סוג הבקשות שאתה מעוניין לראות</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const baseClass =
              'group relative flex flex-col items-center justify-center text-center ' +
              'rounded-2xl border border-slate-200 bg-white px-6 py-10 shadow-sm transition';
            return (
              <Link
                key={cat.slug}
                href={cat.href}
                className={`${baseClass} hover:border-brand-500 hover:bg-brand-50/30 hover:shadow-md active:scale-[0.99]`}
              >
                {cat.locked && (
                  <span className="absolute top-3 end-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-slate-900 text-white px-2 py-0.5 rounded-full">
                    <Lock className="h-3 w-3" />
                    דורש הרשמה
                  </span>
                )}
                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-brand-50 group-hover:bg-brand-100">
                  <Icon className="w-8 h-8 text-brand-600" />
                </div>
                <div className="text-lg font-bold text-slate-900">{cat.title}</div>
                <div className="text-sm mt-1 text-slate-600">{cat.subtitle}</div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
