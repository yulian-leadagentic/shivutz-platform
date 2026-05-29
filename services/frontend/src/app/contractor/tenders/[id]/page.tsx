'use client';

// Contractor tender detail — organized BY PROFESSION LINE. For each
// requested profession the contractor sees the competing offers from
// different corps (anonymized תאגיד N) with the per-line hourly rate
// and arrival date, and checks the specific lines to proceed with.
// Sending the selection = a contact request the admin must approve
// (gate 2) before identities are revealed.

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Loader2, Globe2, AlertCircle, Users, Check, Clock, ShieldCheck,
  Building2, Phone, Mail, XCircle, Send, Pencil, Snowflake, Play, Trash2, ArrowRight,
} from 'lucide-react';
import { tenderApi, orgApi, type Tender } from '@/lib/api';
import type { Corporation } from '@/types';
import { useEnums } from '@/features/enums/EnumsContext';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const STATUS: Record<string, { cls: string; label: string }> = {
  pending_admin:  { cls: 'bg-slate-200 text-slate-700',   label: 'ממתין לאישור פרסום' },
  open:           { cls: 'bg-sky-100 text-sky-800',       label: 'פתוח להצעות' },
  awaiting_admin: { cls: 'bg-amber-500 text-white',       label: 'בקשת קשר — ממתין למנהל' },
  in_progress:    { cls: 'bg-emerald-500 text-white',     label: 'בתהליך' },
  closed:         { cls: 'bg-emerald-50 text-emerald-700', label: 'הושלם' },
  cancelled:      { cls: 'bg-rose-50 text-rose-700',      label: 'בוטל' },
  frozen:         { cls: 'bg-sky-100 text-sky-700',       label: 'מוקפא' },
  rejected:       { cls: 'bg-rose-100 text-rose-700',     label: 'נדחה' },
};

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const s = iso.includes(' ') && !iso.includes('T') ? iso.replace(' ', 'T') : iso;
  const z = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z';
  return new Date(z).toLocaleDateString('he-IL');
}

export default function ContractorTenderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { professionMap, originMap } = useEnums();

  const [tender, setTender]   = useState<Tender | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  // Selected offer LINES (bid_item ids).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [acting, setActing] = useState(false);
  const [corpById, setCorpById] = useState<Record<string, Corporation>>({});

  const load = useCallback(() => {
    tenderApi.get(id)
      .then((t) => {
        setTender(t);
        // Pre-check whatever lines are already selected/confirmed.
        const pre = new Set<string>();
        (t.bids ?? []).forEach((b) => b.items.forEach((it) => { if (it.selected) pre.add(it.id); }));
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

  function toggle(bidItemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bidItemId)) next.delete(bidItemId); else next.add(bidItemId);
      return next;
    });
  }

  async function sendContactRequest() {
    if (selected.size === 0) return;
    setSubmitting(true); setError('');
    try {
      await tenderApi.selectLines(id, [...selected]);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשליחת הבקשה');
    } finally { setSubmitting(false); }
  }

  async function doCancel() {
    setConfirmCancel(false);
    try { await tenderApi.cancel(id); router.push('/contractor/tenders'); }
    catch (e) { setError(e instanceof Error ? e.message : 'שגיאה'); }
  }

  async function doDelete() {
    setConfirmDelete(false);
    try { await tenderApi.remove(id); router.push('/contractor/tenders'); }
    catch (e) { setError(e instanceof Error ? e.message : 'שגיאה'); }
  }

  async function doFreeze() {
    setActing(true); setError('');
    try { await tenderApi.freeze(id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'שגיאה'); }
    finally { setActing(false); }
  }

  async function doUnfreeze() {
    setActing(true); setError('');
    try { await tenderApi.unfreeze(id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'שגיאה'); }
    finally { setActing(false); }
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (error && !tender) return (
    <div className="max-w-3xl mx-auto px-4 py-10 text-center">
      <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" /><p className="text-slate-700">{error}</p>
    </div>
  );
  if (!tender) return null;

  const pill = STATUS[tender.status] ?? { cls: 'bg-slate-100 text-slate-700', label: tender.status };
  const revealed = !!tender.revealed_at;
  const locked = ['pending_admin', 'in_progress', 'closed', 'cancelled', 'frozen', 'rejected'].includes(tender.status);
  const totalWorkers = tender.items.reduce((s, i) => s + i.quantity, 0);
  const liveBids = (tender.bids ?? []).filter((b) => b.status !== 'withdrawn' && b.status !== 'rejected' && b.status !== 'pending_admin');

  // Edit only while still editable and no responses arrived yet.
  const canEdit   = ['pending_admin', 'open'].includes(tender.status) && liveBids.length === 0;
  const canFreeze = ['open', 'pending_admin'].includes(tender.status);
  const isFrozen  = tender.status === 'frozen';
  const canCancel = !['pending_admin', 'in_progress', 'closed', 'cancelled', 'rejected'].includes(tender.status);

  // Flatten into per-line offers: for each tender item, the competing
  // bid lines from all live bids.
  const offersByLine = tender.items.map((ti) => {
    const offers = liveBids.flatMap((b) =>
      b.items
        .filter((bi) => bi.tender_item_id === ti.id)
        .map((bi) => ({ bi, corpAnon: b.corp_anon, corpId: b.corporation_id, arrival: b.arrival_date, bidStatus: b.status })),
    );
    return { ti, offers };
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      {/* Back to the requests list */}
      <button type="button" onClick={() => router.push('/contractor/tenders')}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ArrowRight className="h-4 w-4" /> חזרה לבקשות
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Globe2 className="h-6 w-6 text-brand-600" />
          <h1 className="text-2xl font-bold text-slate-900">{tender.title || `בקשה ל-${totalWorkers} עובדים`}</h1>
          <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full ${pill.cls}`}>{pill.label}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => router.push(`/contractor/tenders/${id}/edit`)}>
              <Pencil className="h-4 w-4" /> ערוך
            </Button>
          )}
          {canFreeze && (
            <Button variant="outline" size="sm" disabled={acting} onClick={doFreeze}>
              <Snowflake className="h-4 w-4" /> הקפא
            </Button>
          )}
          {isFrozen && (
            <Button variant="outline" size="sm" disabled={acting} onClick={doUnfreeze}>
              <Play className="h-4 w-4" /> הפעל מחדש
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" size="sm" className="text-rose-600 border-rose-200 hover:bg-rose-50"
              onClick={() => setConfirmCancel(true)}>
              <XCircle className="h-4 w-4" /> בטל בקשה
            </Button>
          )}
          <Button variant="outline" size="sm" className="text-rose-600 border-rose-200 hover:bg-rose-50"
            onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" /> מחק
          </Button>
        </div>
      </div>

      {/* Status banners */}
      {tender.status === 'pending_admin' && (
        <div className="flex items-start gap-3 bg-slate-100 border border-slate-200 rounded-xl px-4 py-3">
          <Clock className="h-5 w-5 text-slate-500 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-700">הבקשה ממתין לאישור מנהל המערכת לפני פרסום לתאגידים. תקבל הצעות לאחר האישור.</p>
        </div>
      )}
      {tender.status === 'awaiting_admin' && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
          <Clock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">בקשת יצירת קשר נשלחה למנהל המערכת</p>
            <p className="text-xs text-amber-700 mt-0.5">מנהל המערכת יתאם את התשלום וייצור קשר. פרטי התאגיד ייחשפו לאחר האישור.</p>
          </div>
        </div>
      )}
      {tender.status === 'frozen' && (
        <div className="flex items-start gap-3 bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
          <Snowflake className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" />
          <p className="text-sm text-sky-900">הבקשה מוקפאת ואינה מוצגת לתאגידים. ניתן להפעיל אותה מחדש בכל עת.</p>
        </div>
      )}
      {tender.status === 'rejected' && (
        <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-rose-900">הבקשה נדחתה על ידי מנהל המערכת</p>
            {tender.rejection_reason && <p className="text-xs text-rose-700 mt-0.5">סיבה: {tender.rejection_reason}</p>}
          </div>
        </div>
      )}
      {revealed && (
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-300 rounded-xl px-4 py-3">
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-emerald-900">הבקשה אושרה — פרטי התאגידים הזוכים נחשפו (ראה למטה בכל שורה).</p>
        </div>
      )}

      {/* Per-line offers */}
      <div className="space-y-4">
        {offersByLine.map(({ ti, offers }) => (
          <div key={ti.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {/* Line header */}
            <div className="bg-brand-50/50 px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Users className="h-4 w-4 text-brand-600" />
                <span className="font-bold text-base text-slate-900">{professionMap[ti.profession_type] ?? ti.profession_type}</span>
                <span className="font-bold text-base text-brand-700">× {ti.quantity}</span>
                {ti.origin_country && (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold bg-white border border-brand-200 rounded-full px-2.5 py-0.5 text-brand-700">
                    <Globe2 className="h-3.5 w-3.5" />
                    {originMap[ti.origin_country] ?? ti.origin_country}
                  </span>
                )}
              </div>
            </div>

            {/* Offers for this line */}
            {offers.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-400 text-center">עדיין אין הצעות לשורה זו</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {offers.map(({ bi, corpAnon, corpId, arrival, bidStatus }) => {
                  const isSel = selected.has(bi.id);
                  const corp = corpId ? corpById[corpId] : undefined;
                  const partial = bi.quantity_offered < ti.quantity;
                  const confirmed = bidStatus === 'confirmed' && bi.selected;
                  return (
                    <div key={bi.id} className={`px-4 py-3 flex items-center gap-3 ${isSel ? 'bg-brand-50/40' : ''}`}>
                      {!locked ? (
                        <button type="button" onClick={() => toggle(bi.id)}
                          className={`h-6 w-6 rounded-md border-2 flex items-center justify-center shrink-0 transition ${
                            isSel ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-300 hover:border-brand-400'}`}
                          aria-label="בחר שורה">
                          {isSel && <Check className="h-4 w-4" />}
                        </button>
                      ) : confirmed ? (
                        <span className="h-6 w-6 rounded-md bg-emerald-500 text-white flex items-center justify-center shrink-0"><Check className="h-4 w-4" /></span>
                      ) : <span className="h-6 w-6 shrink-0" />}

                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                        <span className="font-semibold text-slate-900 truncate">
                          {revealed && corp ? (corp.company_name_he || corp.company_name) : (corpAnon || 'תאגיד')}
                        </span>
                        {confirmed && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">זוכה</span>}
                      </div>

                      <div className="text-end shrink-0">
                        <div className="text-sm">
                          <span className={partial ? 'text-amber-700 font-semibold' : 'text-slate-900 font-semibold'}>
                            {bi.quantity_offered}/{ti.quantity}
                          </span>
                          {partial && <span className="text-[10px] text-amber-600"> (חלקי)</span>}
                        </div>
                        <div className="text-sm font-extrabold text-slate-900">
                          {bi.hourly_rate != null ? `₪${bi.hourly_rate}/שעה` : '—'}
                        </div>
                        {arrival && <div className="text-[11px] text-slate-400">הגעה: {fmtDate(arrival)}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Revealed corp contacts */}
      {revealed && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-2">
          <p className="text-sm font-bold text-emerald-900">פרטי קשר — תאגידים זוכים</p>
          {liveBids.filter((b) => b.status === 'confirmed' && b.corporation_id).map((b) => {
            const corp = corpById[b.corporation_id as string];
            if (!corp) return null;
            return (
              <div key={b.id} className="text-xs text-emerald-800 flex flex-wrap gap-x-4 gap-y-1">
                <span className="font-semibold">{corp.company_name_he || corp.company_name}</span>
                {corp.contact_name && <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{corp.contact_name}</span>}
                {corp.contact_phone && <span className="inline-flex items-center gap-1" dir="ltr"><Phone className="h-3.5 w-3.5" />{corp.contact_phone}</span>}
                {corp.contact_email && <span className="inline-flex items-center gap-1" dir="ltr"><Mail className="h-3.5 w-3.5" />{corp.contact_email}</span>}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

      {/* Send contact request */}
      {!locked && liveBids.length > 0 && (
        <div className="sticky bottom-4">
          <Button type="button" size="lg" className="w-full shadow-lg"
            disabled={selected.size === 0 || submitting} onClick={sendContactRequest}>
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח…</>
              : selected.size === 0
                ? 'בחר שורות להתקדם איתן'
                : <><Send className="h-4 w-4" /> שלח בקשת יצירת קשר ({selected.size} שורות)</>}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="ביטול בקשה"
        message="הפעולה תבטל את הבקשה וכל ההצעות שהתקבלו. האם להמשיך?"
        confirmLabel="בטל בקשה"
        cancelLabel="חזרה"
        variant="destructive"
        onConfirm={doCancel}
        onCancel={() => setConfirmCancel(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="מחיקת בקשה"
        message="הבקשה תימחק לצמיתות יחד עם כל ההצעות. לא ניתן לשחזר. האם להמשיך?"
        confirmLabel="מחק לצמיתות"
        cancelLabel="חזרה"
        variant="destructive"
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
