'use client';

// Wave 3 — contractor "find workers" entry point.
// Step 1: pick a recruitment category (domestic vs foreign).
// Replaces the old project-creation wizard at /contractor/requests/new.

import Link from 'next/link';
import { Globe2, MapPin } from 'lucide-react';

const CATEGORIES = [
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
  },
] as const;

export default function FindCategoriesPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">איתור עובדים</h1>
        <p className="text-sm text-slate-600">
          בחר את סוג הגיוס כדי להתחיל
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CATEGORIES.map(({ slug, title, subtitle, icon: Icon }) => (
          <Link
            key={slug}
            href={`/contractor/find/${slug}`}
            className="group flex flex-col items-center justify-center text-center
                       rounded-2xl border border-slate-200 bg-white px-6 py-10
                       hover:border-brand-500 hover:bg-brand-50/30
                       active:scale-[0.99] transition shadow-sm"
          >
            <div className="w-16 h-16 rounded-full bg-brand-50 group-hover:bg-brand-100
                            flex items-center justify-center mb-4">
              <Icon className="w-8 h-8 text-brand-600" />
            </div>
            <div className="text-lg font-bold text-slate-900">{title}</div>
            <div className="text-sm text-slate-600 mt-1">{subtitle}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
