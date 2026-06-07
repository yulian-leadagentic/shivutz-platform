'use client';

// Public profession tiles — clone of /contractor/find/[recruitment]/page.tsx
// pinned to the domestic flow (which is the only trial path that runs
// fully without a real contractor account; foreign tenders need a real
// contractor identity to publish to corps).

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, AlertCircle } from 'lucide-react';
import { enumApi } from '@/lib/api/enums';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { Button } from '@/components/ui/button';
import { readProspect } from '@/features/prospect/state';
import { HomeLink } from '@/components/HomeLink';
import type { Profession } from '@/types';

export default function TryProfessionTilesPage() {
  const router = useRouter();
  const [profs, setProfs] = useState<Profession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Stale tab guard — same pattern as the entry page.
  useEffect(() => {
    if (typeof window !== 'undefined' && !readProspect()) {
      router.replace('/login?intent=contractor');
    }
  }, [router]);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    enumApi.professions()
      .then(setProfs)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      {/* Top-row escape hatch — "back to landing" sits separately from
          the contextual "חזרה" link below (which only steps back one
          level inside the trial flow). */}
      <div className="flex justify-end">
        <HomeLink />
      </div>

      <header className="space-y-1">
        <Link href="/try/contractor" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 ml-1" /> חזרה
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">גיוס עובדים מהארץ</h1>
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
              href={`/try/contractor/domestic/${p.code}`}
              className="group flex flex-col items-center justify-center text-center
                         rounded-2xl border border-slate-200 bg-white p-2
                         hover:border-brand-500 hover:shadow-md hover:bg-brand-50/30
                         active:scale-[0.98] transition shadow-sm aspect-square"
            >
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
