'use client';

// Phase 4 — pick ad type before opening the form. Worker + housing use
// different fields, so we short-circuit here rather than a giant unified
// form.

import Link from 'next/link';
import { ChevronRight, Users, Home } from 'lucide-react';

export default function NewAdTypePickerPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header className="space-y-1">
        <Link href="/corporation/ads" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 me-1" /> חזרה למודעות שלי
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">מודעה חדשה</h1>
        <p className="text-sm text-slate-500">בחר את סוג המודעה</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/corporation/ads/new/worker"
          className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-brand-400 hover:shadow-md transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">עובדים זמינים</h3>
              <p className="text-xs text-slate-500">פרסם כמות עובדים לפי מקצוע, מוצא ואזור</p>
            </div>
          </div>
        </Link>

        <Link
          href="/corporation/ads/new/housing"
          className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-brand-400 hover:shadow-md transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
              <Home className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">דיור לפועלים</h3>
              <p className="text-xs text-slate-500">מיטות פנויות, לפי עיר, אזור ותנאים</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
