'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { adApi, type AdCreateInput } from '@/lib/api/ads';
import { HousingAdForm } from '@/features/ads/HousingAdForm';
import { AdPreviewModal } from '@/features/ads/AdPreviewModal';

export default function NewHousingAdPage() {
  const router = useRouter();
  const [preview, setPreview] = useState<AdCreateInput | null>(null);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-1">
        <Link href="/corporation/ads/new" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 me-1" /> חזרה לבחירת סוג מודעה
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">מודעת דיור חדשה</h1>
        <p className="text-sm text-slate-500">מיטות פנויות לפועלים, לפי עיר ואזור</p>
      </header>
      <HousingAdForm
        submitLabel="המשך לתצוגה מקדימה"
        onSubmit={async (payload) => { setPreview(payload); }}
      />
      <AdPreviewModal
        payload={preview}
        onCancel={() => setPreview(null)}
        onConfirm={async () => {
          if (!preview) return;
          const created = await adApi.create(preview);
          router.push(`/corporation/ads?created=${created.id}`);
        }}
      />
    </div>
  );
}
