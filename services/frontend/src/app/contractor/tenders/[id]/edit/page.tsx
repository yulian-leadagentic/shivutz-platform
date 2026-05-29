'use client';

// Edit an import request. Only reachable while the request is still
// editable (pending_admin / open) and has no bids — the detail page
// hides the "ערוך" button otherwise, and the API rejects it anyway.

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, AlertCircle } from 'lucide-react';
import { tenderApi, type Tender } from '@/lib/api';
import TenderForm from '@/components/tenders/TenderForm';

export default function EditTenderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tender, setTender] = useState<Tender | null>(null);
  const [error, setError]   = useState('');

  useEffect(() => {
    tenderApi.get(id)
      .then(setTender)
      .catch((e) => setError(e instanceof Error ? e.message : 'שגיאה'));
  }, [id]);

  if (error) return (
    <div className="max-w-3xl mx-auto px-4 py-10 text-center">
      <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" /><p className="text-slate-700">{error}</p>
    </div>
  );
  if (!tender) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;

  return (
    <TenderForm
      mode="edit"
      initial={{
        title: tender.title,
        target_start_date: tender.target_start_date,
        notes: tender.notes,
        items: tender.items.map((it) => ({
          profession_type: it.profession_type,
          origin_country: it.origin_country,
          quantity: it.quantity,
          min_experience: it.min_experience,
        })),
      }}
      onSubmit={async (payload) => {
        await tenderApi.edit(id, payload);
        router.push(`/contractor/tenders/${id}`);
      }}
      onCancel={() => router.push(`/contractor/tenders/${id}`)}
    />
  );
}
