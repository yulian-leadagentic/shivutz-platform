'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Loader2, Send, FileText, Users, CheckCircle, XCircle,
  AlertTriangle, MessageSquare, ChevronDown, ChevronUp,
  BadgeCheck, CircleAlert, UserCheck, CreditCard, ShieldCheck,
} from 'lucide-react';
import { dealApi, workerApi, paymentApi } from '@/lib/api';
import { useEnums } from '@/features/enums/EnumsContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import StatusBadge from '@/components/StatusBadge';
import type { Deal, Message, Worker, PaymentMethod, CommitEngagementResult } from '@/types';
import {
  EXPERIENCE_LABEL_SHORT as EXP_LABELS,
  EXPERIENCE_MIDPOINT_MONTHS as EXP_MONTHS,
} from '@/i18n/he';
import {
  CommitEngagementModal, consumePendingLowProfile,
} from '@/features/payment/CommitEngagementModal';
import { GraceBadge } from '@/features/payment/GraceBadge';

function expLabel(w: Worker) {
  return EXP_LABELS[w.experience_range ?? ''] ?? (w.experience_years ? `${w.experience_years} שנים` : '—');
}

function expMonths(w: Worker): number {
  if (w.experience_range) return EXP_MONTHS[w.experience_range] ?? 0;
  return (w.experience_years ?? 0) * 12;
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('he-IL'); } catch { return iso; }
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ProfessionSlot {
  profCode: string;
  profName: string;
  needed: number;
  minExpMonths: number; // min experience from proposed workers of this prof
  proposedWorkerIds: Set<string>;
}

interface ReportForm {
  actual_workers: string;
  actual_start_date: string;
  actual_end_date: string;
}

// ─── Worker card for selection ─────────────────────────────────────────────────

function WorkerCard({
  worker,
  profName,
  minExpMonths,
  selected,
  onToggle,
}: {
  worker: Worker;
  profName: string;
  minExpMonths: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const months = expMonths(worker);
  const meetsExp = months >= minExpMonths;
  const visaDays = worker.visa_valid_until
    ? (new Date(worker.visa_valid_until).getTime() - Date.now()) / 86_400_000
    : 999;
  const visaOk = visaDays > 30;

  const score =
    (meetsExp ? 2 : 0) +
    (visaOk   ? 1 : 0);

  const matchColor =
    score === 3 ? 'border-emerald-200 bg-emerald-50/40' :
    score === 2 ? 'border-amber-200 bg-amber-50/30' :
                  'border-red-200 bg-red-50/20';

  const matchBadge =
    score === 3 ? { icon: BadgeCheck, text: 'מתאים', cls: 'text-emerald-700 bg-emerald-100' } :
    score === 2 ? { icon: CircleAlert, text: 'חלקי',   cls: 'text-amber-700  bg-amber-100'  } :
                  { icon: AlertTriangle, text: 'לא מתאים', cls: 'text-red-700 bg-red-100'  };

  const MB = matchBadge;

  return (
    <label
      className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all
        ${selected
          ? 'border-brand-500 bg-brand-50 shadow-sm'
          : `${matchColor} hover:border-slate-300`}`}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 shrink-0"
      />

      {/* Avatar */}
      <div className="h-9 w-9 rounded-full bg-slate-200 flex items-center justify-center shrink-0 text-sm font-bold text-slate-600">
        {worker.first_name?.[0]}{worker.last_name?.[0]}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">
          {worker.first_name} {worker.last_name}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
          <span className="text-xs text-slate-500">{profName}</span>
          <span className={`text-xs font-medium ${meetsExp ? 'text-emerald-700' : 'text-amber-700'}`}>
            {expLabel(worker)} {!meetsExp && minExpMonths > 0 && '⚠'}
          </span>
          <span className={`text-xs ${visaOk ? 'text-slate-500' : 'text-red-600 font-medium'}`}>
            ויזה: {fmtDate(worker.visa_valid_until)}{!visaOk && ' ⚠'}
          </span>
        </div>
      </div>

      {/* Match badge */}
      <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${MB.cls}`}>
        <MB.icon className="h-3 w-3" />
        {MB.text}
      </span>
    </label>
  );
}

// ─── Profession slot section ───────────────────────────────────────────────────

function ProfessionSection({
  slot,
  candidates,
  selectedIds,
  onToggle,
}: {
  slot: ProfessionSlot;
  candidates: Worker[];
  selectedIds: Set<string>;
  onToggle: (wid: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const selectedInSlot = candidates.filter((w) => selectedIds.has(w.id)).length;
  const filled = selectedInSlot >= slot.needed;
  const over   = selectedInSlot > slot.needed;

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      {/* Slot header */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-start"
      >
        <div className="flex items-center gap-3">
          <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold
            ${filled && !over ? 'bg-emerald-100 text-emerald-700' :
              over            ? 'bg-amber-100  text-amber-700'    :
                                'bg-slate-200  text-slate-500'}`}>
            {selectedInSlot}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{slot.profName}</p>
            <p className={`text-xs ${filled && !over ? 'text-emerald-600' : over ? 'text-amber-600' : 'text-slate-500'}`}>
              {filled && !over ? '✓ הושלם' :
               over            ? `⚠ ${selectedInSlot - slot.needed} יותר מדי` :
                                 `${slot.needed - selectedInSlot} חסרים`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Progress bar */}
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs text-slate-400">{selectedInSlot}/{slot.needed}</span>
            <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  filled && !over ? 'bg-emerald-500' :
                  over            ? 'bg-amber-500'   : 'bg-brand-500'
                }`}
                style={{ width: `${Math.min(1, selectedInSlot / slot.needed) * 100}%` }}
              />
            </div>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </div>
      </button>

      {/* Candidates */}
      {expanded && (
        <div className="p-3 space-y-2">
          {/* Experience hint */}
          {slot.minExpMonths > 0 && (
            <p className="text-xs text-slate-500 px-1">
              דרישת ניסיון מינימלי: <strong className="text-slate-700">{EXP_LABELS[
                Object.entries(EXP_MONTHS).find(([, v]) => v === slot.minExpMonths)?.[0] ?? ''
              ] ?? `${Math.round(slot.minExpMonths / 12)} שנים`}</strong>
            </p>
          )}

          {candidates.length === 0 ? (
            <div className="text-center py-4 text-sm text-slate-400">
              אין עובדים זמינים במקצוע זה
            </div>
          ) : (
            candidates.map((w) => (
              <WorkerCard
                key={w.id}
                worker={w}
                profName={slot.profName}
                minExpMonths={slot.minExpMonths}
                selected={selectedIds.has(w.id)}
                onToggle={() => onToggle(w.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Summary bar ───────────────────────────────────────────────────────────────

function AssignmentSummary({
  slots,
  allWorkers,
  selectedIds,
}: {
  slots: ProfessionSlot[];
  allWorkers: Worker[];
  selectedIds: Set<string>;
}) {
  const total   = slots.reduce((s, sl) => s + sl.needed, 0);
  const filled  = slots.reduce((s, sl) => {
    const n = allWorkers.filter((w) => w.profession_type === sl.profCode && selectedIds.has(w.id)).length;
    return s + Math.min(n, sl.needed);
  }, 0);
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

  return (
    <div className="flex items-center gap-4 bg-white border border-slate-200 rounded-2xl px-5 py-3 shadow-sm flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-semibold text-slate-700">סה״כ שיבוץ</span>
          <span className={`text-sm font-bold ${filled === total ? 'text-emerald-600' : 'text-slate-700'}`}>
            {filled}/{total}
          </span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${filled === total ? 'bg-emerald-500' : 'bg-brand-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="text-2xl font-bold text-slate-900 shrink-0">{pct}%</div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

// Next.js 16 requires any component using `useSearchParams` to be inside a
// <Suspense> boundary. The page is wrapped below at the default export; the
// actual content component is `CorporationDealPageInner`.
function CorporationDealPageInner() {
  const { id } = useParams<{ id: string }>();
  const router        = useRouter();
  const searchParams  = useSearchParams();

  const [deal, setDeal]         = useState<Deal | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [allWorkers, setAllWorkers] = useState<Worker[]>([]);
  const [slots, setSlots]       = useState<ProfessionSlot[]>([]);
  const { professionMap: profMap } = useEnums();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [reportForm, setReportForm] = useState<ReportForm>({
    actual_workers: '', actual_start_date: '', actual_end_date: '',
  });
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess]       = useState(false);

  // Payment state
  const [paymentMethods, setPaymentMethods]     = useState<PaymentMethod[]>([]);
  const [pmLoading, setPmLoading]               = useState(true);
  const [commitResult, setCommitResult]         = useState<CommitEngagementResult | null>(null);
  // Pattern A modal state
  const [showCommitModal, setShowCommitModal]   = useState(false);
  const [previewAmount, setPreviewAmount]       = useState<number | undefined>(undefined);
  const [previewVatRate, setPreviewVatRate]     = useState<number>(0.18);
  const [completingAuth, setCompletingAuth]     = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Load payment methods (don't block main load)
    paymentApi.methods()
      .then((pms) => setPaymentMethods(pms))
      .catch(() => setPaymentMethods([]))
      .finally(() => setPmLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const [d, msgs, stubs, allW] = await Promise.all([
          dealApi.get(id),
          dealApi.messages(id).catch(() => [] as Message[]),
          dealApi.workers(id).catch(() => []),
          workerApi.list().catch(() => [] as Worker[]),
        ]);

        setDeal(d);
        setMessages(msgs);
        setAllWorkers(allW);

        // Pre-select originally proposed workers
        const proposedIds = new Set<string>((stubs as { id: string }[]).map((s) => s.id));
        setSelectedIds(proposedIds);

        // Fetch full details of proposed workers to understand required professions
        const proposedDetails = await Promise.allSettled(
          [...proposedIds].map((wid) => workerApi.get(wid))
        );
        const proposed = proposedDetails
          .filter((r): r is PromiseFulfilledResult<Worker> => r.status === 'fulfilled')
          .map((r) => r.value);

        // Build profession slots from proposed workers
        const slotMap = new Map<string, { workers: Worker[] }>();
        for (const w of proposed) {
          const code = w.profession_type;
          if (!slotMap.has(code)) slotMap.set(code, { workers: [] });
          slotMap.get(code)!.workers.push(w);
        }

        const builtSlots: ProfessionSlot[] = [];
        for (const [code, { workers: pws }] of slotMap) {
          const minExp = Math.max(0, ...pws.map((w) => expMonths(w)));
          builtSlots.push({
            profCode: code,
            profName: profMap[code] ?? code,
            needed: pws.length,
            minExpMonths: minExp,
            proposedWorkerIds: new Set(pws.map((w) => w.id)),
          });
        }
        setSlots(builtSlots);
      } catch {
        setError('שגיאה בטעינת העסקה');
      } finally {
        setLoading(false);
      }
    }
    init();
    pollRef.current = setInterval(() => dealApi.messages(id).then(setMessages).catch(() => {}), 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cardcom return leg — when the user comes back from the hosted J5 form,
  // the URL has `?payment_result=complete&tx_id=...` (and `lowprofilecode`
  // appended by Cardcom). Call complete-auth to flip the tx to authorized.
  useEffect(() => {
    if (searchParams.get('payment_result') !== 'complete') return;
    const lpid = searchParams.get('lowprofilecode')
              || searchParams.get('LowProfileId')
              || consumePendingLowProfile(id);
    if (!lpid) return;
    setCompletingAuth(true);
    paymentApi.completeAuth(id, lpid)
      .then(async () => {
        const fresh = await dealApi.get(id);
        setDeal(fresh);
        // Strip the query params without navigating away.
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.delete('payment_result');
          url.searchParams.delete('tx_id');
          url.searchParams.delete('lowprofilecode');
          url.searchParams.delete('LowProfileId');
          window.history.replaceState({}, '', url.toString());
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'שגיאה באימות התשלום'))
      .finally(() => setCompletingAuth(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function toggleWorker(wid: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(wid)) next.delete(wid); else next.add(wid);
      return next;
    });
  }

  /**
   * Pattern A flow:
   *   1. Assign workers + mark deal accepted.
   *   2. Fetch commission preview so we can show the amount.
   *   3. Open the CommitEngagementModal — it calls commitEngagement on confirm
   *      and handles the Cardcom redirect (or the fake-mode inline success).
   */
  async function handleAccept() {
    if (selectedIds.size === 0) { setError('יש לבחור לפחות עובד אחד'); return; }
    setAccepting(true); setError('');
    try {
      await dealApi.updateWorkers(id, [...selectedIds]);
      await dealApi.updateStatus(id, 'accepted');
      setDeal((d) => d ? { ...d, status: 'accepted' } : d);

      // Best-effort commission preview — if it fails we still open the modal
      // with unknown amount; the backend remains the source of truth.
      try {
        const preview = await paymentApi.previewCommission(id);
        setPreviewAmount(preview.amounts.total_amount);
        setPreviewVatRate(preview.amounts.vat_rate);
      } catch { /* leave amount undefined */ }

      setShowCommitModal(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה באישור');
    } finally { setAccepting(false); }
  }

  function handleAuthorized(result: CommitEngagementResult) {
    // Fake-mode success path — the backend already set status=authorized.
    setCommitResult(result);
    setShowCommitModal(false);
    setDeal((d) => d ? { ...d, payment_status: 'authorized', payment_amount_estimated: result.amounts.total_amount } : d);
  }

  async function handleCancelled() {
    // Refresh the deal so GraceBadge disappears.
    try {
      const fresh = await dealApi.get(id);
      setDeal(fresh);
      setCommitResult(null);
    } catch { /* ignore */ }
  }

  async function handleReject() {
    setRejecting(true);
    try {
      await dealApi.updateStatus(id, 'cancelled');
      router.push('/corporation/deals');
    } catch { /* silent */ } finally { setRejecting(false); setShowRejectConfirm(false); }
  }

  async function handleSend() {
    if (!msgInput.trim()) return;
    setSending(true);
    try {
      const msg = await dealApi.sendMsg(id, msgInput.trim());
      setMessages((prev) => [...prev, msg]);
      setMsgInput('');
    } catch { /* silent */ } finally { setSending(false); }
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
    } catch { /* silent */ } finally { setReportSubmitting(false); }
  }

  function senderLabel(role: string) {
    return role === 'contractor' ? 'קבלן' : role === 'corporation' ? 'תאגיד' : role;
  }

  // ── Loading / Error ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="animate-spin h-6 w-6 me-2" />טוען עסקה...
      </div>
    );
  }
  if (error && !deal) {
    return <div className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">{error || 'העסקה לא נמצאה'}</div>;
  }
  if (!deal) return null;

  const isProposed  = deal.status === 'proposed';
  const showReport  = ['active', 'reporting'].includes(deal.status);

  // For each slot: find available workers of that profession (available OR already selected)
  const candidatesByProf = Object.fromEntries(
    slots.map((sl) => [
      sl.profCode,
      allWorkers
        .filter((w) =>
          w.profession_type === sl.profCode &&
          (w.status === 'available' || selectedIds.has(w.id))
        )
        .sort((a, b) => {
          // Sort: proposed workers first, then by experience desc
          const aP = sl.proposedWorkerIds.has(a.id) ? 0 : 1;
          const bP = sl.proposedWorkerIds.has(b.id) ? 0 : 1;
          return aP - bP || expMonths(b) - expMonths(a);
        }),
    ])
  );

  // Total required vs total selected (capped per slot)
  const totalNeeded   = slots.reduce((s, sl) => s + sl.needed, 0);
  const totalSelected = selectedIds.size;
  const allFilled     = slots.every((sl) => {
    const cnt = allWorkers.filter((w) => w.profession_type === sl.profCode && selectedIds.has(w.id)).length;
    return cnt >= sl.needed;
  });

  // Pattern A: card entry happens at commit time, no pre-saved method required.
  const canAccept = allFilled;
  const showPaymentCommitBanner = deal.status === 'accepted' && commitResult !== null;

  const isAuthorized = deal.payment_status === 'authorized';

  return (
    <div className="space-y-5 max-w-5xl">

      {/* ── Commit modal (Pattern A) ── */}
      {showCommitModal && (
        <CommitEngagementModal
          dealId={id}
          totalAmount={previewAmount}
          vatRate={previewVatRate}
          workerCount={totalSelected || deal.workers_count}
          onAuthorized={handleAuthorized}
          onClose={() => setShowCommitModal(false)}
        />
      )}

      {/* ── Completing auth after Cardcom return ── */}
      {completingAuth && (
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-700">מאמת את התשלום מול קארדקום...</p>
            <p className="text-xs text-slate-500">רק רגע.</p>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">עסקה #{id.slice(0, 8)}</h1>
            <StatusBadge status={deal.status} />
            {deal.agreed_price && (
              <span className="text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-0.5 rounded-full">
                ₪{Number(deal.agreed_price).toLocaleString('he-IL')}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            נוצרה: {fmtDate(deal.created_at)}
            <span className="mx-2 text-slate-300">·</span>
            <Users className="inline h-3.5 w-3.5 me-0.5 text-slate-400" />
            {deal.workers_count} עובדים מבוקשים
          </p>
        </div>
      </div>

      {/* ── Grace period badge (visible while authorized) ── */}
      {isAuthorized && (commitResult?.grace_period_expires_at || deal.payment_status === 'authorized') && (
        <GraceBadge
          dealId={id}
          graceExpiresAt={
            commitResult?.grace_period_expires_at
            ?? new Date(Date.now() + 48 * 3600_000).toISOString()
          }
          onCancelled={handleCancelled}
        />
      )}

      {/* ── Contractor notes ── */}
      {deal.notes && (
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
          <MessageSquare className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-blue-700 mb-0.5">הודעה מהקבלן</p>
            <p className="text-sm text-blue-800">{deal.notes}</p>
          </div>
        </div>
      )}

      {/* ── Proposed: assignment UI ── */}
      {isProposed && (
        <div className="space-y-4">

          {/* Accept / reject action bar */}
          <Card className="border-amber-300 bg-amber-50/60">
            <CardContent className="py-3.5">
              {!showRejectConfirm ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="font-semibold text-amber-900 text-sm">הצעה ממתינה לאישורך</p>
                      <p className="text-amber-700 text-xs mt-0.5">
                        בחר עובדים לשיבוץ לפי מקצוע ואשר את ההתקשרות.
                        <span className="text-amber-800 font-medium"> אישור זה מהווה התחייבות לתשלום — הסכום יוקפא על הכרטיס, וחיוב יבוצע תוך 48 שעות אלא אם תבטל.</span>
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 font-medium"
                        onClick={handleAccept}
                        disabled={accepting || rejecting || !canAccept}
                      >
                        {accepting
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />שולח...</>
                          : <><CheckCircle className="h-3.5 w-3.5" />אשר ושבץ {totalSelected} עובדים</>}
                      </Button>
                      <Button size="sm" variant="destructive"
                        onClick={() => setShowRejectConfirm(true)}
                        disabled={accepting || rejecting}>
                        <XCircle className="h-3.5 w-3.5" />דחה
                      </Button>
                    </div>
                  </div>

                  {/* Pattern A: card entry happens inside the commit modal —
                      no pre-saved method required. */}
                </div>
              ) : (
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2 text-red-700">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">האם לדחות? פעולה זו אינה הפיכה.</span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" onClick={handleReject} disabled={rejecting}>
                      {rejecting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}כן, דחה
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowRejectConfirm(false)}>ביטול</Button>
                  </div>
                </div>
              )}
              {error && (
                <p className="text-sm text-red-600 mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
            </CardContent>
          </Card>

          {/* Summary progress bar */}
          {slots.length > 0 && (
            <AssignmentSummary slots={slots} allWorkers={allWorkers} selectedIds={selectedIds} />
          )}

          {/* Per-profession sections */}
          <div className="space-y-3">
            {slots.length === 0 ? (
              /* Fallback: no profession breakdown — show flat list */
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <UserCheck className="h-4 w-4 text-brand-600" />
                    בחר עובדים לשיבוץ
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {allWorkers.filter((w) => w.status === 'available' || selectedIds.has(w.id)).map((w) => (
                    <WorkerCard
                      key={w.id}
                      worker={w}
                      profName={profMap[w.profession_type] ?? w.profession_type}
                      minExpMonths={0}
                      selected={selectedIds.has(w.id)}
                      onToggle={() => toggleWorker(w.id)}
                    />
                  ))}
                </CardContent>
              </Card>
            ) : (
              slots.map((slot) => (
                <ProfessionSection
                  key={slot.profCode}
                  slot={slot}
                  candidates={candidatesByProf[slot.profCode] ?? []}
                  selectedIds={selectedIds}
                  onToggle={toggleWorker}
                />
              ))
            )}
          </div>

          {/* Validation hint */}
          {!allFilled && totalSelected > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              יש למלא את כל הדרישות לפני האישור (
              {slots.filter((sl) => {
                const cnt = allWorkers.filter((w) => w.profession_type === sl.profCode && selectedIds.has(w.id)).length;
                return cnt < sl.needed;
              }).map((sl) => `${sl.profName}: ${
                allWorkers.filter((w) => w.profession_type === sl.profCode && selectedIds.has(w.id)).length
              }/${sl.needed}`).join(', ')}
              )
            </p>
          )}
        </div>
      )}

      {/* ── Payment commitment banner (shown once after accepting) ── */}
      {showPaymentCommitBanner && commitResult && (
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-300 rounded-2xl px-4 py-3.5">
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">
              ✅ התחייבת לתשלום של{' '}
              {commitResult.amounts?.total_amount != null
                ? `₪${Number(commitResult.amounts.total_amount).toLocaleString('he-IL', { minimumFractionDigits: 2 })}`
                : '—'
              }
            </p>
            <p className="text-xs text-emerald-700 mt-0.5">
              החיוב יבוצע אוטומטית תוך 48 שעות.
              {commitResult.amounts?.vat_amount != null && (
                <> כולל מע״מ ₪{Number(commitResult.amounts.vat_amount).toLocaleString('he-IL', { minimumFractionDigits: 2 })}.</>
              )}
            </p>
          </div>
        </div>
      )}

      {/* ── Two column: workers assigned + messages ── */}
      <div className={`grid grid-cols-1 gap-6 ${!isProposed ? 'lg:grid-cols-2' : ''}`}>

        {/* Assigned workers (post-acceptance) */}
        {!isProposed && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-brand-600" />
                עובדים משובצים
              </CardTitle>
            </CardHeader>
            <CardContent>
              {allWorkers.filter((w) => selectedIds.has(w.id)).length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-4">אין עובדים משובצים</p>
              ) : (
                <div className="space-y-2">
                  {allWorkers.filter((w) => selectedIds.has(w.id)).map((w) => (
                    <div key={w.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <div className="h-8 w-8 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700 shrink-0">
                        {w.first_name?.[0]}{w.last_name?.[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">{w.first_name} {w.last_name}</p>
                        <p className="text-xs text-slate-500">{profMap[w.profession_type] ?? w.profession_type} · {expLabel(w)}</p>
                      </div>
                      <span className="text-xs text-slate-400 shrink-0">ויזה: {fmtDate(w.visa_valid_until)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Messages */}
        <Card className={`flex flex-col ${isProposed ? '' : ''}`} style={{ minHeight: 340 }}>
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-base">צ׳אט עם הקבלן</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 p-0">
            <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 280 }}>
              {messages.length === 0 ? (
                <p className="text-slate-400 text-sm text-center pt-4">אין הודעות עדיין</p>
              ) : (
                messages.map((msg) => {
                  const isCorp = msg.sender_role === 'corporation';
                  return (
                    <div key={msg.id} className={`flex flex-col gap-0.5 ${isCorp ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="font-medium text-slate-600">{senderLabel(msg.sender_role)}</span>
                        <span>{fmtDate(msg.created_at)}</span>
                      </div>
                      <div className={`max-w-xs rounded-xl px-3 py-2 text-sm ${
                        isCorp
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-100 text-slate-800 border border-slate-200'
                      }`}>
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
                placeholder="כתוב הודעה לקבלן..."
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

      {/* ── Report section ── */}
      {showReport && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-brand-600" />
              הגשת דוח ביצוע — תאגיד
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
                    {reportSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" />שולח...</> : 'הגש דוח'}
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

export default function CorporationDealPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="animate-spin h-6 w-6 me-2" />טוען עסקה...
      </div>
    }>
      <CorporationDealPageInner />
    </Suspense>
  );
}
