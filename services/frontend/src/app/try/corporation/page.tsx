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
import { useEffect, useState } from 'react';
import { Globe2, Zap, Lock, AlertCircle, UserPlus, ArrowLeft } from 'lucide-react';
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
    title: 'קבלנים מחפשים עובדים בזמינות מיידית',
    subtitle: 'רשימת קבלנים שמחפשים עובדים זמינים כרגע',
    icon: Zap,
  },
  {
    slug: 'foreign',
    // Foreign-import tenders are registered-only — there's no
    // anonymous-preview surface for them like there is for the
    // immediate-availability feed. Clicking the tile pops a gate
    // modal that links into the same trial-aware register flow.
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
  // Locked-tile click pops this modal — the foreign-import flow has
  // no anonymous preview, so we don't deep-link straight to the
  // register form; we explain why first.
  const [lockedOpen, setLockedOpen] = useState<Category | null>(null);

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
              'rounded-2xl border border-slate-200 bg-white px-6 py-10 shadow-sm transition ' +
              'hover:border-brand-500 hover:bg-brand-50/30 hover:shadow-md active:scale-[0.99]';
            const inner = (
              <>
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
              </>
            );
            return cat.locked ? (
              <button
                key={cat.slug}
                type="button"
                onClick={() => setLockedOpen(cat)}
                className={`${baseClass} text-start`}
              >
                {inner}
              </button>
            ) : (
              <Link key={cat.slug} href={cat.href} className={baseClass}>
                {inner}
              </Link>
            );
          })}
        </div>
      </main>

      {/* Registration gate modal — fires when the prospect clicks a
          locked category (foreign-import). The CTA preserves the
          recruitment-source param so the register page can branch on
          it later; `from=trial` triggers the OTP-bypass effect on
          the corp register page (same as the contractor flow). */}
      {lockedOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4"
          onClick={() => setLockedOpen(null)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  זמין רק למשתמשים רשומים
                </h2>
                <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                  קבלת בקשות לייבוא עובדים מחו״ל מצריכה תאגיד מאומת.
                  הרישום מהיר — הטלפון שלך כבר אומת.
                </p>
              </div>
            </div>
            <Link
              href={lockedOpen.href}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-base shadow-md transition-colors"
            >
              <UserPlus className="h-5 w-5" />
              המשך להרשמה
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <button
              type="button"
              onClick={() => setLockedOpen(null)}
              className="w-full text-center text-sm text-slate-500 hover:text-slate-700 py-1"
            >
              לא כרגע
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
