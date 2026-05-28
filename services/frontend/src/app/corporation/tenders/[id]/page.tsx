'use client';

// Corp view of a foreign tender + bid submission. Contractor is
// anonymized as "קבלן" until the admin reveals. The corp fills how
// many of each requested profession it can supply (partial allowed),
// a total price, and a delivery estimate.

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Loader2, Globe2, AlertCircle, Users, Send, ShieldCheck, Clock,
  Phone, Mail, Building2,
} from 'lucide-react';
import { tenderApi, orgApi, type Tender, type Bid } from '@/lib/api';
import type { Corporation } from '@/types';
import { useEnums } from '@/features/enums/EnumsContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function CorpTenderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { professionMap, originMap } = useEnums();

  const [tender, setTender]   = useState<Tender | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Per-tender-item offered quantities + hourly rates, keyed by tender_item_id.
  const [offered, setOffered] = useState<Record<string, number>>({});
  const [rates, setRates]     = useState<Record<string, number>>({});
  const [arrival, setArrival] = useState('');
  const [notes, setNotes]     = useState('');
  const [contractorCorp, setContractorCorp] = useState<Corporation | null>(null);

  const load = useCallback(() => {
    tenderApi.get(id)
      .then((t) => {
        setTender(t);
        // Seed from an existing live bid (re-bid flow).
        const mine = (t.bids ?? []).find((b) => b.status === 'submitted' || b.status === 'selected' || b.status === 'confirmed');
        if (mine) {
          const seedQty: Record<string, number> = {};
          const seedRate: Record<string, number> = {};
          mine.items.forEach((bi) => {
            seedQty[bi.tender_item_id] = bi.quantity_offered;
            if (bi.hourly_rate != null) seedRate[bi.tender_item_id] = bi.hourly_rate;
          });
          setOffered(seedQty);
          setRates(seedRate);
          if (mine.arrival_date) setArrival(mine.arrival_date.slice(0, 10));
          if (mine.notes) setNotes(mine.notes);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'שגיאה'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const myBid: Bid | undefined = (tender?.bids ?? [])
    .find((b) => b.status !== 'withdrawn' && b.status !== 'rejected');
  const revealed = !!tender?.revealed_at;

  useEffect(() => {
    if (revealed && tender?.contractor_id && !contractorCorp) {
      // After reveal, surface the contractor's contact via the org
      // service. Contractor + corporation rows share the same
      // contact_* shape, so we reuse the Corporation type.
      orgApi.getContractor(tender.contractor_id)
        .then((c) => setContractorCorp(c as unknown as Corporation))
        .catch(() => {});
    }
  }, [revealed, tender, contractorCorp]);

  function setQty(itemId: string, val: number, max: number) {
    const clamped = Math.max(0, Math.min(val || 0, max));
    setOffered((prev) => ({ ...prev, [itemId]: clamped }));
  }
  function setRate(itemId: string, val: number) {
    setRates((prev) => ({ ...prev, [itemId]: Math.max(0, val || 0) }));
  }

  const totalOffered = Object.values(offered).reduce((s, n) => s + (n || 0), 0);
  const canSubmit = totalOffered > 0 && !submitting && tender?.status === 'open';

  async function submit() {
    if (!tender) return;
    const items = tender.items
      .filter((it) => (offered[it.id] || 0) > 0)
      .map((it) => ({
        tender_item_id: it.id,
        profession_type: it.profession_type,
        quantity_offered: offered[it.id],
        hourly_rate: rates[it.id] ? Number(rates[it.id]) : undefined,
      }));
    if (!items.length) { setError('יש להציע לפחות עובד אחד'); return; }
    setSubmitting(true); setError('');
    try {
      await tenderApi.submitBid(id, {
        arrival_date: arrival || undefined,
        notes: notes.trim() || undefined,
        items,
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בהגשת ההצעה');
    } finally { setSubmitting(false); }
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (error && !tender) return (
    <div className="max-w-3xl mx-auto px-4 py-10 text-center">
      <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" /><p className="text-slate-700">{error}</p>
    </div>
  );
  if (!tender) return null;

  const total = tender.items.reduce((s, i) => s + i.quantity, 0);
  const editable = tender.status === 'open';

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center gap-2 flex-wrap">
        <Globe2 className="h-6 w-6 text-brand-600" />
        <h1 className="text-2xl font-bold text-slate-900">{tender.title || `בקשה ל-${total} עובדים`}</h1>
      </header>

      <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/40 p-4 text-sm">
        <p className="text-slate-700">
          מאת: <span className="font-bold">{revealed && contractorCorp ? (contractorCorp.company_name_he || contractorCorp.company_name) : (tender.contractor_anon || 'קבלן')}</span>
          {tender.target_start_date && <> · התחלה רצויה: <span className="font-semibold">{tender.target_start_date.slice(0, 10)}</span></>}
        </p>
        {tender.notes && <p className="text-slate-500 mt-2">{tender.notes}</p>}
      </div>

      {/* Bid status banners */}
      {myBid?.status === 'selected' && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
          <Clock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-amber-900">הצעתך נבחרה! ממתין לאישור מנהל המערכת ותיאום תשלום.</p>
        </div>
      )}
      {myBid?.status === 'confirmed' && (
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-300 rounded-xl px-4 py-3">
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-900">זכית במכרז! 🎉</p>
            <p className="text-xs text-emerald-700 mt-0.5">פרטי הקבלן נחשפו — ניתן ליצור קשר ישירות.</p>
            {revealed && contractorCorp && (
              <div className="mt-2 space-y-1 text-xs text-emerald-800">
                {contractorCorp.contact_name && <p className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{contractorCorp.contact_name}</p>}
                {contractorCorp.contact_phone && <p className="inline-flex items-center gap-1.5" dir="ltr"><Phone className="h-3.5 w-3.5" />{contractorCorp.contact_phone}</p>}
                {contractorCorp.contact_email && <p className="inline-flex items-center gap-1.5" dir="ltr"><Mail className="h-3.5 w-3.5" />{contractorCorp.contact_email}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bid form / summary */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 space-y-3">
        <h2 className="font-bold text-slate-900">{editable ? 'הגש הצעה' : 'ההצעה שלך'}</h2>
        <p className="text-xs text-slate-500">ציין כמה עובדים מכל מקצוע אתה יכול לספק. ניתן להציע חלקית.</p>

        <div className="space-y-2">
          {tender.items.map((it) => (
            <div key={it.id} className="rounded-xl border border-slate-200 bg-slate-50/40 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <Users className="h-4 w-4 text-brand-600 shrink-0" />
                <span className="text-sm font-semibold text-slate-800 truncate">
                  {professionMap[it.profession_type] ?? it.profession_type}
                </span>
                <span className="text-xs text-slate-400 shrink-0">מבוקש: {it.quantity}</span>
                {it.origin_country && (
                  <span className="text-xs bg-white border border-slate-200 rounded-full px-2 py-0.5 text-slate-500 shrink-0">
                    {originMap[it.origin_country] ?? it.origin_country}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">אספק</span>
                  <input
                    type="number" min={0} max={it.quantity}
                    disabled={!editable}
                    value={offered[it.id] ?? ''}
                    onChange={(e) => setQty(it.id, Number(e.target.value), it.quantity)}
                    className="w-16 h-9 rounded-lg border border-slate-200 px-2 text-sm text-center disabled:bg-slate-100"
                    placeholder="0"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">₪/שעה</span>
                  <input
                    type="number" min={0} step="0.5"
                    disabled={!editable}
                    value={rates[it.id] ?? ''}
                    onChange={(e) => setRate(it.id, Number(e.target.value))}
                    className="w-20 h-9 rounded-lg border border-slate-200 px-2 text-sm text-center disabled:bg-slate-100"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-1">
          <Input label="מועד הגעה לארץ" type="date" disabled={!editable}
            value={arrival} onChange={(e) => setArrival(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">הערות (אופציונלי)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={!editable}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none disabled:bg-slate-100"
            placeholder="פירוט נוסף על ההצעה" />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

        {editable ? (
          <div className="flex gap-3">
            <Button type="button" disabled={!canSubmit} onClick={submit} className="flex-1">
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח…</>
                : <><Send className="h-4 w-4" /> {myBid ? 'עדכן הצעה' : 'הגש הצעה'} ({totalOffered} עובדים)</>}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/corporation/tenders')}>חזרה</Button>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={() => router.push('/corporation/tenders')} className="w-full">חזרה למכרזים</Button>
        )}
      </div>
    </div>
  );
}
