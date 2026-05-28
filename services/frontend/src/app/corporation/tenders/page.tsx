'use client';

// Corp incoming-tenders inbox. Two sections:
//   1. Open tenders available to bid on (contractor anonymized).
//   2. My bids — status across all tenders.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Globe2, Users, AlertCircle, ArrowLeft } from 'lucide-react';
import { tenderApi, type Tender, type Bid } from '@/lib/api';
import { useEnums } from '@/features/enums/EnumsContext';

const BID_STATUS: Record<string, { cls: string; label: string }> = {
  submitted: { cls: 'bg-sky-100 text-sky-800',        label: 'הוגשה' },
  selected:  { cls: 'bg-amber-500 text-white',        label: 'נבחרה — ממתין למנהל' },
  confirmed: { cls: 'bg-emerald-500 text-white',      label: 'זכית!' },
  rejected:  { cls: 'bg-rose-50 text-rose-700',       label: 'לא נבחרה' },
  withdrawn: { cls: 'bg-slate-100 text-slate-500',    label: 'נמשכה' },
};

function fmt(iso?: string | null) {
  if (!iso) return '—';
  const s = iso.includes(' ') && !iso.includes('T') ? iso.replace(' ', 'T') : iso;
  const z = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z';
  return new Date(z).toLocaleDateString('he-IL');
}

export default function CorpTendersPage() {
  const { professionMap } = useEnums();
  const [open, setOpen]     = useState<Tender[]>([]);
  const [bids, setBids]     = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(false);

  useEffect(() => {
    Promise.all([tenderApi.listOpen(), tenderApi.myBids()])
      .then(([o, b]) => { setOpen(o); setBids(b); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // Open tenders this corp hasn't bid on yet (or only withdrawn).
  const biddableOpen = open.filter((t) => !t.my_bid || t.my_bid.status === 'withdrawn');

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-center gap-2">
        <Globe2 className="h-6 w-6 text-brand-600" />
        <h1 className="text-2xl font-bold text-slate-900">מכרזי ייבוא עובדים</h1>
      </header>

      {loading && <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {error && !loading && (
        <div className="bg-white border border-slate-200 rounded-2xl py-12 text-center">
          <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-2" />
          <p className="text-slate-700">לא ניתן לטעון את המכרזים</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* ── Open tenders to bid on ── */}
          <section className="space-y-3">
            <h2 className="font-bold text-slate-900">
              מכרזים פתוחים להצעה {biddableOpen.length > 0 && <span className="text-slate-400 font-normal">({biddableOpen.length})</span>}
            </h2>
            {biddableOpen.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-8 text-center text-slate-500 text-sm">
                אין כרגע מכרזים פתוחים שטרם הגשת אליהם הצעה.
              </div>
            ) : biddableOpen.map((t) => {
              const total = t.items.reduce((s, i) => s + i.quantity, 0);
              return (
                <Link key={t.id} href={`/corporation/tenders/${t.id}`}
                  className="block rounded-2xl border-2 border-amber-300 bg-amber-50/30 hover:bg-amber-50 hover:shadow-md transition p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-900">{t.title || `בקשה ל-${total} עובדים`}</h3>
                      <p className="text-sm text-slate-600 mt-1.5 inline-flex items-center gap-1.5">
                        <Users className="h-4 w-4 text-slate-400" />
                        {t.items.map((i) => `${i.quantity} ${professionMap[i.profession_type] ?? i.profession_type}`).join(' · ')}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        {t.contractor_anon || 'קבלן'} · פורסם {fmt(t.created_at)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-amber-700 inline-flex items-center gap-1">
                      הגש הצעה <ArrowLeft className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </section>

          {/* ── My bids ── */}
          <section className="space-y-3">
            <h2 className="font-bold text-slate-900">
              ההצעות שלי {bids.length > 0 && <span className="text-slate-400 font-normal">({bids.length})</span>}
            </h2>
            {bids.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl py-8 text-center text-slate-500 text-sm">
                עדיין לא הגשת הצעות.
              </div>
            ) : bids.map((b) => {
              const pill = BID_STATUS[b.status] ?? { cls: 'bg-slate-100 text-slate-700', label: b.status };
              const t = b.tender;
              const total = t?.items.reduce((s, i) => s + i.quantity, 0) ?? 0;
              return (
                <Link key={b.id} href={`/corporation/tenders/${b.tender_id}`}
                  className="block rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900">{t?.title || `מכרז ל-${total} עובדים`}</h3>
                        <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full ${pill.cls}`}>{pill.label}</span>
                      </div>
                      <p className="text-sm text-slate-600 mt-1">
                        הצעתך: {b.items.reduce((s, i) => s + i.quantity_offered, 0)} עובדים
                        {b.arrival_date && ` · הגעה ${fmt(b.arrival_date)}`}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">הוגש {fmt(b.submitted_at)}</p>
                    </div>
                    <ArrowLeft className="h-5 w-5 text-slate-300 shrink-0" />
                  </div>
                </Link>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
