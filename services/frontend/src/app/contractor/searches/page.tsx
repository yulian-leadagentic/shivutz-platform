'use client';

// Wave 3 — list of contractor's worker_searches.
// Replaces the project-level /contractor/requests page.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, Search as SearchIcon } from 'lucide-react';
import { searchApi } from '@/lib/api/jobs';
import { enumApi } from '@/lib/api/enums';
import { getProfessionIcon } from '@/features/searches/professionIcons';
import type { Profession, WorkerSearch } from '@/types';

const STATUS_LABEL: Record<string, string> = {
  open:              'פתוח',
  partially_matched: 'התאמה חלקית',
  fully_matched:     'התאמה מלאה',
  cancelled:         'בוטל',
};

export default function SearchesListPage() {
  const [items, setItems] = useState<WorkerSearch[] | null>(null);
  const [profByCode, setProfByCode] = useState<Record<string, Profession>>({});

  useEffect(() => {
    Promise.allSettled([
      searchApi.list().then(setItems).catch(() => setItems([])),
      enumApi.professions().then((ps) =>
        setProfByCode(Object.fromEntries(ps.map((p) => [p.code, p])))),
    ]);
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">החיפושים שלי</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            כל בקשת איתור עובדים שיצרת
          </p>
        </div>
        <Link
          href="/contractor/find"
          className="inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-3.5 py-2 rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> חיפוש חדש
        </Link>
      </header>

      {!items && (
        <div className="text-center text-sm text-slate-500 py-12">טוען...</div>
      )}

      {items && items.length === 0 && (
        <div className="text-center bg-white border border-slate-200 rounded-xl py-12 px-6">
          <SearchIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <div className="text-base font-semibold text-slate-700">עדיין לא יצרת חיפוש</div>
          <div className="text-sm text-slate-500 mt-1">לחץ על &quot;חיפוש חדש&quot; כדי להתחיל</div>
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((s) => {
            const Icon = getProfessionIcon(s.profession_type);
            const prof = profByCode[s.profession_type]?.name_he ?? s.profession_type;
            return (
              <li key={s.id}>
                <Link
                  href={`/contractor/searches/${s.id}`}
                  className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:border-brand-400 transition"
                >
                  <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-brand-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900 text-sm truncate">
                      {prof} — {s.quantity} עובדים
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">
                      {s.recruitment_type === 'foreign' ? 'מחו״ל' : 'מהארץ'}
                      <span className="mx-1.5">•</span>
                      התחלה {s.start_date}
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 flex-shrink-0 text-end">
                    {(s.best_fill_pct ?? -1) >= 0 && (
                      <div className={`font-semibold ${s.best_is_complete ? 'text-emerald-600' : 'text-slate-700'}`}>
                        {Math.round(s.best_fill_pct as number)}%
                      </div>
                    )}
                    <div className="text-slate-500 mt-0.5">
                      {STATUS_LABEL[s.status] ?? s.status}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
