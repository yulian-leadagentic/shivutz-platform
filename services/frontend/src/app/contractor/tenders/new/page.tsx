'use client';

// Contractor foreign-import request builder.
// One request can ask for several professions (15 carpenters, 5
// plasterers, 10 tilers). Published → admin approves → broadcast to
// corps → they bid → contractor selects → admin approves + reveals.

import { useRouter } from 'next/navigation';
import { tenderApi } from '@/lib/api';
import TenderForm from '@/components/tenders/TenderForm';

export default function NewTenderPage() {
  const router = useRouter();
  return (
    <TenderForm
      mode="create"
      onSubmit={async (payload) => {
        const res = await tenderApi.create(payload);
        router.push(`/contractor/tenders/${res.id}`);
      }}
      onCancel={() => router.push('/contractor/tenders')}
    />
  );
}
