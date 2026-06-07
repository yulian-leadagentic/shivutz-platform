'use client';

// Public mirror of /contractor/find/page.tsx — entry to the "try
// before you register" flow. Reached when /login OTP finds the phone
// is not yet a user (prospect path). Same domestic/foreign tile UI,
// but the hrefs route inside /try/contractor/* so no RoleGuard
// trips us up.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Globe2, MapPin } from 'lucide-react';
import { useProspect } from '@/features/prospect/state';
import { HomeLink } from '@/components/HomeLink';

interface Category {
  slug: 'domestic' | 'foreign';
  href: string;
  title: string;
  subtitle: string;
  icon: typeof MapPin;
  comingSoon?: boolean;
}

const CATEGORIES: Category[] = [
  {
    slug: 'domestic',
    href: '/try/contractor/domestic',
    title: 'גיוס עובדים מהארץ',
    subtitle: 'עובדים שכבר נמצאים בישראל ומוכנים לעבודה',
    icon: MapPin,
  },
  {
    slug: 'foreign',
    // Foreign import is a tender flow that REQUIRES a real contractor
    // (you can't publish to corps anonymously). In the trial we point
    // these visitors at the registration page directly with a small
    // explainer rather than walk them through a tender form they
    // can't actually submit.
    href: '/register/contractor?from=trial&recruitment=foreign',
    title: 'ייבוא עובדים חדשים מחו״ל',
    subtitle: 'דורש הרשמה — קבלת הצעות מתאגידים מאושרים',
    icon: Globe2,
  },
];

export default function TryContractorEntryPage() {
  const prospect = useProspect();
  const router = useRouter();

  // Stale tab guard — if someone deep-links here without a valid
  // prospect session, bounce them to /login with the contractor intent.
  useEffect(() => {
    if (prospect === null && typeof window !== 'undefined') {
      // Wait a tick so initial render has the loading state.
      const t = setTimeout(() => {
        if (!sessionStorage.getItem('prospect')) {
          router.replace('/login?intent=contractor');
        }
      }, 50);
      return () => clearTimeout(t);
    }
  }, [prospect, router]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8 space-y-6">
        {/* "Back to landing" escape — every page that lives outside
            the role-shell needs one so a confused prospect can bail
            cleanly without using the browser back button. */}
        <div className="flex justify-end">
          <HomeLink />
        </div>

        {/* The "מצב התנסות" expectations banner was removed per user
            request — the trial intent is clear enough from the
            recruitment-choice tiles below, and the banner was eating
            above-the-fold space. */}

        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">איתור עובדים</h1>
          <p className="text-sm text-slate-600">בחר את סוג הגיוס כדי להתחיל</p>
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
