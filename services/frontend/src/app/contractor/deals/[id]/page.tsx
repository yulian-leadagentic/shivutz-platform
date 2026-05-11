'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2, Send, FileText, Users, Clock, CheckCircle2,
  Building2, Phone, Mail, UserCheck, HandshakeIcon, Download, X,
} from 'lucide-react';
import { dealApi, workerApi, orgApi } from '@/lib/api';
import { dealRef } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import StatusBadge from '@/components/StatusBadge';
import type { Deal, Message, Worker, Corporation } from '@/types';
import { EXPERIENCE_LABEL as EXP_LABELS } from '@/i18n/he';

interface ReportForm {
  actual_workers: string;
  actual_start_date: string;
  actual_end_date: string;
}

const STATUS_EXPLANATION: Record<string, { icon: React.ReactNode; text: string; color: string }> = {
  proposed: {
    icon: <Clock className="h-4 w-4 shrink-0" />,
    text: 'הפנייה נשלחה לתאגיד — ממתין שהתאגיד יציג רשימת עובדים',
    color: 'bg-blue-50 border-blue-200 text-blue-800',
  },
  corp_committed: {
    icon: <Users className="h-4 w-4 shrink-0" />,
    text: 'התאגיד הציג רשימת עובדים — בדוק ואשר תוך 7 ימים',
    color: 'bg-amber-50 border-amber-200 text-amber-800',
  },
  approved: {
    icon: <CheckCircle2 className="h-4 w-4 shrink-0" />,
    text: 'ממתינים שתאשר שנסגרה עסקה',
    color: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  },
  rejected: {
    icon: <Clock className="h-4 w-4 shrink-0" />,
    text: 'דחית את ההצעה — הבקשה נשארת פתוחה',
    color: 'bg-slate-50 border-slate-200 text-slate-700',
  },
  expired: {
    icon: <Clock className="h-4 w-4 shrink-0" />,
    text: 'ההצעה פגה (לא אושרה תוך 7 ימים) — הבקשה נשארת פתוחה',
    color: 'bg-slate-50 border-slate-200 text-slate-700',
  },
  cancelled_by_corp: {
    icon: <Clock className="h-4 w-4 shrink-0" />,
    text: 'התאגיד ביטל לפני החיוב — לא חויבת. הבקשה נשארת פתוחה',
    color: 'bg-red-50 border-red-200 text-red-800',
  },
  cancelled_by_contractor: {
    icon: <Clock className="h-4 w-4 shrink-0" />,
    text: 'סימנת שהעסקה לא נסגרה — לא חויבת',
    color: 'bg-slate-50 border-slate-200 text-slate-700',
  },
  closed: {
    icon: <CheckCircle2 className="h-4 w-4 shrink-0" />,
    text: 'אישרת שהעסקה נסגרה — תודה',
    color: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  },
};

const STATUS_LABEL_HE: Record<string, string> = {
  proposed:                  'הפנייה נשלחה',
  corp_committed:            'תאגיד הציג רשימה',
  approved:                  'אושר',
  rejected:                  'נדחה',
  expired:                   'פג תוקף',
  cancelled_by_corp:         'בוטל ע״י התאגיד',
  cancelled_by_contractor:   'לא נסגרה',
  closed:                    'נסגר',
};

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [deal, setDeal]         = useState<Deal | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [workers, setWorkers]   = useState<Worker[]>([]);
  const [corp, setCorp]         = useState<Corporation | null>(null);
  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  // Close-the-loop (status='approved' → contractor confirms whether
  // the deal actually closed off-platform).
  const [closing, setClosing] = useState<'confirm' | 'decline' | null>(null);
  const [closeError, setCloseError] = useState('');
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  const [reportForm, setReportForm] = useState<ReportForm>({
    actual_workers: '', actual_start_date: '', actual_end_date: '',
  });
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadDeal() {
    const d = await dealApi.get(id);
    setDeal(d);
    if (d.corporation_id) {
      orgApi.getCorporation(d.corporation_id)
        .then((c) => setCorp(c))
        .catch(() => {});
    }
    return d;
  }

  async function loadMessages() {
    try {
      const msgs = await dealApi.messages(id);
      setMessages(msgs);
    } catch { /* silent */ }
  }

  async function loadWorkers() {
    try {
      // The deal-service endpoint already applies the disclosure rules: pre-
      // approval, contractors get { full_name, internal_id, profession_type,
      // origin_country, years_in_israel, languages }. Don't re-fetch from
      // worker-service — that would leak phone/visa/etc.
      const list = await dealApi.workers(id);
      setWorkers((list as unknown as Worker[]) || []);
    } catch { /* graceful */ }
  }

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        await loadDeal();
        await Promise.all([loadMessages(), loadWorkers()]);
      } catch {
        setError('שגיאה בטעינת העסקה');
      } finally {
        setLoading(false);
      }
    }
    init();
    pollRef.current = setInterval(loadMessages, 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!msgInput.trim()) return;
    setSending(true);
    try {
      const msg = await dealApi.sendMsg(id, msgInput.trim());
      setMessages((prev) => [...prev, msg]);
      setMsgInput('');
    } catch { /* keep input */ }
    finally { setSending(false); }
  }

  async function handleConfirm() {
    setConfirming(true);
    setConfirmError('');
    try {
      await dealApi.approve(id);
      await Promise.all([loadDeal(), loadMessages(), loadWorkers()]);
    } catch (e: unknown) {
      setConfirmError(e instanceof Error ? e.message : 'שגיאה באישור ההתקשרות');
    } finally {
      setConfirming(false);
    }
  }

  async function handleReject() {
    if (!confirm('לדחות את הרשימה? הבקשה תישאר פתוחה ונחפש מענה במקום אחר.')) return;
    setConfirming(true);
    setConfirmError('');
    try {
      await dealApi.reject(id);
      await Promise.all([loadDeal(), loadMessages()]);
    } catch (e: unknown) {
      setConfirmError(e instanceof Error ? e.message : 'שגיאה בדחיית ההצעה');
    } finally {
      setConfirming(false);
    }
  }

  /** Contractor confirms the off-platform deal closed. Moves the
   *  deal to 'closed'. Commission charging path is untouched —
   *  whatever scheduled capture / billing rules already applied to
   *  the approved state still apply. */
  async function handleContractorConfirmClosed() {
    setClosing('confirm');
    setCloseError('');
    try {
      await dealApi.contractorConfirmClosed(id);
      await loadDeal();
    } catch (e: unknown) {
      setCloseError(e instanceof Error ? e.message : 'שגיאה באישור סגירת העסקה');
    } finally {
      setClosing(null);
    }
  }

  /** Contractor declines: the deal did not close. Captures the
   *  free-text reason, voids the J5 hold via the backend, moves the
   *  deal to 'cancelled_by_contractor'. */
  async function handleContractorDeclineClosed() {
    setClosing('decline');
    setCloseError('');
    try {
      await dealApi.contractorDeclineClosed(id, declineReason.trim());
      setDeclineDialogOpen(false);
      setDeclineReason('');
      await loadDeal();
    } catch (e: unknown) {
      setCloseError(e instanceof Error ? e.message : 'שגיאה בעדכון העסקה');
    } finally {
      setClosing(null);
    }
  }

  async function handleReport(e: React.FormEvent) {
    e.preventDefault();
    setReportSubmitting(true);
    try {
      await dealApi.report(id, {
        actual_workers: Number(reportForm.actual_workers),
        actual_start_date: reportForm.actual_start_date,
        actual_end_date: reportForm.actual_end_date,
      });
      setReportSuccess(true);
    } catch { /* silent */ }
    finally { setReportSubmitting(false); }
  }

  function formatDate(iso: string | undefined) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('he-IL');
  }

  function senderLabel(role: string) {
    return role === 'contractor' ? 'קבלן' : role === 'corporation' ? 'תאגיד' : 'מערכת';
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="animate-spin h-6 w-6 me-2" />טוען עסקה...
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
        {error || 'העסקה לא נמצאה'}
      </div>
    );
  }

  const showReport     = ['active', 'reporting'].includes(deal.status);
  const showConfirm    = deal.status === 'corp_committed';
  const showWorkers    = ['corp_committed', 'approved', 'closed', 'cancelled_by_corp',
                           'accepted', 'active', 'reporting', 'completed'].includes(deal.status);
  const isPostDisclosure = ['approved', 'closed', 'cancelled_by_corp'].includes(deal.status);
  const statusInfo     = STATUS_EXPLANATION[deal.status];
  const corpName       = corp?.company_name_he || corp?.company_name || '';
  const dealAny        = deal as unknown as { profession_he?: string; region_he?: string; requested_count?: number; worker_count?: number; expires_at?: string; commission_amount?: number };
  const expiresHours   = dealAny.expires_at
    ? Math.max(0, Math.round((new Date(dealAny.expires_at).getTime() - Date.now()) / 3_600_000))
    : null;

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">עסקה #{dealRef(id)}</h1>
            <span className="text-xs font-medium px-2.5 py-0.5 rounded-full border border-slate-300 bg-slate-50 text-slate-700">
              {STATUS_LABEL_HE[deal.status] || deal.status}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span>נוצרה: {formatDate(deal.created_at)}</span>
            {isPostDisclosure && corpName && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                {corpName}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Request summary — what we asked for vs what's offered */}
      <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/40 p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-slate-500 mb-0.5">מקצוע</p>
          <p className="text-base font-bold text-slate-900">{dealAny.profession_he || '—'}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-0.5">אזור</p>
          <p className="text-base font-bold text-slate-900">{dealAny.region_he || '—'}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-0.5">כמות מבוקשת</p>
          <p className="text-base font-bold text-slate-900">{dealAny.requested_count ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-0.5">הוצעו לך</p>
          <p className="text-base font-bold text-slate-900">{dealAny.worker_count ?? workers.length ?? 0}</p>
        </div>
      </div>

      {/* 7-day countdown for corp_committed */}
      {deal.status === 'corp_committed' && expiresHours !== null && (
        <div className={`flex items-center gap-2 text-sm rounded-xl px-4 py-2.5 border ${
          expiresHours < 24
            ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <Clock className="h-4 w-4 shrink-0" />
          <span>
            {expiresHours > 0
              ? `נותרו ${expiresHours} שעות לאישור — לאחר מכן ההצעה תפוג והעובדים ישוחררו`
              : 'ההצעה פגה'}
          </span>
        </div>
      )}

      {/* Status banner */}
      {statusInfo && (
        <div className={`flex items-center gap-2.5 border rounded-xl px-4 py-3 text-sm font-medium ${statusInfo.color}`}>
          {statusInfo.icon}
          {statusInfo.text}
        </div>
      )}

      {/* Approved → contractor close-the-loop. The contractor has
          revealed corp details and is coordinating off-platform; we
          ask back: did this actually close? */}
      {deal.status === 'approved' && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-emerald-900">סגירת העסקה</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-700 leading-relaxed">
              לאחר התיאום עם התאגיד, אנא עדכן אם העסקה אכן נסגרה.
            </p>
            {closeError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {closeError}
              </p>
            )}
            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={handleContractorConfirmClosed}
                disabled={closing}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {closing === 'confirm'
                  ? <><Loader2 className="h-4 w-4 animate-spin me-2" />מעדכן...</>
                  : <><CheckCircle2 className="h-4 w-4 me-2" />אושרה עסקה</>}
              </Button>
              <Button
                variant="outline"
                onClick={() => setDeclineDialogOpen(true)}
                disabled={!!closing}
              >
                <X className="h-4 w-4 me-2" />
                לא אושרה עסקה
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Decline-with-reason dialog */}
      {declineDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">העסקה לא נסגרה</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              נודה לך אם תפרט מדוע העסקה לא נסגרה. הפרטים יעזרו לנו להבין מה השתבש ולשפר את ההתאמות.
            </p>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={4}
              maxLength={500}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none resize-none"
              placeholder="לדוגמה: התאגיד לא חזר אלי, העובדים לא התאימו, מצאתי בחברה אחרת..."
            />
            {closeError && (
              <p className="text-sm text-red-600">{closeError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => { setDeclineDialogOpen(false); setDeclineReason(''); setCloseError(''); }}
                disabled={closing === 'decline'}
              >
                ביטול
              </Button>
              <Button
                onClick={handleContractorDeclineClosed}
                disabled={closing === 'decline'}
                className="bg-slate-700 hover:bg-slate-800 text-white"
              >
                {closing === 'decline'
                  ? <><Loader2 className="h-4 w-4 animate-spin me-2" />שולח...</>
                  : 'אשר ושלח'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Standard contract document (shown once attached) ── */}
      {deal.standard_contract_url && (
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
          <FileText className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-800 mb-0.5">
              חוזה התקשרות סטנדרטי — צורף על ידי התאגיד
            </p>
            <p className="text-xs text-blue-600">
              {deal.standard_contract_doc_name || 'חוזה התקשרות'}
            </p>
          </div>
          <a
            href={deal.standard_contract_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 border border-blue-300 rounded-lg px-3 py-1.5 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            הורד
          </a>
        </div>
      )}

      {/* ── ACCEPTED: Corporation contact + workers + confirm button ── */}
      {showConfirm && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-emerald-800">
              <HandshakeIcon className="h-5 w-5" />
              אישור התקשרות
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Corporation contact */}
            {corp && (
              <div className="bg-white rounded-xl border border-emerald-100 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  פרטי יצירת קשר — תאגיד
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                    <span className="font-medium">{corpName}</span>
                  </div>
                  {corp.contact_name && (
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <UserCheck className="h-4 w-4 text-slate-400 shrink-0" />
                      <span>{corp.contact_name}</span>
                    </div>
                  )}
                  {corp.contact_phone && (
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                      <a href={`tel:${corp.contact_phone}`} className="text-brand-600 hover:underline font-medium">
                        {corp.contact_phone}
                      </a>
                    </div>
                  )}
                  {corp.contact_email && (
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Mail className="h-4 w-4 text-slate-400 shrink-0" />
                      <a href={`mailto:${corp.contact_email}`} className="text-brand-600 hover:underline">
                        {corp.contact_email}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Workers list — pre-approval (this screen, status =
                corp_committed) hides names + internal IDs. Contractor
                gets to evaluate profession / experience / origin /
                languages without identifying info, which keeps a
                level playing field across deals and avoids "I'll
                pick them by name" shortcuts. Names + internal IDs
                are unlocked AFTER the contractor approves the list
                — that block lives further down in this page (search
                for "post-disclosure"). */}
            {workers.length > 0 && (
              <div className="bg-white rounded-xl border border-emerald-100 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  רשימת עובדים שהוצעה ({workers.length})
                </p>
                <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                  פרטי הזיהוי של העובדים יוצגו לאחר אישור הרשימה. כעת מוצגים מקצוע, ניסיון וארץ מוצא בלבד.
                </p>
                <div className="space-y-2">
                  {workers.map((w, idx) => {
                    const wAny = w as unknown as { years_in_israel?: number; experience_range?: string };
                    return (
                      <div key={w.id} className="flex items-center gap-3 py-1.5 border-b border-slate-50 last:border-0">
                        <div className="h-8 w-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0 text-xs font-bold text-brand-700">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900">עובד #{idx + 1}</p>
                          <p className="text-xs text-slate-500">
                            {w.profession_type}
                            {wAny.experience_range && <> · ניסיון {wAny.experience_range}</>}
                            {!wAny.experience_range && w.experience_years != null && <> · {w.experience_years} שנים ניסיון</>}
                            {w.origin_country && <> · {w.origin_country}</>}
                            {wAny.years_in_israel != null && <> · {wAny.years_in_israel} שנים בישראל</>}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Approve / Reject actions */}
            {confirmError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {confirmError}
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={handleConfirm}
                disabled={confirming || workers.length === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {confirming
                  ? <><Loader2 className="h-4 w-4 animate-spin me-2" />מעבד...</>
                  : <><CheckCircle2 className="h-4 w-4 me-2" />הצג פרטי תאגיד ({workers.length} עובדים)</>
                }
              </Button>
              <Button
                onClick={handleReject}
                disabled={confirming}
                variant="outline"
                className="text-red-700 border-red-200 hover:bg-red-50"
              >
                דחה
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Workers panel (post-acceptance, non-confirm states) */}
        {!showConfirm && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-brand-600" />
                עובדים משובצים
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!showWorkers ? (
                <p className="text-slate-400 text-sm text-center py-4">
                  שמות העובדים יוצגו ברגע שהתאגיד יציג רשימה
                </p>
              ) : workers.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-4">אין עובדים משובצים</p>
              ) : (
                <div className="-mx-4 sm:mx-0 overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px] sm:min-w-0">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-100">
                        <th className="px-4 sm:px-0 pb-2 font-medium text-start">שם</th>
                        <th className="px-4 sm:px-0 pb-2 font-medium text-start">מס׳ פנימי</th>
                        <th className="px-4 sm:px-0 pb-2 font-medium text-start">מקצוע</th>
                        <th className="px-4 sm:px-0 pb-2 font-medium text-start">מדינה</th>
                        <th className="px-4 sm:px-0 pb-2 font-medium text-start">שנים בארץ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workers.map((w) => {
                        const wAny = w as unknown as { full_name?: string; internal_id?: string; years_in_israel?: number };
                        const name = wAny.full_name || `${w.first_name ?? ''} ${w.last_name ?? ''}`.trim() || '—';
                        return (
                          <tr key={w.id} className="border-b border-slate-50 last:border-0">
                            <td className="px-4 sm:px-0 py-2 font-medium">{name}</td>
                            <td className="px-4 sm:px-0 py-2 text-slate-500 text-xs font-mono" dir="ltr">{wAny.internal_id ?? '—'}</td>
                            <td className="px-4 sm:px-0 py-2 text-slate-600">{w.profession_type}</td>
                            <td className="px-4 sm:px-0 py-2 text-slate-600">{w.origin_country || '—'}</td>
                            <td className="px-4 sm:px-0 py-2 text-slate-500 text-xs">{wAny.years_in_israel ?? '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Messages panel */}
        <Card className={`flex flex-col ${showConfirm ? 'lg:col-span-2' : ''}`} style={{ minHeight: 360 }}>
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-base">הודעות</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 p-0">
            <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 320 }}>
              {messages.length === 0 ? (
                <p className="text-slate-400 text-sm text-center pt-4">אין הודעות עדיין</p>
              ) : (
                messages.map((msg) => {
                  const isSystem = msg.content_type === 'system' || msg.sender_role === 'admin';
                  const isContractor = msg.sender_role === 'contractor';
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col gap-0.5 ${isContractor ? 'items-end' : 'items-start'}`}
                    >
                      <div className={`flex items-center gap-2 text-xs text-slate-400 ${isContractor ? 'flex-row-reverse' : ''}`}>
                        <span className="font-medium text-slate-600">{senderLabel(msg.sender_role)}</span>
                        <span>{formatDate(msg.created_at)}</span>
                      </div>
                      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-line
                        ${isSystem
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs w-full max-w-full'
                          : isContractor
                            ? 'bg-brand-600 text-white'
                            : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-3 border-t border-slate-100 flex gap-2">
              <Input
                placeholder="כתוב הודעה..."
                value={msgInput}
                onChange={(e) => setMsgInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                className="flex-1"
              />
              <Button size="sm" onClick={handleSend} disabled={sending || !msgInput.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                <span className="sr-only">שלח</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Report section */}
      {showReport && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-brand-600" />
              הגשת דוח ביצוע
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reportSuccess ? (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-700 text-sm font-medium">
                ✓ הדוח הוגש בהצלחה
              </div>
            ) : (
              <form onSubmit={handleReport} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input label="מספר עובדים בפועל" type="number" min={1}
                  value={reportForm.actual_workers}
                  onChange={(e) => setReportForm((f) => ({ ...f, actual_workers: e.target.value }))} required />
                <Input label="תאריך התחלה בפועל" type="date"
                  value={reportForm.actual_start_date}
                  onChange={(e) => setReportForm((f) => ({ ...f, actual_start_date: e.target.value }))} required />
                <Input label="תאריך סיום בפועל" type="date"
                  value={reportForm.actual_end_date}
                  onChange={(e) => setReportForm((f) => ({ ...f, actual_end_date: e.target.value }))} required />
                <div className="sm:col-span-3">
                  <Button type="submit" disabled={reportSubmitting}>
                    {reportSubmitting ? <><Loader2 className="h-4 w-4 animate-spin me-2" />שולח...</> : 'הגש דוח'}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
