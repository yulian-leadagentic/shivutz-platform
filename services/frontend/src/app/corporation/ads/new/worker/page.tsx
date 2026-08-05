'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ChevronRight, CreditCard } from 'lucide-react';
import { adApi, type AdCreateInput } from '@/lib/api/ads';
import { WorkerAdForm } from '@/features/ads/WorkerAdForm';
import { AdPreviewModal } from '@/features/ads/AdPreviewModal';

export default function NewWorkerAdPage() {
  const router = useRouter();
  const [preview, setPreview] = useState<AdCreateInput | null>(null);
  // CP4 — cap-hit prompt. When adApi.create returns 402/tier_active_ad_limit
  // we surface an inline upgrade banner instead of an unhandled rejection.
  const [capHit, setCapHit] = useState(false);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-1">
        <Link href="/corporation/ads/new" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 me-1" /> חזרה לבחירת סוג מודעה
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">מודעת עובדים חדשה</h1>
        <p className="text-sm text-slate-500">תיאור חופשי משפר את ההתאמה בחיפושי קבלנים</p>
      </header>

      {capHit && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-amber-900">הגעת למכסת המודעות בתוכנית הנוכחית</h3>
            <p className="text-sm text-amber-800 mt-0.5">שדרג את המנוי כדי לפרסם מודעות נוספות. השדרוג חל מיד ומאפשר לפרסם את המודעה הזו.</p>
          </div>
          <Link
            href="/billing"
            className="shrink-0 inline-flex items-center gap-1.5 bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold px-3 py-2 rounded-lg"
          >
            <CreditCard className="w-4 h-4" /> שדרג מנוי
          </Link>
        </div>
      )}

      <WorkerAdForm
        submitLabel="המשך לתצוגה מקדימה"
        onSubmit={async (payload) => { setPreview(payload); }}
      />
      <AdPreviewModal
        payload={preview}
        onCancel={() => setPreview(null)}
        onConfirm={async () => {
          if (!preview) return;
          try {
            const created = await adApi.create(preview);
            router.push(`/corporation/ads?created=${created.id}`);
          } catch (e) {
            const msg = (e as Error).message ?? '';
            if (/tier_active_ad_limit|subscription_required|402/i.test(msg)) {
              setCapHit(true);
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
