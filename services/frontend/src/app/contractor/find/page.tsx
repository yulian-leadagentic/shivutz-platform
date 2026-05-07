'use client';

// Wave 3 — contractor "find workers" entry point.
// Step 1: pick a recruitment category (domestic vs foreign).
//
// Wave 4 polish: the "ייבוא עובדים מחו״ל" tile is intentionally
// disabled with a "בקרוב" badge — that flow isn't built yet, but the
// category needs to be visible so contractors know it's coming.

import Link from 'next/link';
import { Globe2, MapPin } from 'lucide-react';

interface Category {
  slug: 'domestic' | 'foreign';
  title: string;
  subtitle: string;
  icon: typeof MapPin;
  comingSoon?: boolean;
}

const CATEGORIES: Category[] = [
  {
    slug: 'domestic',
    title: 'גיוס עובדים מהארץ',
    subtitle: 'עובדים שכבר נמצאים בישראל ומוכנים לעבודה',
    icon: MapPin,
  },
  {
    slug: 'foreign',
    title: 'ייבוא עובדים חדשים מחו״ל',
    subtitle: 'עובדים מחו״ל — תהליך הבאה לישראל',
    icon: Globe2,
    comingSoon: true,
  },
];

export default function FindCategoriesPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
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
          const inner = (
            <>
              {cat.comingSoon && (
                <div className="absolute top-3 left-3 inline-flex items-center bg-slate-900/85
                                text-white text-[11px] font-semibold px-2.5 py-1 rounded-full
                                tracking-wide">
                  Coming Soon
                </div>
              )}
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4
                              ${cat.comingSoon ? 'bg-slate-100' : 'bg-brand-50 group-hover:bg-brand-100'}`}>
                <Icon className={`w-8 h-8 ${cat.comingSoon ? 'text-slate-400' : 'text-brand-600'}`} />
              </div>
              <div className={`text-lg font-bold ${cat.comingSoon ? 'text-slate-500' : 'text-slate-900'}`}>
                {cat.title}
              </div>
              <div className={`text-sm mt-1 ${cat.comingSoon ? 'text-slate-400' : 'text-slate-600'}`}>
                {cat.subtitle}
              </div>
            </>
          );
          if (cat.comingSoon) {
            return (
              <div
                key={cat.slug}
                aria-disabled
                className={`${baseClass} cursor-not-allowed opacity-80`}
              >
                {inner}
              </div>
            );
          }
          return (
            <Link
              key={cat.slug}
              href={`/contractor/find/${cat.slug}`}
              className={`${baseClass} hover:border-brand-500 hover:bg-brand-50/30 hover:shadow-md active:scale-[0.99]`}
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
