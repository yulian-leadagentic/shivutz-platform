'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, Send, FileText, Users, Clock, CheckCircle2,
  Building2, Phone, Mail, UserCheck, HandshakeIcon, Download, X,
  ArrowRight,
} from 'lucide-react';
import { dealApi, workerApi, orgApi, memberApi } from '@/lib/api';
import { dealRef } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import StatusBadge, { resolveStatus } from '@/components/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { Deal, Message, Worker, Corporation } from '@/types';
import { EXPERIENCE_LABEL as EXP_LABELS, heOrigin } from '@/i18n/he';

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
    // Wording deliberately omits a deadline ("תוך X ימים") until the
    // backend timing rules are pinned down — `expires_at` was rendering
    // "165 hours" (~7 days) while the corp-side billing window is 48
    // hours, and that mismatch was confusing during STG testing.
    text: 'התאגיד הציג רשימת עובדים — בדוק את ההצעה והתקדם בעסקה',
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
    text: 'ההצעה פגה — הבקשה נשארת פתוחה',
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


export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [deal, setDeal]         = useState<Deal | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [workers, setWorkers]   = useState<Worker[]>([]);
  const [corp, setCorp]         = useState<Corporation | null>(null);
  // Members the corp has marked as deal contacts — these are the
  // names + phone + email the contractor sees post-reveal. Replaces
  // the single legacy corp.contact_* fallback used to render.
  const [corpContacts, setCorpContacts] = useState<Array<{
    membership_id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
    job_title: string | null;
  }>>([]);
  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  // Two-step reject confirm — replaces the legacy native confirm().
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
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
      // Fetch the corp's designated deal contacts. Fires in parallel
      // with the corp lookup. Empty list = no flagged members; the
      // render falls back to the single corp.contact_* fields.
      memberApi.listDealContacts('corporations', d.corporation_id)
        .then((list) => setCorpContacts(list || []))
        .catch(() => setCorpContacts([]));
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

    // Visibility-aware polling — pause when the tab isn't focused
    // so a stale background tab doesn't churn one of the browser's
    // 6 concurrent connections per origin against the gateway.
    // Same pattern as the corp deal detail page.
    function startPolling() {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(loadMessages, 30_000);
    }
    function stopPolling() {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    function onVisibility() {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'visible') { loadMessages(); startPolling(); }
      else stopPolling();
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      startPolling();
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      stopPolling();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
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

  // Step 1: reveal corp identity. Does NOT change deal status — the
  // contractor can now see who proposed, call them, negotiate offline.
  // The page re-renders with the corp details visible and the "אשר עסקה"
  // button replacing the reveal button.
  async function handleRevealCorp() {
    setConfirming(true);
    setConfirmError('');
    try {
      await dealApi.revealCorp(id);
      await loadDeal();
    } catch (e: unknown) {
      setConfirmError(e instanceof Error ? e.message : 'שגיאה בחשיפת פרטי התאגיד');
    } finally {
      setConfirming(false);
    }
  }

  // Step 2: formal approval — the click that flips status to 'approved'
  // and starts the capture timer. Only reachable AFTER the contractor
  // has revealed corp identity (the button is hidden until then).
  async function handleConfirm() {
    // No confirm dialog — the click on "התקדם בעסקה" IS the
    // contractor's intent. Previously asked them again with a
    // commission-warning copy ("התאגיד יחויב בעמלה") which felt
    // out of place (the contractor doesn't pay the commission) and
    // added an extra step to a flow that's already deliberate.
    setConfirming(true);
    setConfirmError('');
    try {
      await dealApi.approve(id);
      // Per user feedback: after "התקדם בעסקה" succeeds, the
      // contractor wants to be sent back to the requests list rather
      // than left on the detail page. The list re-fetches on focus
      // (visibilitychange listener added in QA-R5) so the deal lands
      // in its new status group immediately.
      router.push('/contractor/deals');
      return;
    } catch (e: unknown) {
      setConfirmError(e instanceof Error ? e.message : 'שגיאה באישור ההתקשרות');
    } finally {
      setConfirming(false);
    }
  }

  function handleReject() {
    setConfirmRejectOpen(true);
  }

  async function performReject() {
    setConfirming(true);
    setConfirmError('');
    try {
      await dealApi.reject(id);
      setConfirmRejectOpen(false);
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
      {/* Back-link — always at the top of the page so a contractor can
          bail out at any point. Specifically requested for the
          post-approval state where the user kept asking "ok I clicked,
          now how do I get back to the list?". */}
      <Link
        href="/contractor/deals"
        className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-brand-600 transition-colors"
      >
        <ArrowRight className="h-3.5 w-3.5" />
        חזרה למסך עסקאות
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">עסקה #{dealRef(id)}</h1>
            <span className="text-xs font-medium px-2.5 py-0.5 rounded-full border border-slate-300 bg-slate-50 text-slate-700">
              {resolveStatus(deal.status).label}
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

      {/* Countdown banner hidden until we pin down the right timing
          rule. The data here came from `deal.expires_at` which was
          showing ~165 hours (7-day default) while the corp-side
          billing window is 48 hours — we don't want to publish a
          deadline before product agrees which one the contractor is
          actually under. Re-enable when the source of truth is
          confirmed. */}

      {/* Status banner */}
      {statusInfo && (
        <div className={`flex items-center gap-2.5 border rounded-xl px-4 py-3 text-sm font-medium ${statusInfo.color}`}>
          {statusInfo.icon}
          {statusInfo.text}
        </div>
      )}

      {/* Post-approval corp details — once the contractor has clicked
          "התקדם בעסקה", the showConfirm block disappears (because
          status flips away from 'corp_committed'), but they still
          need the corp contact info visible to actually close the
          deal. Renders the same data as the inside-showConfirm card,
          gated on `corp_revealed_at && status='approved'`. */}
      {deal.status === 'approved' && deal.corp_revealed_at && corp && (
        <Card className="border-emerald-200 bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-emerald-800">
              <Building2 className="h-5 w-5" />
              פרטי התאגיד שאישרת
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-base text-slate-900">
                <Building2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <span className="font-bold">{corpName}</span>
              </div>
              {/* Same multi-contact pattern as the pre-approval card.
                  After the contractor has approved, they likely want
                  the full list of contacts for follow-up. */}
              {corpContacts.length > 0 ? (
                <div className="space-y-3">
                  {corpContacts.map((c) => (
                    <div key={c.membership_id} className="space-y-1 pb-2 border-b border-emerald-50 last:border-0 last:pb-0">
                      {c.full_name && (
                        <div className="flex items-center gap-2 text-sm text-slate-700">
                          <UserCheck className="h-4 w-4 text-slate-400 shrink-0" />
                          <span className="font-medium">{c.full_name}</span>
                          {c.job_title && (
                            <span className="text-xs text-slate-400">· {c.job_title}</span>
                          )}
                        </div>
                      )}
                      {c.phone && (
                        <div className="flex items-center gap-2 text-sm text-slate-700">
                          <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                          <a href={`tel:${c.phone}`} className="text-brand-600 hover:underline font-semibold" dir="ltr">
                            {c.phone}
                          </a>
                        </div>
                      )}
                      {c.email && (
                        <div className="flex items-center gap-2 text-sm text-slate-700">
                          <Mail className="h-4 w-4 text-slate-400 shrink-0" />
                          <a href={`mailto:${c.email}`} className="text-brand-600 hover:underline">
                            {c.email}
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {corp.contact_name && (
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <UserCheck className="h-4 w-4 text-slate-400 shrink-0" />
                      <span>{corp.contact_name}</span>
                    </div>
                  )}
                  {corp.contact_phone && (
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                      <a href={`tel:${corp.contact_phone}`} className="text-brand-600 hover:underline font-semibold text-base">
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
                </>
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-emerald-100">
              <Link
                href="/contractor/deals"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800"
              >
                <ArrowRight className="h-4 w-4" />
                חזרה למסך עסקאות
              </Link>
            </div>
          </CardContent>
        </Card>
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
                disabled={closing !== null}
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
            {/* Corporation contact — gated on `corp_revealed_at`. The
                contractor sees "Step 1: reveal" first; corp identity
                stays hidden until they click. After reveal, the
                contact card appears with a clear "what next" hint so
                the path forward isn't ambiguous. */}
            {corp && deal.corp_revealed_at && (
              <div className="bg-white rounded-xl border-2 border-emerald-300 p-4 shadow-sm">
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-3">
                  פרטי התאגיד שהציע
                </p>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-base text-slate-900">
                    <Building2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <span className="font-bold">{corpName}</span>
                  </div>
                  {/* Multi-contact rendering: when the corp has marked
                      one or more team members as deal contacts (via
                      /corporation/users), show ALL of them. Falls back
                      to the legacy single corp.contact_* fields only
                      when no member is flagged (shouldn't happen for
                      newly-onboarded entities — backfill seeds one). */}
                  {corpContacts.length > 0 ? (
                    <div className="space-y-3">
                      {corpContacts.map((c) => (
                        <div key={c.membership_id} className="space-y-1 pb-2 border-b border-emerald-50 last:border-0 last:pb-0">
                          {c.full_name && (
                            <div className="flex items-center gap-2 text-sm text-slate-700">
                              <UserCheck className="h-4 w-4 text-slate-400 shrink-0" />
                              <span className="font-medium">{c.full_name}</span>
                              {c.job_title && (
                                <span className="text-xs text-slate-400">· {c.job_title}</span>
                              )}
                            </div>
                          )}
                          {c.phone && (
                            <div className="flex items-center gap-2 text-sm text-slate-700">
                              <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                              <a href={`tel:${c.phone}`} className="text-brand-600 hover:underline font-semibold" dir="ltr">
                                {c.phone}
                              </a>
                            </div>
                          )}
                          {c.email && (
                            <div className="flex items-center gap-2 text-sm text-slate-700">
                              <Mail className="h-4 w-4 text-slate-400 shrink-0" />
                              <a href={`mailto:${c.email}`} className="text-brand-600 hover:underline">
                                {c.email}
                              </a>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      {corp.contact_name && (
                        <div className="flex items-center gap-2 text-sm text-slate-700">
                          <UserCheck className="h-4 w-4 text-slate-400 shrink-0" />
                          <span>{corp.contact_name}</span>
                        </div>
                      )}
                      {corp.contact_phone && (
                        <div className="flex items-center gap-2 text-sm text-slate-700">
                          <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                          <a href={`tel:${corp.contact_phone}`} className="text-brand-600 hover:underline font-semibold text-base">
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
                    </>
                  )}
                </div>
                {/* "What now" cue — before this banner the contractor
                    didn't know what the next button does, just that
                    they revealed details. Spelling out the
                    talk-then-commit flow removes the ambiguity. */}
                <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                  <strong className="block mb-1">השלב הבא:</strong>
                  צור קשר עם התאגיד, ודא את פרטי העובדים והתנאים. כשתגיע להסכמה — לחץ על
                  &nbsp;<strong>״התקדם בעסקה״</strong>&nbsp; כדי להמשיך.
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
            {workers.length > 0 && (() => {
              // Pull the contractor's own request fields off the deal
              // payload (newly exposed in services/deal/app/routes/
              // deals.py). Used to flag mismatches per worker —
              // contractor asked for the corp's proposal to be
              // checked at a glance: "which workers don't fit my
              // requirements, and why?" Pre-tonight the contractor
              // saw a raw list with no match indicators.
              const dAny = deal as unknown as {
                requested_origins?: string[];
                requested_min_experience_months?: number;
              };
              const requestedOrigins = Array.isArray(dAny.requested_origins) ? dAny.requested_origins : [];
              const requestedMinExp = dAny.requested_min_experience_months || 0;

              // Per-worker mismatch evaluator. Returns the set of
              // reasons this row doesn't fit, in Hebrew, plus a sort
              // score (lower = worse). The card highlights amber on
              // any miss; the chip lists the reasons inline.
              function evalWorker(w: Worker) {
                const reasons: string[] = [];
                let score = 0;
                // Origin check
                if (requestedOrigins.length > 0) {
                  if (!w.origin_country || !requestedOrigins.includes(w.origin_country)) {
                    reasons.push('מוצא לא מתאים');
                  } else {
                    score += 2;
                  }
                } else {
                  score += 2;
                }
                // Visa check — invalid or expiring within 30 days
                if (w.visa_valid_until) {
                  const days = (new Date(w.visa_valid_until).getTime() - Date.now()) / 86_400_000;
                  if (days <= 30) {
                    reasons.push(days < 0 ? 'ויזה פגה' : 'ויזה פגה בקרוב');
                  } else {
                    score += 1;
                  }
                }
                // Experience check
                const months = w.experience_years != null ? (w.experience_years * 12) : 0;
                if (requestedMinExp > 0 && months < requestedMinExp) {
                  reasons.push('ניסיון מתחת לדרישה');
                } else {
                  score += 1;
                }
                return { reasons, score };
              }

              // Sort: best-match first, worst at the bottom. Stable on
              // the natural workers order otherwise.
              const sortedWorkers = workers
                .map((w, i) => ({ w, i, ...evalWorker(w) }))
                .sort((a, b) => b.score - a.score || a.i - b.i);

              return (
                <div className="bg-white rounded-xl border border-emerald-100 p-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    רשימת עובדים שהוצעה ({workers.length})
                  </p>
                  <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                    פרטי הזיהוי של העובדים יוצגו לאחר אישור הרשימה. כעת מוצגים מקצוע, ניסיון וארץ מוצא בלבד.
                    {requestedOrigins.length > 0 && (
                      <> מוצא מבוקש לבקשה זו: <strong className="text-slate-600">{requestedOrigins.map((c) => heOrigin(c)).join(', ')}</strong>.</>
                    )}
                  </p>
                  <div className="space-y-2">
                    {sortedWorkers.map(({ w, i, reasons }) => {
                      const wAny = w as unknown as { years_in_israel?: number; experience_range?: string };
                      const hasMismatch = reasons.length > 0;
                      return (
                        <div
                          key={w.id}
                          className={`flex items-start gap-3 py-1.5 px-2 rounded-lg border last:border-b
                            ${hasMismatch
                              ? 'bg-amber-50/40 border-amber-200'
                              : 'bg-white border-slate-100'}`}
                        >
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold
                            ${hasMismatch ? 'bg-amber-100 text-amber-800' : 'bg-brand-100 text-brand-700'}`}>
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900">עובד #{i + 1}</p>
                            <p className="text-xs text-slate-500">
                              {w.profession_type}
                              {wAny.experience_range && <> · ניסיון {wAny.experience_range}</>}
                              {!wAny.experience_range && w.experience_years != null && <> · {w.experience_years} שנים ניסיון</>}
                              {w.origin_country && <> · {w.origin_country}</>}
                              {wAny.years_in_israel != null && <> · {wAny.years_in_israel} שנים בישראל</>}
                            </p>
                            {hasMismatch && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {reasons.map((r) => (
                                  <span key={r} className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200">
                                    ⚠ {r}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Approve / Reject actions */}
            {confirmError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {confirmError}
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={deal.corp_revealed_at ? handleConfirm : handleRevealCorp}
                disabled={confirming || workers.length === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {/* Two-step contractor flow:
                    Step 1 — "הצג פרטי תאגיד" (reveal): unlocks corp
                             identity, status stays 'corp_committed'.
                             Contractor calls the corp, closes offline.
                    Step 2 — "התקדם בעסקה" (approve): formal commit.
                             Wording chosen with user — "אשר עסקה" was
                             too final-sounding; "התקדם" makes it clear
                             this is the next step in a process, after
                             which the corp gets billed. */}
                {confirming ? (
                  <><Loader2 className="h-4 w-4 animate-spin me-2" />מעבד...</>
                ) : deal.corp_revealed_at ? (
                  <><CheckCircle2 className="h-4 w-4 me-2" />התקדם בעסקה</>
                ) : (
                  <><CheckCircle2 className="h-4 w-4 me-2" />הצג פרטי תאגיד ({workers.length} עובדים)</>
                )}
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
                  רשימת העובדים תוצג ברגע שהתאגיד יציג הצעה
                </p>
              ) : workers.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-4">אין עובדים משובצים</p>
              ) : (
                <>
                  <p className="text-[11px] text-slate-500 pb-2">
                    מוצגים מוצא וותק בלבד — שמות אינם נדרשים להחלטה.
                  </p>
                  <ul className="divide-y divide-slate-100">
                    {workers.map((w, wIdx) => {
                      const wAny = w as unknown as { experience_range?: string };
                      const origin = w.origin_country ? heOrigin(w.origin_country) : null;
                      const experience = wAny.experience_range
                        ? `ניסיון ${wAny.experience_range}`
                        : (w.experience_years != null ? `${w.experience_years} שנות ניסיון` : null);
                      return (
                        <li key={w.id || wIdx} className="flex items-center gap-3 py-2.5">
                          <div className="h-7 w-7 rounded-full bg-brand-100 flex items-center justify-center text-[10px] font-bold text-brand-700 shrink-0">
                            {wIdx + 1}
                          </div>
                          <div className="flex-1 min-w-0 text-sm text-slate-700 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            {origin && <span className="font-medium text-slate-900">{origin}</span>}
                            {origin && experience && <span className="text-slate-300">·</span>}
                            {experience && <span>{experience}</span>}
                            {!origin && !experience && <span className="text-slate-400">—</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
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

      <ConfirmDialog
        open={confirmRejectOpen}
        title="דחיית הרשימה"
        message="לדחות את הרשימה? הבקשה תישאר פתוחה ונחפש מענה במקום אחר."
        confirmLabel="דחה רשימה"
        variant="destructive"
        busy={confirming}
        onConfirm={performReject}
        onCancel={() => setConfirmRejectOpen(false)}
      />
    </div>
  );
}
