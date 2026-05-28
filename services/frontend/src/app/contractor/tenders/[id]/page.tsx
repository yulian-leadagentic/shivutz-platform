'use client';

// Contractor tender detail — request summary + side-by-side bid
// comparison. Corps are anonymized (תאגיד N) until the admin reveals.
// Contractor checks the bids they want and sends the selection to the
// admin, who arranges payment off-platform and reveals identities.

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Loader2, Globe2, AlertCircle, Users, Check, Clock, ShieldCheck,
  Building2, Phone, Mail, XCircle,
} from 'lucide-react';
import { tenderApi, orgApi, type Tender, type Bid } from '@/lib/api';
import type { Corporation } from '@/types';
import { useEnums } from '@/features/enums/EnumsContext';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const STATUS: Record<string, { cls: string; label: string }> = {
  open:           { cls: 'bg-sky-100 text-sky-800',       label: 'פתוח להצעות' },
  selecting:      { cls: 'bg-amber-100 text-amber-800',   label: 'בבחירה' },
  awaiting_admin: { cls: 'bg-amber-500 text-white',       label: 'ממתין לאישור מנהל' },
  in_progress:    { cls: 'bg-emerald-500 text-white',     label: 'בתהליך' },
  closed:         { cls: 'bg-emerald-50 text-emerald-700', label: 'הושלם' },
  cancelled:      { cls: 'bg-rose-50 text-rose-700',      label: 'בוטל' },
};

export default function ContractorTenderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { professionMap } = useEnums();

  const [tender, setTender]   = useState<Tender | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Revealed corp contact details, lazy-loaded once the admin reveals.
  const [corpById, setCorpById] = useState<Record<string, Corporation>>({});

  const load = useCallback(() => {
    tenderApi.get(id)
      .then((t) => {
        setTender(t);
        // Pre-check whatever's already selected/confirmed.
        const pre = new Set((t.bids ?? []).filter((b) => b.status === 'selected' || b.status === 'confirmed').map((b) => b.id));
        setSelected(pre);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'שגיאה'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // After reveal, fetch the confirmed corps' contact info.
  useEffect(() => {
    if (!tender?.revealed_at || !tender.bids) return;
    for (const b of tender.bids) {
      if (b.corporation_id && !corpById[b.corporation_id]) {
        orgApi.getCorporation(b.corporation_id)
          .then((c) => setCorpById((prev) => ({ ...prev, [b.corporation_id as string]: c })))
          .catch(() => {});
      }
    }
  }, [tender, corpById]);

  function toggle(bidId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bidId)) next.delete(bidId); else next.add(bidId);
      return next;
    });
  }

  async function sendSelection() {
    if (selected.size === 0) return;
    setSubmitting(true); setError('');
    try {
      await tenderApi.select(id, [...selected]);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשליחת הבחירה');
    } finally { setSubmitting(false); }
  }

  async function doCancel() {
    setConfirmCancel(false);
    try { await tenderApi.cancel(id); router.push('/contractor/tenders'); }
    catch (e) { setError(e instanceof Error ? e.message : 'שגיאה'); }
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (error && !tender) return (
    <div className="max-w-3xl mx-auto px-4 py-10 text-center">
      <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
      <p className="text-slate-700">{error}</p>
    </div>
  );
  if (!tender) return null;

  const pill = STATUS[tender.status] ?? { cls: 'bg-slate-100 text-slate-700', label: tender.status };
  const bids = (tender.bids ?? []).filter((b) => b.status !== 'withdrawn' && b.status !== 'rejected');
  const revealed = !!tender.revealed_at;
  const locked = tender.status === 'in_progress' || tender.status === 'closed' || tender.status === 'cancelled';
  const totalWorkers = tender.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Globe2 className="h-6 w-6 text-brand-600" />
            <h1 className="text-2xl font-bold text-slate-900">{tender.title || `מכרז ל-${totalWorkers} עובדים`}</h1>
            <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full ${pill.cls}`}>{pill.label}</span>
          </div>
        </div>
        {!locked && (
          <Button variant="outline" size="sm" className="text-rose-600 border-rose-200 hover:bg-rose-50"
            onClick={() => setConfirmCancel(true)}>
            <XCircle className="h-4 w-4" /> בטל מכרז
          </Button>
        )}
      </div>

      {/* Request summary */}
      <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/40 p-4">
        <p className="text-xs text-slate-500 mb-2">מה ביקשת</p>
        <div className="flex flex-wrap gap-2">
          {tender.items.map((i) => (
            <span key={i.id} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
              <Users className="h-3.5 w-3.5 text-brand-600" />
              <span className="font-bold text-slate-900">{i.quantity}</span>
              <span className="text-slate-700">{professionMap[i.profession_type] ?? i.profession_type}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Admin-status banner */}
      {tender.status === 'awaiting_admin' && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
          <Clock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">בחירתך נשלחה למנהל המערכת</p>
            <p className="text-xs text-amber-700 mt-0.5">מנהל המערכת יתאם את התשלום וייצור קשר. פרטי התאגיד ייחשפו לאחר האישור.</p>
          </div>
        </div>
      )}
      {revealed && (
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-300 rounded-xl px-4 py-3">
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-900">המכרז אושר — פרטי התאגיד נחשפו</p>
            <p className="text-xs text-emerald-700 mt-0.5">ניתן ליצור קשר ישיר עם התאגיד הזוכה דרך הפרטים למטה.</p>
          </div>
        </div>
      )}

      {/* Bids */}
      <div>
        <h2 className="font-bold text-slate-900 mb-3">
          הצעות שהתקבלו {bids.length > 0 && <span className="text-slate-400 font-normal">({bids.length})</span>}
        </h2>

        {bids.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl py-10 text-center text-slate-500 text-sm">
            עדיין לא התקבלו הצעות. ההצעות יופיעו כאן ברגע שתאגידים יגישו.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {bids.map((b) => {
              const isSel = selected.has(b.id);
              const corp = b.corporation_id ? corpById[b.corporation_id] : undefined;
              return (
                <div key={b.id}
                  className={`rounded-2xl border-2 bg-white shadow-sm transition overflow-hidden ${
                    b.status === 'confirmed' ? 'border-emerald-400 ring-2 ring-emerald-100'
                    : isSel ? 'border-brand-400 ring-2 ring-brand-100'
                    : 'border-slate-200'}`}>
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-slate-400" />
                        <span className="font-bold text-slate-900">
                          {revealed && corp ? (corp.company_name_he || corp.company_name) : (b.corp_anon || 'תאגיד')}
                        </span>
                      </div>
                      {b.status === 'confirmed'
                        ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-white">זוכה</span>
                        : !locked && (
                          <button type="button" onClick={() => toggle(b.id)}
                            className={`h-6 w-6 rounded-md border-2 flex items-center justify-center transition ${
                              isSel ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-300 hover:border-brand-400'}`}
                            aria-label="בחר הצעה">
                            {isSel && <Check className="h-4 w-4" />}
                          </button>
                        )}
                    </div>

                    {/* Per-profession offered */}
                    <div className="space-y-1">
                      {b.items.map((it) => {
                        const req = tender.items.find((ti) => ti.id === it.tender_item_id);
                        const partial = req && it.quantity_offered < req.quantity;
                        return (
                          <div key={it.id} className="flex items-center justify-between text-sm">
                            <span className="text-slate-700">{professionMap[it.profession_type] ?? it.profession_type}</span>
                            <span className={partial ? 'text-amber-700 font-semibold' : 'text-slate-900 font-semibold'}>
                              {it.quantity_offered}{req ? `/${req.quantity}` : ''}
                              {partial && <span className="text-[11px] font-normal text-amber-600 me-1"> (חלקי)</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-sm">
                      <span className="text-slate-500">מחיר כולל</span>
                      <span className="font-extrabold text-slate-900">
                        {b.total_price != null ? `₪${b.total_price.toLocaleString('he-IL')}` : '—'}
                      </span>
                    </div>
                    {b.delivery_estimate_days != null && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">זמן אספקה</span>
                        <span className="text-slate-700">{b.delivery_estimate_days} ימים</span>
                      </div>
                    )}
                    {b.notes && <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-2.5 py-2">{b.notes}</p>}

                    {/* Revealed corp contact */}
                    {revealed && corp && (
                      <div className="pt-2 border-t border-slate-100 space-y-1 text-xs text-slate-600">
                        {corp.contact_name && <p className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{corp.contact_name}</p>}
                        {corp.contact_phone && <p className="inline-flex items-center gap-1.5" dir="ltr"><Phone className="h-3.5 w-3.5" />{corp.contact_phone}</p>}
                        {corp.contact_email && <p className="inline-flex items-center gap-1.5" dir="ltr"><Mail className="h-3.5 w-3.5" />{corp.contact_email}</p>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

      {/* Selection action */}
      {!locked && bids.length > 0 && (
        <div className="sticky bottom-4">
          <Button type="button" size="lg" className="w-full shadow-lg"
            disabled={selected.size === 0 || submitting} onClick={sendSelection}>
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח…</>
              : selected.size === 0
                ? 'בחר הצעה אחת או יותר'
                : <><Check className="h-4 w-4" /> שלח בחירה למנהל ({selected.size})</>}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="ביטול מכרז"
        message="הפעולה תבטל את המכרז וכל ההצעות שהתקבלו. האם להמשיך?"
        confirmLabel="בטל מכרז"
        cancelLabel="חזרה"
        variant="destructive"
        onConfirm={doCancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}
