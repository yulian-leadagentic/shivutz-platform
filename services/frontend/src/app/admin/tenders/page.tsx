'use client';

// Admin oversight for foreign-import tenders. The admin's job here:
//   * see which tenders are awaiting approval (contractor selected,
//     payment to be arranged off-platform)
//   * inspect both parties (UNMASKED — admin sees everything)
//   * click "אשר וחשוף פרטים" to confirm the selection, reveal the
//     identities to both sides, and move the tender to in_progress.

import { useEffect, useState, useCallback } from 'react';
import {
  Loader2, Globe2, AlertCircle, Users, ShieldCheck, ChevronDown, Check,
} from 'lucide-react';
import { tenderApi, orgApi, type Tender } from '@/lib/api';
import { useEnums } from '@/features/enums/EnumsContext';
import { Button } from '@/components/ui/button';

const STATUS: Record<string, { cls: string; label: string }> = {
  open:           { cls: 'bg-sky-100 text-sky-800',        label: 'פתוח להצעות' },
  selecting:      { cls: 'bg-amber-100 text-amber-800',    label: 'בבחירה' },
  awaiting_admin: { cls: 'bg-amber-500 text-white',        label: 'ממתין לאישורך' },
  in_progress:    { cls: 'bg-emerald-500 text-white',      label: 'בתהליך' },
  closed:         { cls: 'bg-emerald-50 text-emerald-700', label: 'הושלם' },
  cancelled:      { cls: 'bg-rose-50 text-rose-700',       label: 'בוטל' },
};

function fmt(iso?: string | null) {
  if (!iso) return '—';
  const s = iso.includes(' ') && !iso.includes('T') ? iso.replace(' ', 'T') : iso;
  const z = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z';
  return new Date(z).toLocaleString('he-IL');
}

export default function AdminTendersPage() {
  const { professionMap } = useEnums();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [acting, setActing]   = useState<string | null>(null);
  // Resolved party names keyed by org id (admin sees real identities).
  const [names, setNames]     = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    tenderApi.adminListAll()
      .then((rows) => {
        setTenders(rows);
        // Resolve contractor + corp names for display.
        const ids = new Set<string>();
        rows.forEach((t) => {
          if (t.contractor_id) ids.add('c:' + t.contractor_id);
          (t.bids ?? []).forEach((b) => { if (b.corporation_id) ids.add('o:' + b.corporation_id); });
        });
        ids.forEach((tagged) => {
          const [kind, oid] = [tagged[0], tagged.slice(2)];
          const fetcher = kind === 'c' ? orgApi.getContractor(oid) : orgApi.getCorporation(oid);
          fetcher
            .then((o) => setNames((prev) => ({ ...prev, [oid]: o.company_name_he || o.company_name || oid.slice(0, 8) })))
            .catch(() => {});
        });
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function approve(id: string) {
    setActing(id);
    try { await tenderApi.adminApprove(id); load(); }
    catch { /* surfaced inline below by reload */ }
    finally { setActing(null); }
  }

  // Awaiting-admin first — that's the admin's action queue.
  const sorted = [...tenders].sort((a, b) => {
    const pr = (t: Tender) => (t.status === 'awaiting_admin' ? 0 : t.status === 'in_progress' ? 1 : 2);
    return pr(a) - pr(b);
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
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

      {!loading && !error && sorted.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl py-12 text-center text-slate-500">אין מכרזים במערכת</div>
      )}

      {!loading && !error && sorted.map((t) => {
        const pill = STATUS[t.status] ?? { cls: 'bg-slate-100 text-slate-700', label: t.status };
        const total = t.items.reduce((s, i) => s + i.quantity, 0);
        const selectedBids = (t.bids ?? []).filter((b) => b.status === 'selected' || b.status === 'confirmed');
        const isOpen = expanded === t.id;
        return (
          <div key={t.id} className={`rounded-2xl border-2 bg-white shadow-sm ${t.status === 'awaiting_admin' ? 'border-amber-400 ring-2 ring-amber-100' : 'border-slate-200'}`}>
            <button type="button" onClick={() => setExpanded(isOpen ? null : t.id)}
              className="w-full text-start p-4 sm:p-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-slate-900">{t.title || `מכרז ל-${total} עובדים`}</h3>
                  <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full ${pill.cls}`}>{pill.label}</span>
                </div>
                <p className="text-sm text-slate-600 mt-1.5">
                  קבלן: <span className="font-semibold">{t.contractor_id ? (names[t.contractor_id] || '…') : '—'}</span>
                  {' · '}{t.bids?.length ?? 0} הצעות
                  {selectedBids.length > 0 && <> · {selectedBids.length} נבחרו</>}
                </p>
                <p className="text-xs text-slate-400 mt-1">פורסם {fmt(t.created_at)}</p>
              </div>
              <ChevronDown className={`h-5 w-5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
              <div className="px-4 sm:px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
                {/* Requested */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">מבוקש</p>
                  <div className="flex flex-wrap gap-2">
                    {t.items.map((i) => (
                      <span key={i.id} className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-sm">
                        <Users className="h-3.5 w-3.5 text-slate-400" />
                        {i.quantity} {professionMap[i.profession_type] ?? i.profession_type}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Bids (unmasked for admin) */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">הצעות</p>
                  <div className="space-y-2">
                    {(t.bids ?? []).filter((b) => b.status !== 'withdrawn').map((b) => {
                      const isSel = b.status === 'selected' || b.status === 'confirmed';
                      return (
                        <div key={b.id} className={`rounded-xl border p-3 ${isSel ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900">
                              {b.corporation_id ? (names[b.corporation_id] || b.corporation_id.slice(0, 8)) : '—'}
                            </span>
                            <div className="flex items-center gap-2">
                              {b.total_price != null && <span className="text-sm font-bold">₪{b.total_price.toLocaleString('he-IL')}</span>}
                              {isSel && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-white">נבחר</span>}
                            </div>
                          </div>
                          <p className="text-xs text-slate-600 mt-1">
                            {b.items.map((it) => `${it.quantity_offered} ${professionMap[it.profession_type] ?? it.profession_type}`).join(' · ')}
                            {b.delivery_estimate_days != null && ` · ${b.delivery_estimate_days} ימים`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Approve action */}
                {t.status === 'awaiting_admin' && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
                    <p className="text-sm text-amber-900">
                      הקבלן בחר {selectedBids.length} הצעות. לאחר תיאום התשלום מול הצדדים — אשר כדי לחשוף את הפרטים לשני הצדדים.
                    </p>
                    <Button type="button" disabled={acting === t.id || selectedBids.length === 0}
                      className="bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => approve(t.id)}>
                      {acting === t.id
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> מאשר…</>
                        : <><ShieldCheck className="h-4 w-4" /> אשר וחשוף פרטים</>}
                    </Button>
                  </div>
                )}
                {t.status === 'in_progress' && (
                  <p className="inline-flex items-center gap-1.5 text-sm text-emerald-700 font-medium">
                    <Check className="h-4 w-4" /> אושר ונחשף ב-{fmt(t.revealed_at)}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
