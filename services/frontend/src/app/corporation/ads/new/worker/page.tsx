'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { adApi, type AdCreateInput } from '@/lib/api/ads';
import { WorkerAdForm, type WorkerAdFormValues } from '@/features/ads/WorkerAdForm';
import { AdPreviewModal } from '@/features/ads/AdPreviewModal';
import { PublishBlockedBanner, publishBlockOf, type PublishBlock } from '@/features/ads/PublishBlockedBanner';
import { clearAdDraft, formInitial, readAdDraft, saveAdDraft, wantsResume } from '@/features/ads/adDraft';

export default function NewWorkerAdPage() {
  const router = useRouter();
  const [preview, setPreview] = useState<AdCreateInput | null>(null);
  const [blocked, setBlocked] = useState<PublishBlock | null>(null);
  const [draft, setDraft]     = useState<AdCreateInput | null>(null);

  useEffect(() => {
    if (!wantsResume()) return;
    const saved = readAdDraft('worker');
    if (!saved) return;
    setDraft(saved);
    setPreview(saved);
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-1">
        <Link href="/corporation/ads/new" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 me-1" /> חזרה לבחירת סוג מודעה
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">מודעת עובדים חדשה</h1>
        <p className="text-sm text-slate-500">תיאור חופשי משפר את ההתאמה בחיפושי קבלנים</p>
      </header>

      {blocked && <PublishBlockedBanner block={blocked} returnTo="/corporation/ads/new/worker?resume=1" />}

      <WorkerAdForm
        key={draft ? 'draft' : 'blank'}
        initial={draft ? formInitial<WorkerAdFormValues>(draft) : undefined}
        submitLabel="המשך לתצוגה מקדימה"
        onSubmit={async (payload) => { setPreview(payload); }}
      />
      <AdPreviewModal
        payload={preview}
        onCancel={() => setPreview(null)}
        onConfirm={async () => {
          if (!preview) return;
          setBlocked(null);
          try {
            const created = await adApi.create(preview);
            clearAdDraft();
            router.push(`/corporation/ads?created=${created.id}`);
          } catch (e) {
            const block = publishBlockOf(e);
            if (block) {
              saveAdDraft(preview);
              setBlocked(block);
              setPreview(null);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              throw e;
            }
          }
        }}
      />
    </div>
  );
}
