'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Loader2 } from 'lucide-react';
import { adApi, type AdCreateInput } from '@/lib/api/ads';
import { mapApiError } from '@/lib/api/errors';
import { WorkerAdForm, type WorkerAdFormValues } from '@/features/ads/WorkerAdForm';
import { AdPreviewModal } from '@/features/ads/AdPreviewModal';
import { PublishBlockedBanner, publishBlockOf, type PublishBlock } from '@/features/ads/PublishBlockedBanner';
import { clearAdDraft, formInitial, readAdDraft, saveAdDraft, wantsResume } from '@/features/ads/adDraft';

export default function NewWorkerAdPage() {
  const router = useRouter();
  const [preview, setPreview] = useState<AdCreateInput | null>(null);
  const [blocked, setBlocked] = useState<PublishBlock | null>(null);
  const [draft, setDraft]     = useState<AdCreateInput | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState('');
  const resumed = useRef(false);

  useEffect(() => {
    if (resumed.current || !wantsResume()) return;
    const saved = readAdDraft('worker');
    if (!saved) return;
    resumed.current = true;
    setDraft(saved);
    setResuming(true);
    adApi.create(saved)
      .then((created) => {
        clearAdDraft();
        router.push(`/corporation/ads?created=${created.id}`);
      })
      .catch((e) => {
        setResuming(false);
        const block = publishBlockOf(e);
        if (block) setBlocked(block);
        else {
          setResumeError(mapApiError(e));
          setPreview(saved);
        }
      });
  }, [router]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-1">
        <Link href="/corporation/ads/new" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 me-1" /> חזרה לבחירת סוג מודעה
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">מודעת עובדים חדשה</h1>
        <p className="text-sm text-slate-500">תיאור חופשי משפר את ההתאמה בחיפושי קבלנים</p>
      </header>

      {resuming && (
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
          <Loader2 className="h-5 w-5 animate-spin shrink-0" aria-hidden />
          <p className="text-sm font-semibold">המנוי פעיל. מפרסמים את המודעה שלך…</p>
        </div>
      )}
      {resumeError && !preview && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{resumeError}</p>
      )}
      {blocked && <PublishBlockedBanner block={blocked} returnTo="/corporation/ads/new/worker?resume=1" />}

      {!resuming && <WorkerAdForm
        key={draft ? 'draft' : 'blank'}
        initial={draft ? formInitial<WorkerAdFormValues>(draft) : undefined}
        submitLabel="המשך לתצוגה מקדימה"
        onSubmit={async (payload) => { setResumeError(''); setPreview(payload); }}
      />}
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
