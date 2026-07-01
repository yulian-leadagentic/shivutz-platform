'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { adApi } from '@/lib/api/ads';
import { WorkerAdForm } from '@/features/ads/WorkerAdForm';

export default function NewWorkerAdPage() {
  const router = useRouter();
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-1">
        <Link href="/corporation/ads/new" className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700">
          <ChevronRight className="w-3 h-3 me-1" /> חזרה לבחירת סוג מודעה
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">מודעת עובדים חדשה</h1>
        <p className="text-sm text-slate-500">תיאור חופשי משפר את ההתאמה בחיפושי קבלנים</p>
      </header>
      <WorkerAdForm
        submitLabel="פרסם מודעה"
        onSubmit={async (payload) => {
          const created = await adApi.create(payload);
          router.push(`/corporation/ads/${created.id}/edit`);
        }}
      />
    </div>
  );
}
