'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Loader2 } from 'lucide-react';
import { adApi, type AdRow } from '@/lib/api/ads';
import { WorkerAdForm } from '@/features/ads/WorkerAdForm';

export default function EditAdPage() {
  const { id }  = useParams<{ id: string }>();
  const router  = useRouter();
  const [ad, setAd]           = useState<AdRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    (async () => {
      try { setAd(await adApi.get(id)); }
      catch (e) { setError((e as Error).message ?? 'שגיאה בטעינת המודעה'); }
      finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) {
    return <div className="max-w-3xl mx-auto py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>;
  }
  if (error || !ad) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        <Link href="/corporation/ads" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 me-1" /> חזרה למודעות שלי
        </Link>
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error || 'המודעה לא נמצאה'}</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-1">
        <Link href="/corporation/ads" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 me-1" /> חזרה למודעות שלי
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">עריכת מודעה</h1>
      </header>
      <WorkerAdForm
        submitLabel="שמור שינויים"
        initial={{
          title_he:              ad.title_he,
          body_he:               ad.body_he ?? '',
          profession_code:       ad.profession_code ?? '',
          origin_country:        ad.origin_country ?? '',
          region:                ad.region ?? '',
          quantity:              ad.quantity ?? 1,
          experience_min_months: ad.experience_min_months ?? 0,
          visa_valid_until:      ad.visa_valid_until ?? '',
          languages:             ad.languages ?? [],
        }}
        onSubmit={async (payload) => {
          await adApi.update(id, payload);
          router.push('/corporation/ads');
        }}
      />
    </div>
  );
}
