'use client';

// Admin inbox for customer-service tickets (QA-R3 #24). Triaged by
// status pill (open · in_progress · resolved) and listed newest first.
// Each row expands inline so the admin can read the full body, leave
// notes, and move the status without leaving the page.

import { useEffect, useState } from 'react';
import {
  Loader2, MessageCircle, Inbox, Building2, User, Phone, Mail,
  CheckCircle2, Clock, AlertCircle, ChevronDown, RotateCcw,
} from 'lucide-react';
import { adminApi } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';

type Status = 'open' | 'in_progress' | 'resolved';

interface Ticket {
  id: string;
  entity_type: 'contractor' | 'corporation' | 'admin' | null;
  entity_id: string | null;
  user_id: string | null;
  subject: string;
  body: string;
  contact_phone: string | null;
  status: Status;
  created_at: string;
  handled_at: string | null;
  handled_by_user_id: string | null;
  admin_notes: string | null;
  org_name?: string | null;
  org_phone?: string | null;
  org_email?: string | null;
  user_phone?: string | null;
  user_name?: string | null;
}

const FILTERS: Array<{ key: 'all' | Status; label: string; tone: string }> = [
  { key: 'all',         label: 'הכל',         tone: 'bg-slate-700 text-white border-slate-700' },
  { key: 'open',        label: 'פתוחות',      tone: 'bg-amber-500 text-white border-amber-500' },
  { key: 'in_progress', label: 'בטיפול',      tone: 'bg-sky-500  text-white border-sky-500' },
  { key: 'resolved',    label: 'נסגרו',       tone: 'bg-emerald-500 text-white border-emerald-500' },
];

const STATUS_PILL: Record<Status, { cls: string; label: string; icon: typeof Clock }> = {
  open:        { cls: 'bg-amber-100   text-amber-800',   label: 'פתוחה',  icon: AlertCircle },
  in_progress: { cls: 'bg-sky-100     text-sky-800',     label: 'בטיפול', icon: Clock },
  resolved:    { cls: 'bg-emerald-100 text-emerald-800', label: 'נסגרה',  icon: CheckCircle2 },
};

const ENTITY_LABEL: Record<string, string> = {
  contractor:  'קבלן',
  corporation: 'תאגיד',
  admin:       'אדמין',
};

function fmt(iso: string | null) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso; }
}

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [filter, setFilter]   = useState<'all' | Status>('open');
  const [openId, setOpenId]   = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  async function reload() {
    setLoading(true); setError('');
    try {
      const data = await adminApi.listSupportTickets(filter === 'all' ? undefined : filter);
      setTickets(data as Ticket[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת הפניות');
    } finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, [filter]);

  async function setStatus(id: string, status: Status, notes?: string) {
    setRowBusy(id);
    try {
      await adminApi.updateSupportTicket(id, {
        status,
        ...(notes !== undefined ? { admin_notes: notes } : {}),
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בעדכון');
    } finally { setRowBusy(null); }
  }

  const counts = tickets.reduce<Record<Status, number>>(
    (acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }),
    { open: 0, in_progress: 0, resolved: 0 },
  );

  return (
    <div className="max-w-4xl space-y-4">
      <header className="flex items-start gap-2">
        <MessageCircle className="h-6 w-6 text-brand-600 mt-1" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">פניות שירות לקוחות</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            פניות שמשתמשים שולחים דרך &quot;פנייה לשירות לקוחות&quot;. עבור על הרשימה, השאר הערה פנימית, וסמן בטיפול / נסגרה.
          </p>
        </div>
      </header>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => {
          const isOn = filter === f.key;
          const count = f.key === 'all'
            ? tickets.length
            : (counts[f.key as Status] ?? 0);
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                isOn ? f.tone : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                isOn ? 'bg-white/25' : 'bg-slate-100 text-slate-600'
              }`}>{count}</span>
              {f.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700 inline-flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* List */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-12 px-4 space-y-2">
            <Inbox className="h-10 w-10 text-slate-200 mx-auto" />
            <p className="text-sm text-slate-500">אין פניות בקטגוריה זו.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {tickets.map((t) => {
              const open = openId === t.id;
              const pill = STATUS_PILL[t.status];
              const PillIcon = pill.icon;
              const draft = draftNotes[t.id] ?? (t.admin_notes ?? '');
              const busy = rowBusy === t.id;
              return (
                <div key={t.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : t.id)}
                    className="w-full text-start px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3"
                  >
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full mt-0.5 shrink-0 ${pill.cls}`}>
                      <PillIcon className="h-3 w-3" />
                      {pill.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 truncate">{t.subject}</span>
                        {t.entity_type && (
                          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">
                            {ENTITY_LABEL[t.entity_type] ?? t.entity_type}
                          </span>
                        )}
                        {t.org_name && (
                          <span className="text-xs text-slate-700 inline-flex items-center gap-1">
                            <Building2 className="h-3 w-3 text-slate-400" />
                            {t.org_name}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-3 flex-wrap">
                        <span>{fmt(t.created_at)}</span>
                        {t.user_name && (
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3 w-3" /> {t.user_name}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>

                  {open && (
                    <div className="px-4 pb-4 pt-1 bg-slate-50/60 border-t border-slate-100 space-y-3">
                      <div className="rounded-lg bg-white border border-slate-200 p-3 text-sm text-slate-800 whitespace-pre-wrap">
                        {t.body}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-600">
                        {(t.contact_phone || t.user_phone || t.org_phone) && (
                          <div className="rounded-md border border-slate-200 bg-white p-2.5">
                            <p className="font-bold text-slate-500 mb-1 text-[10px] uppercase tracking-wide">קשר לפנייה</p>
                            {t.contact_phone && (
                              <p className="inline-flex items-center gap-1.5" dir="ltr">
                                <Phone className="h-3 w-3" />
                                <a href={`tel:${t.contact_phone}`} className="text-brand-700 hover:underline">{t.contact_phone}</a>
                                <span className="text-slate-400 text-[10px]" dir="rtl">(שצוין בפנייה)</span>
                              </p>
                            )}
                            {!t.contact_phone && t.user_phone && (
                              <p className="inline-flex items-center gap-1.5" dir="ltr">
                                <Phone className="h-3 w-3" />
                                <a href={`tel:${t.user_phone}`} className="text-brand-700 hover:underline">{t.user_phone}</a>
                                <span className="text-slate-400 text-[10px]" dir="rtl">(טלפון משתמש)</span>
                              </p>
                            )}
                            {t.org_phone && (
                              <p className="inline-flex items-center gap-1.5 mt-0.5" dir="ltr">
                                <Phone className="h-3 w-3" />
                                <a href={`tel:${t.org_phone}`} className="text-brand-700 hover:underline">{t.org_phone}</a>
                                <span className="text-slate-400 text-[10px]" dir="rtl">(טלפון ארגון)</span>
                              </p>
                            )}
                            {t.org_email && (
                              <p className="inline-flex items-center gap-1.5 mt-0.5" dir="ltr">
                                <Mail className="h-3 w-3" />
                                <a href={`mailto:${t.org_email}`} className="text-brand-700 hover:underline">{t.org_email}</a>
                              </p>
                            )}
                          </div>
                        )}
                        {t.handled_at && (
                          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-emerald-800">
                            <p className="font-bold mb-1 text-[10px] uppercase tracking-wide">סטטוס טיפול</p>
                            <p>נסגרה ב-{fmt(t.handled_at)}</p>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">הערות פנימיות</label>
                        <textarea
                          value={draft}
                          onChange={(e) => setDraftNotes((s) => ({ ...s, [t.id]: e.target.value }))}
                          rows={2}
                          placeholder="הערה פנימית — לא נחשפת ללקוח"
                          className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm resize-none"
                        />
                      </div>

                      <div className="flex flex-wrap gap-2 justify-end">
                        {t.status !== 'in_progress' && (
                          <Button size="sm" variant="outline" disabled={busy}
                            onClick={() => setStatus(t.id, 'in_progress', draft)}>
                            <Clock className="h-3.5 w-3.5" /> סמן בטיפול
                          </Button>
                        )}
                        {t.status !== 'resolved' && (
                          <Button size="sm" disabled={busy}
                            onClick={() => setStatus(t.id, 'resolved', draft)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white">
                            {busy
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <><CheckCircle2 className="h-3.5 w-3.5" /> סגור פנייה</>}
                          </Button>
                        )}
                        {t.status === 'resolved' && (
                          <Button size="sm" variant="outline" disabled={busy}
                            onClick={() => setStatus(t.id, 'open', draft)}>
                            <RotateCcw className="h-3.5 w-3.5" /> פתח מחדש
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
