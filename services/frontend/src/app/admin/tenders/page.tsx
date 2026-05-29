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
  XCircle, Pencil, Snowflake, Play, Trash2, Hash, Save,
} from 'lucide-react';
import { tenderApi, orgApi, type Tender } from '@/lib/api';
import { useEnums } from '@/features/enums/EnumsContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const STATUS: Record<string, { cls: string; label: string }> = {
  pending_admin:  { cls: 'bg-slate-800 text-white',        label: 'ממתין לאישור פרסום' },
  open:           { cls: 'bg-sky-100 text-sky-800',        label: 'פתוח להצעות' },
  awaiting_admin: { cls: 'bg-amber-500 text-white',        label: 'בקשת קשר — ממתין לאישורך' },
  in_progress:    { cls: 'bg-emerald-500 text-white',      label: 'בתהליך' },
  closed:         { cls: 'bg-emerald-50 text-emerald-700', label: 'הושלם' },
  cancelled:      { cls: 'bg-rose-50 text-rose-700',       label: 'בוטל' },
  frozen:         { cls: 'bg-sky-100 text-sky-700',        label: 'מוקפא' },
  rejected:       { cls: 'bg-rose-100 text-rose-700',      label: 'נדחה' },
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
  // Inline reject (free-text reason) + edit (PII scrub) + delete confirm.
  const [rejecting, setRejecting]   = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [editing, setEditing]       = useState<string | null>(null);
  const [editTitle, setEditTitle]   = useState('');
  const [editNotes, setEditNotes]   = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Per-bid approval gate.
  const [actingBid, setActingBid]   = useState<string | null>(null);
  const [rejectingBid, setRejectingBid] = useState<string | null>(null);
  const [bidRejectReason, setBidRejectReason] = useState('');

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

  async function publish(id: string) {
    setActing(id);
    try { await tenderApi.adminPublish(id); load(); }
    catch { /* surfaced by reload */ }
    finally { setActing(null); }
  }

  async function reject(id: string) {
    setActing(id);
    try { await tenderApi.adminReject(id, rejectReason.trim()); setRejecting(null); setRejectReason(''); load(); }
    catch { /* surfaced by reload */ }
    finally { setActing(null); }
  }

  async function freeze(id: string) {
    setActing(id);
    try { await tenderApi.freeze(id); load(); }
    catch { /* */ }
    finally { setActing(null); }
  }

  async function unfreeze(id: string) {
    setActing(id);
    try { await tenderApi.unfreeze(id); load(); }
    catch { /* */ }
    finally { setActing(null); }
  }

  async function doDelete(id: string) {
    setConfirmDelete(null);
    setActing(id);
    try { await tenderApi.remove(id); load(); }
    catch { /* */ }
    finally { setActing(null); }
  }

  function startEdit(t: Tender) {
    setEditing(t.id);
    setEditTitle(t.title ?? '');
    setEditNotes(t.notes ?? '');
  }

  async function saveEdit(id: string) {
    setActing(id);
    try {
      await tenderApi.edit(id, { title: editTitle.trim() || undefined, notes: editNotes.trim() || undefined });
      setEditing(null); load();
    } catch { /* */ }
    finally { setActing(null); }
  }

  async function approveBid(tid: string, bidId: string) {
    setActingBid(bidId);
    try { await tenderApi.adminApproveBid(tid, bidId); load(); }
    catch { /* */ }
    finally { setActingBid(null); }
  }

  async function rejectBid(tid: string, bidId: string) {
    setActingBid(bidId);
    try { await tenderApi.adminRejectBid(tid, bidId, bidRejectReason.trim()); setRejectingBid(null); setBidRejectReason(''); load(); }
    catch { /* */ }
    finally { setActingBid(null); }
  }

  const pendingBidCount = (t: Tender) => (t.bids ?? []).filter((b) => b.status === 'pending_admin').length;

  // Action queue order: pending publish first, then tenders with bids
  // awaiting approval, then contact requests, then in-progress, the rest.
  const sorted = [...tenders].sort((a, b) => {
    const pr = (t: Tender) =>
      t.status === 'pending_admin' ? 0
      : pendingBidCount(t) > 0 ? 0.5
      : t.status === 'awaiting_admin' ? 1
      : t.status === 'in_progress' ? 2 : 3;
    return pr(a) - pr(b);
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center gap-2">
        <Globe2 className="h-6 w-6 text-brand-600" />
        <h1 className="text-2xl font-bold text-slate-900">בקשות ייבוא עובדים</h1>
      </header>

      {loading && <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {error && !loading && (
        <div className="bg-white border border-slate-200 rounded-2xl py-12 text-center">
          <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-2" />
          <p className="text-slate-700">לא ניתן לטעון את הבקשות</p>
        </div>
      )}

      {!loading && !error && sorted.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl py-12 text-center text-slate-500">אין בקשות במערכת</div>
      )}

      {!loading && !error && sorted.map((t) => {
        const pill = STATUS[t.status] ?? { cls: 'bg-slate-100 text-slate-700', label: t.status };
        const total = t.items.reduce((s, i) => s + i.quantity, 0);
        const selectedBids = (t.bids ?? []).filter((b) => b.status === 'selected' || b.status === 'confirmed');
        const pending = pendingBidCount(t);
        const isOpen = expanded === t.id;
        return (
          <div key={t.id} className={`rounded-2xl border-2 bg-white shadow-sm ${
            t.status === 'pending_admin' ? 'border-slate-800 ring-2 ring-slate-200'
            : pending > 0 ? 'border-slate-800 ring-2 ring-slate-200'
            : t.status === 'awaiting_admin' ? 'border-amber-400 ring-2 ring-amber-100'
            : 'border-slate-200'}`}>
            <button type="button" onClick={() => setExpanded(isOpen ? null : t.id)}
              className="w-full text-start p-4 sm:p-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-slate-900">{t.title || `בקשה ל-${total} עובדים`}</h3>
                  <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full ${pill.cls}`}>{pill.label}</span>
                </div>
                <p className="text-sm text-slate-600 mt-1.5">
                  קבלן: <span className="font-semibold">{t.contractor_id ? (names[t.contractor_id] || '…') : '—'}</span>
                  {' · '}{t.bids?.length ?? 0} הצעות
                  {selectedBids.length > 0 && <> · {selectedBids.length} נבחרו</>}
                  {pending > 0 && (
                    <span className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-white ms-1">
                      {pending} ממתינות לאישורך
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400 mt-1">פורסם {fmt(t.created_at)}</p>
              </div>
              <ChevronDown className={`h-5 w-5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
              <div className="px-4 sm:px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
                {/* Admin toolbar — edit (PII scrub), freeze, delete */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={acting === t.id}
                    onClick={() => (editing === t.id ? setEditing(null) : startEdit(t))}>
                    <Pencil className="h-4 w-4" /> ערוך / הסתר פרטים
                  </Button>
                  {['open', 'pending_admin'].includes(t.status) && (
                    <Button type="button" variant="outline" size="sm" disabled={acting === t.id}
                      onClick={() => freeze(t.id)}>
                      <Snowflake className="h-4 w-4" /> הקפא
                    </Button>
                  )}
                  {t.status === 'frozen' && (
                    <Button type="button" variant="outline" size="sm" disabled={acting === t.id}
                      onClick={() => unfreeze(t.id)}>
                      <Play className="h-4 w-4" /> הפעל מחדש
                    </Button>
                  )}
                  {!['rejected', 'closed', 'cancelled', 'in_progress'].includes(t.status) && (
                    <Button type="button" variant="outline" size="sm"
                      className="text-amber-700 border-amber-200 hover:bg-amber-50" disabled={acting === t.id}
                      onClick={() => { setRejecting(rejecting === t.id ? null : t.id); setRejectReason(''); }}>
                      <XCircle className="h-4 w-4" /> דחה בקשה
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="sm"
                    className="text-rose-600 border-rose-200 hover:bg-rose-50" disabled={acting === t.id}
                    onClick={() => setConfirmDelete(t.id)}>
                    <Trash2 className="h-4 w-4" /> מחק
                  </Button>
                </div>

                {/* Inline reject — free-text reason shown to the contractor */}
                {rejecting === t.id && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-3">
                    <div>
                      <label className="text-xs font-medium text-amber-900 block mb-1">סיבת הדחייה (אופציונלי)</label>
                      <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={2}
                        className="w-full rounded-lg border border-amber-200 px-3 py-2 text-sm resize-none"
                        placeholder="לדוגמה: חסרים פרטים בבקשה" />
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" disabled={acting === t.id}
                        className="bg-rose-600 hover:bg-rose-700" onClick={() => reject(t.id)}>
                        {acting === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} אשר דחייה
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setRejecting(null)}>ביטול</Button>
                    </div>
                  </div>
                )}

                {/* Inline edit — scrub the contractor's title / notes so the
                    request stays anonymous to corps (phone, company name). */}
                {editing === t.id && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                    <Input label="כותרת" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="כותרת הבקשה" />
                    <div>
                      <label className="text-xs font-medium text-slate-600 block mb-1">הערות</label>
                      <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
                    </div>
                    <p className="text-xs text-slate-500">הסר פרטים מזהים (טלפון, שם חברה) כדי לשמור על אנונימיות מול התאגידים.</p>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" disabled={acting === t.id} onClick={() => saveEdit(t.id)}>
                        {acting === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} שמור
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>ביטול</Button>
                    </div>
                  </div>
                )}

                {/* Requested (with per-line origin) */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">מבוקש</p>
                  <div className="flex flex-wrap gap-2">
                    {t.items.map((i) => (
                      <span key={i.id} className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-sm">
                        <Users className="h-3.5 w-3.5 text-slate-400" />
                        {i.quantity} {professionMap[i.profession_type] ?? i.profession_type}
                        {i.origin_country && <span className="text-xs text-slate-400">({i.origin_country})</span>}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Bids (unmasked for admin) — per-line hourly rates */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1.5">הצעות</p>
                  <div className="space-y-2">
                    {(t.bids ?? []).filter((b) => b.status !== 'withdrawn').map((b) => {
                      const isSel = b.status === 'selected' || b.status === 'confirmed';
                      const isPending = b.status === 'pending_admin';
                      return (
                        <div key={b.id} className={`rounded-xl border p-3 ${
                          isSel ? 'border-emerald-300 bg-emerald-50/40'
                          : isPending ? 'border-slate-800 ring-1 ring-slate-200'
                          : b.status === 'rejected' ? 'border-rose-200 bg-rose-50/30'
                          : 'border-slate-200'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 inline-flex items-center gap-2 flex-wrap">
                              {b.corporation_id ? (names[b.corporation_id] || b.corporation_id.slice(0, 8)) : '—'}
                              {b.corp_ref_no != null && (
                                <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                                  <Hash className="h-3 w-3" />אצל התאגיד: בקשה {b.corp_ref_no}
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-2">
                              {b.arrival_date && <span className="text-xs text-slate-500">הגעה {fmt(b.arrival_date)}</span>}
                              {isPending && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-white">ממתין לאישורך</span>}
                              {b.status === 'rejected' && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">נדחתה</span>}
                              {isSel && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-white">נבחר</span>}
                            </div>
                          </div>
                          <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                            {b.items.map((it) => (
                              <div key={it.id} className={`flex items-center justify-between ${it.selected ? 'text-emerald-700 font-semibold' : ''}`}>
                                <span>{it.selected && '✓ '}{it.quantity_offered} {professionMap[it.profession_type] ?? it.profession_type}</span>
                                <span>{it.hourly_rate != null ? `₪${it.hourly_rate}/שעה` : '—'}</span>
                              </div>
                            ))}
                          </div>

                          {/* Per-bid approval gate — corp bid is hidden from
                              the contractor until the admin approves it. */}
                          {isPending && (
                            <div className="mt-2 pt-2 border-t border-slate-200">
                              <p className="text-xs text-slate-600 mb-2">הצעה חדשה — תוצג לקבלן רק לאחר אישורך.</p>
                              {rejectingBid === b.id ? (
                                <div className="space-y-2">
                                  <textarea value={bidRejectReason} onChange={(e) => setBidRejectReason(e.target.value)} rows={2}
                                    className="w-full rounded-lg border border-rose-200 px-3 py-2 text-sm resize-none"
                                    placeholder="סיבת הדחייה (אופציונלי)" />
                                  <div className="flex gap-2">
                                    <Button type="button" size="sm" disabled={actingBid === b.id}
                                      className="bg-rose-600 hover:bg-rose-700" onClick={() => rejectBid(t.id, b.id)}>
                                      {actingBid === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} אשר דחייה
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" onClick={() => setRejectingBid(null)}>ביטול</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex gap-2">
                                  <Button type="button" size="sm" disabled={actingBid === b.id}
                                    className="bg-emerald-600 hover:bg-emerald-700" onClick={() => approveBid(t.id, b.id)}>
                                    {actingBid === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} אשר הצעה
                                  </Button>
                                  <Button type="button" size="sm" variant="outline"
                                    className="text-rose-600 border-rose-200 hover:bg-rose-50"
                                    onClick={() => { setRejectingBid(b.id); setBidRejectReason(''); }}>
                                    <XCircle className="h-4 w-4" /> דחה
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                          {b.status === 'rejected' && b.rejection_reason && (
                            <p className="text-xs text-rose-700 mt-2 pt-2 border-t border-rose-100">סיבת דחייה: {b.rejection_reason}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Gate 1 — publish approval */}
                {t.status === 'pending_admin' && (
                  <div className="rounded-xl bg-slate-100 border border-slate-300 p-3 space-y-2">
                    <p className="text-sm text-slate-700">
                      בקשה חדשה ממתין לאישורך. לאחר אישור הפרסום הוא יישלח לכל התאגידים לקבלת הצעות.
                    </p>
                    <Button type="button" disabled={acting === t.id}
                      onClick={() => publish(t.id)}>
                      {acting === t.id
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> מפרסם…</>
                        : <><ShieldCheck className="h-4 w-4" /> אשר ופרסם לתאגידים</>}
                    </Button>
                  </div>
                )}

                {/* Gate 2 — contact-request approval + reveal */}
                {t.status === 'awaiting_admin' && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
                    <p className="text-sm text-amber-900">
                      הקבלן בחר {selectedBids.length} תאגידים. לאחר תיאום התשלום מול הצדדים — אשר כדי לחשוף את הפרטים לשני הצדדים.
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
                {t.status === 'rejected' && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 p-3">
                    <p className="text-sm font-semibold text-rose-900 inline-flex items-center gap-1.5">
                      <XCircle className="h-4 w-4" /> הבקשה נדחתה
                    </p>
                    {t.rejection_reason && <p className="text-xs text-rose-700 mt-1">סיבה: {t.rejection_reason}</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="מחיקת בקשה"
        message="הבקשה תימחק לצמיתות יחד עם כל ההצעות. לא ניתן לשחזר. האם להמשיך?"
        confirmLabel="מחק לצמיתות"
        cancelLabel="חזרה"
        variant="destructive"
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
