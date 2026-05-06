'use client';

// Wave 3 — Step 2: profession tiles.
// Each tile is a LucideReact icon + the Hebrew profession name. Click
// drills down to the per-profession search form.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { enumApi } from '@/lib/api/enums';
import { getProfessionIcon } from '@/features/searches/professionIcons';
import type { Profession, RecruitmentType } from '@/types';

const TITLES: Record<RecruitmentType, string> = {
  domestic: 'גיוס עובדים מהארץ',
  foreign:  'ייבוא עובדים חדשים מחו״ל',
};

export default function ProfessionTilesPage() {
  const { recruitment } = useParams<{ recruitment: RecruitmentType }>();
  const [profs, setProfs] = useState<Profession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    enumApi.professions()
      .then((p) => setProfs(p))
      .finally(() => setLoading(false));
  }, []);

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

      {loading ? (
        <div className="text-center text-sm text-slate-500 py-12">טוען...</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {profs.map((p) => {
            const Icon = getProfessionIcon(p.code);
            return (
              <Link
                key={p.code}
                href={`/contractor/find/${recruitment}/${p.code}`}
                className="group flex flex-col items-center justify-center text-center
                           rounded-2xl border border-slate-200 bg-white px-3 py-6
                           hover:border-brand-500 hover:bg-brand-50/30
                           active:scale-[0.98] transition shadow-sm aspect-square"
              >
                <div className="w-12 h-12 rounded-xl bg-brand-50 group-hover:bg-brand-100
                                flex items-center justify-center mb-2">
                  <Icon className="w-6 h-6 text-brand-600" />
                </div>
                <div className="text-sm font-semibold text-slate-900 leading-tight">
                  {p.name_he}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
