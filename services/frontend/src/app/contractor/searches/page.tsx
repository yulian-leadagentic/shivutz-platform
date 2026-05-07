'use client';

// Wave 4 polish — searches list shows real status derived from deals.
//
// We fetch the contractor's deals once, group them by `search_id`,
// and for each search compute a human-readable status that reflects
// the most-progressed deal in that search:
//   - no deals yet            → "ממתין לבחירת תאגיד"
//   - any deal is closed      → "הושלמה"
//   - any deal is approved    → "אושרה ע״י הקבלן — בעבודה"
//   - any deal is corp_committed → "תאגיד הגיב — ממתין לאישורך"
//   - any deal is proposed    → "ממתין לתשובה מתאגיד"
//   - all deals rejected/expired → "בוטל / פג תוקף"

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search as SearchIcon } from 'lucide-react';
import { searchApi } from '@/lib/api/jobs';
import { dealApi } from '@/lib/api/deals';
import { enumApi } from '@/lib/api/enums';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import type { Deal, Profession, WorkerSearch } from '@/types';

interface DerivedStatus {
  label: string;
  tone: 'amber' | 'emerald' | 'slate' | 'red' | 'sky';
}

// Higher number = more progressed deal status. Used to pick the most
// "advanced" deal across all deals attached to a single search.
const PROGRESS_RANK: Record<string, number> = {
  closed:            6,
  approved:          5,
  corp_committed:    4,
  proposed:          3,
  expired:           2,
  rejected:          1,
  cancelled_by_corp: 0,
};

function deriveStatus(searchStatus: string, deals: Deal[]): DerivedStatus {
  if (searchStatus === 'cancelled') return { label: 'החיפוש בוטל', tone: 'slate' };
  if (deals.length === 0)            return { label: 'ממתין לבחירת תאגיד', tone: 'sky' };

  const top = [...deals].sort(
    (a, b) => (PROGRESS_RANK[b.status] ?? -1) - (PROGRESS_RANK[a.status] ?? -1)
  )[0];

  switch (top.status) {
    case 'closed':            return { label: 'הושלמה',                       tone: 'emerald' };
    case 'approved':          return { label: 'אושרה — בעבודה',              tone: 'emerald' };
    case 'corp_committed':    return { label: 'תאגיד הגיב — ממתין לאישורך', tone: 'amber' };
    case 'proposed':          return { label: 'ממתין לתשובה מתאגיד',         tone: 'amber' };
    case 'rejected':
    case 'cancelled_by_corp': return { label: 'תאגיד דחה / ביטל',            tone: 'red' };
    case 'expired':           return { label: 'פג תוקף',                      tone: 'red' };
    default:                  return { label: top.status,                      tone: 'slate' };
  }
}

const TONE_CLASSES: Record<DerivedStatus['tone'], string> = {
  amber:   'bg-amber-100 text-amber-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  red:     'bg-red-100 text-red-700',
  sky:     'bg-sky-100 text-sky-700',
  slate:   'bg-slate-100 text-slate-600',
};

export default function SearchesListPage() {
  const [items, setItems] = useState<WorkerSearch[] | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [profByCode, setProfByCode] = useState<Record<string, Profession>>({});

  useEffect(() => {
    Promise.allSettled([
      searchApi.list().then(setItems).catch(() => setItems([])),
      dealApi.list({ page_size: 200 }).then((r) => setDeals(r.items)).catch(() => setDeals([])),
      enumApi.professions().then((ps) =>
        setProfByCode(Object.fromEntries(ps.map((p) => [p.code, p])))),
    ]);
  }, []);

  // search_id → deals[]
  const dealsBySearch = useMemo(() => {
    const m: Record<string, Deal[]> = {};
    for (const d of deals) {
      const sid = d.search_id;
      if (!sid) continue;
      (m[sid] ||= []).push(d);
    }
    return m;
  }, [deals]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">סטטוס בקשות</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            מעקב אחר כל בקשת איתור עובדים שיצרת
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
          <div className="text-sm text-slate-500 mt-1">
            לחץ על &quot;חיפוש חדש&quot; כדי להתחיל
          </div>
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((s) => {
            const prof = profByCode[s.profession_type]?.name_he ?? s.profession_type;
            const status = deriveStatus(s.status, dealsBySearch[s.id] ?? []);
            return (
              <li key={s.id}>
                <Link
                  href={`/contractor/searches/${s.id}`}
                  className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:border-brand-400 transition"
                >
                  <ProfessionIcon
                    code={s.profession_type}
                    size={44}
                    alt={prof}
                    className="flex-shrink-0"
                  />
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
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TONE_CLASSES[status.tone]}`}>
                      {status.label}
                    </span>
                    {(s.best_fill_pct ?? -1) >= 0 && (
                      <div className={`text-xs font-semibold ${s.best_is_complete ? 'text-emerald-600' : 'text-slate-600'}`}>
                        {Math.round(s.best_fill_pct as number)}% מילוי
                      </div>
                    )}
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
