'use client';

// Wave 3 — Step 2: profession tiles.
// Each tile is a LucideReact icon + the Hebrew profession name. Click
// drills down to the per-profession search form.

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ChevronRight, AlertCircle } from 'lucide-react';
import { enumApi } from '@/lib/api/enums';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { Button } from '@/components/ui/button';
import type { Profession, RecruitmentType } from '@/types';

const TITLES: Record<RecruitmentType, string> = {
  domestic: 'גיוס עובדים מהארץ',
  foreign:  'ייבוא עובדים חדשים מחו״ל',
};

export default function ProfessionTilesPage() {
  const { recruitment } = useParams<{ recruitment: RecruitmentType }>();
  const [profs, setProfs] = useState<Profession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  // Loader is wrapped so the retry button can fire it again.
  // Previously this page had no .catch — a transient
  // "Failed to fetch" left it loading=false / profs=[] / no
  // visible error, which read to the user as a blank page.
  const load = useCallback(() => {
    setLoading(true); setError(false);
    enumApi.professions()
      .then(setProfs)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const title = TITLES[recruitment] ?? 'איתור עובדים';

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-1">
        <Link href="/contractor/find" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 ml-1" /> חזרה
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-600">בחר מקצוע</p>
      </header>

      {error ? (
        <div className="bg-white border border-rose-200 rounded-2xl flex flex-col items-center gap-3 py-12 text-center px-4">
          <AlertCircle className="h-10 w-10 text-rose-400" />
          <p className="text-slate-700 font-medium">לא הצלחנו לטעון את רשימת המקצועות</p>
          <p className="text-slate-400 text-sm">בדוק את החיבור לאינטרנט ונסה שוב</p>
          <Button variant="outline" size="sm" onClick={load}>נסה שוב</Button>
        </div>
      ) : loading ? (
        <div className="text-center text-sm text-slate-500 py-12">טוען...</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {profs.map((p) => (
            <Link
              key={p.code}
              href={`/contractor/find/${recruitment}/${p.code}`}
              className="group flex flex-col items-center justify-center text-center
                         rounded-2xl border border-slate-200 bg-white p-2
                         hover:border-brand-500 hover:shadow-md hover:bg-brand-50/30
                         active:scale-[0.98] transition shadow-sm aspect-square"
            >
              {/* Icon takes ~75% of the tile, label sits below in remaining space */}
              <div className="flex-1 flex items-center justify-center w-full min-h-0">
                <ProfessionIcon
                  code={p.code}
                  size={160}
                  alt={p.name_he}
                  className="object-contain w-full h-full max-w-full max-h-full"
                />
              </div>
              <div className="text-sm font-semibold text-slate-900 leading-tight pb-1">
                {p.name_he}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
