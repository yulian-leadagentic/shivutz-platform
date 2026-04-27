'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, AlertCircle, Users, CheckCircle2, ArrowLeft,
  Star, MessageSquarePlus, AlertTriangle, X as XIcon, Info,
} from 'lucide-react';
import { jobApi, dealApi } from '@/lib/api';
import type { MatchBundle, JobRequest } from '@/types';
import { useEnums } from '@/features/enums/EnumsContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { heOrigin, heLang } from '@/i18n/he';
import {
  formatDate, scorePct, scoreColor, qualityLabel, expMonthsLabel,
} from '@/features/match/score';
import {
  groupWorkers, getBundleWorkers, bundleAvgScorePct,
} from '@/features/match/group';
import { detectMismatches, fulfilledLine, missingLine, PARTIAL_FOOTER } from '@/features/match/mismatch';
import { CompareCell } from '@/features/match/components/CompareCell';
import { ScoreBreakdown, TierBadge } from '@/features/match/components/ScoreBreakdown';
import { ThresholdRequirements } from '@/features/match/components/ThresholdRequirements';
import { ConstructionAnimation } from '@/features/match/components/ConstructionAnimation';

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();

  const [bundles, setBundles]           = useState<MatchBundle[]>([]);
  const [jobRequest, setJobRequest]     = useState<JobRequest | null>(null);
  const { professionMap: profMap }      = useEnums();
  const [loading, setLoading]           = useState(true);
  const [timedOut, setTimedOut]         = useState(false);
  const [error, setError]               = useState('');
  const [creatingDeal, setCreatingDeal] = useState<string | null>(null);

  // Inquiry modal state
  const [modalBundle, setModalBundle]         = useState<MatchBundle | null>(null);
  const [inquiryNotes, setInquiryNotes]       = useState('');
  const [mismatchAcknowledged, setMismatchAcknowledged] = useState(false);

  // Each call to runMatch bumps this ref; stale in-flight results check against
  // the captured id and bail out, preventing races where (a) the 8s timer has
  // already flipped state to "timed out" when the slow promise resolves, or
  // (b) the user has retried and the first request resolves after the second.
  const runIdRef = useRef(0);

  const runMatch = useCallback(async () => {
    runIdRef.current += 1;
    const thisRun = runIdRef.current;

    setLoading(true);
    setError('');
    setTimedOut(false);

    const timer = setTimeout(() => {
      if (runIdRef.current !== thisRun) return;
      setTimedOut(true);
      setLoading(false);
    }, 8000);

    try {
      const [reqData, results] = await Promise.all([
        jobApi.get(id).catch(() => null),
        jobApi.match(id),
      ]);
      if (runIdRef.current !== thisRun) return;  // stale — newer run or unmount
      clearTimeout(timer);
      setJobRequest(reqData);
      setBundles(results);
      setTimedOut(false);
      setLoading(false);
    } catch (err) {
      if (runIdRef.current !== thisRun) return;
      clearTimeout(timer);
      setError(err instanceof Error ? err.message : 'שגיאה בחיפוש התאמות');
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { runMatch(); }, [runMatch]);

  // Invalidate any in-flight run on unmount so late resolutions can't touch state.
  useEffect(() => () => { runIdRef.current += 1; }, []);

  const lineItemMap = Object.fromEntries(
    (jobRequest?.line_items ?? []).map((li) => [li.id, li])
  );

  function openInquiryModal(bundle: MatchBundle) {
    setModalBundle(bundle);
    setInquiryNotes('');
    setMismatchAcknowledged(false);
  }

  function closeModal() {
    if (creatingDeal) return; // don't close while saving
    setModalBundle(null);
    setInquiryNotes('');
    setMismatchAcknowledged(false);
  }

  async function handleConfirmInquiry() {
    if (!modalBundle) return;
    const bundle = modalBundle;
    setCreatingDeal(bundle.corporation_id);
    try {
      const allWorkers = getBundleWorkers(bundle);
      const deal = await dealApi.create({
        job_request_id: id,
        corporation_id: bundle.corporation_id,
        worker_ids: allWorkers.map((wm) => wm.worker.id),
        workers_count: allWorkers.length,
        notes: inquiryNotes || undefined,
      });
      // If contractor wrote notes, post them as the first message in the deal
      if (inquiryNotes.trim()) {
        await dealApi.sendMsg(deal.id, inquiryNotes.trim()).catch(() => null);
      }
      router.push(`/contractor/deals/${deal.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה ביצירת עסקה');
      setCreatingDeal(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/contractor/requests">
            <ArrowLeft className="h-4 w-4" />
            חזרה לבקשות
          </Link>
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">חיפוש התאמת עובדים</h2>
          {jobRequest && (
            <p className="text-sm text-slate-500 mt-0.5">
              {jobRequest.project_name_he || jobRequest.project_name}
            </p>
          )}
        </div>
      </div>

      {/* Explanation bar */}
      {!loading && bundles.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm">
            <Users className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-blue-800">כמות עובדים שנמצאו</p>
              <p className="text-blue-600 text-xs mt-0.5">
                כמה עובדים נמצאו במאגר לכל מקצוע מתוך הכמות שביקשת.
                <br /><strong>למשל: 8 / 10 טייחים = נמצאו 8 מתוך 10 שביקשת.</strong>
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm">
            <Star className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800">ציון איכות</p>
              <p className="text-amber-600 text-xs mt-0.5">
                עד כמה העובדים עומדים בדרישות: מוצא, שפות, ניסיון, ויזה.
                <br /><strong>ציון גבוה = עובד קרוב לדרישות שלך.</strong>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <Card>
          <CardContent className="py-14 flex flex-col items-center">
            <ConstructionAnimation />
          </CardContent>
        </Card>
      )}

      {timedOut && (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-amber-500" />
            <p className="text-slate-700 font-medium">זמן החיפוש חרג — נסה שוב</p>
            <Button onClick={runMatch}>נסה שוב</Button>
          </CardContent>
        </Card>
      )}

      {error && !loading && !timedOut && (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <p className="text-red-600 font-medium">{error}</p>
            <Button onClick={runMatch} variant="outline">נסה שוב</Button>
          </CardContent>
        </Card>
      )}

      {!loading && !timedOut && !error && bundles.length === 0 && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-4 text-center">
            <Users className="h-12 w-12 text-slate-300" />
            <p className="text-slate-700 font-medium max-w-sm">
              לא נמצאה כרגע התאמה מדויקת לבקשה שלך, אבל אנחנו כבר עובדים על זה 👍
            </p>
            <p className="text-slate-500 text-sm max-w-sm">
              נמשיך לחפש עבורך ונעדכן אותך מיד כשנמצא התאמה מתאימה.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Inquiry modal ───────────────────────────────────────────────── */}
      {modalBundle && (() => {
        const modalMismatches = detectMismatches(modalBundle, lineItemMap, profMap);
        // Origin/lang/exp conflicts require explicit checkbox consent.
        // Pure count gaps are informational — partial inquiries can be sent freely.
        const canSend = !modalMismatches.hasBlockingMismatch || mismatchAcknowledged;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
          >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-5 p-6" dir="rtl">
              {/* Modal header */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">פנייה לתאגיד</h3>
                  <p className="text-sm text-slate-500 mt-0.5">
                    שולחים פנייה ל&rlm;
                    <strong className="text-slate-700">
                      {(modalBundle.corporation_name && modalBundle.corporation_name !== modalBundle.corporation_id)
                        ? modalBundle.corporation_name
                        : 'התאגיד'}
                    </strong>
                    &rlm; עבור{' '}
                    <strong className="text-slate-700">{modalBundle.filled_workers ?? getBundleWorkers(modalBundle).length} עובדים</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={creatingDeal !== null}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label="סגור"
                >
                  <XIcon className="h-5 w-5" />
                </button>
              </div>

              {/* Summary chips */}
              <div className="flex flex-wrap gap-2">
                {(modalBundle.line_items ?? []).map((li) => (
                  <span
                    key={li.line_item_id}
                    className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 rounded-full px-3 py-1 text-xs font-medium"
                  >
                    <Users className="h-3 w-3" />
                    {profMap[li.profession] ?? li.profession} — {li.workers?.length ?? 0} עובדים
                  </span>
                ))}
              </div>

              {/* ── Partial-match summary (informational, no checkbox) ── */}
              {modalMismatches.hasMismatch && !modalMismatches.hasBlockingMismatch && (
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
                    <p className="font-bold text-sm text-amber-800">
                      שים לב — רגע לפני השליחה:
                    </p>
                  </div>
                  <div className="space-y-1 ps-7 text-sm leading-relaxed text-amber-800">
                    {modalMismatches.fulfilled.map((f, i) => (
                      <p key={`f-${i}`}>{fulfilledLine(f)}</p>
                    ))}
                    {modalMismatches.missing.length > 0 && (
                      <>
                        <p className="pt-1 font-medium">לעומת זאת:</p>
                        {modalMismatches.missing.map((m, i) => (
                          <p key={`m-${i}`}>{missingLine(m)}</p>
                        ))}
                      </>
                    )}
                    <p className="pt-2 text-amber-700">{PARTIAL_FOOTER}</p>
                  </div>
                </div>
              )}

              {/* ── Blocking conflicts (origin / language / experience) — needs ack ── */}
              {modalMismatches.hasBlockingMismatch && (
                <div className={`rounded-xl border-2 p-4 space-y-3 transition-colors ${
                  mismatchAcknowledged
                    ? 'bg-green-50 border-green-200'
                    : 'bg-amber-50 border-amber-300'
                }`}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`h-5 w-5 shrink-0 ${mismatchAcknowledged ? 'text-green-500' : 'text-amber-500'}`} />
                    <p className={`font-bold text-sm ${mismatchAcknowledged ? 'text-green-800' : 'text-amber-800'}`}>
                      שים לב — אי-התאמה לדרישות
                    </p>
                  </div>
                  <div className="space-y-2 ps-7">
                    {modalMismatches.paragraphs.map((para, i) => (
                      <p key={i} className={`text-sm leading-relaxed ${mismatchAcknowledged ? 'text-green-700' : 'text-amber-700'}`}>
                        {para}
                      </p>
                    ))}
                  </div>
                  <label className="flex items-start gap-3 cursor-pointer pt-1 ps-1">
                    <input
                      type="checkbox"
                      checked={mismatchAcknowledged}
                      onChange={(e) => setMismatchAcknowledged(e.target.checked)}
                      disabled={creatingDeal !== null}
                      className="mt-0.5 h-4 w-4 accent-amber-500 shrink-0"
                    />
                    <span className={`text-sm font-semibold ${mismatchAcknowledged ? 'text-green-800' : 'text-amber-800'}`}>
                      הבנתי — אני מאשר להתקדם עם עובדים אלו
                    </span>
                  </label>
                </div>
              )}

              {/* Notes textarea */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  הערות לתאגיד (אופציונלי)
                </label>
                <textarea
                  rows={4}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  placeholder="לדוגמה: אנחנו מחפשים עובדים לפרויקט בנייה ברמת גן שמתחיל ב-1 ביוני..."
                  value={inquiryNotes}
                  onChange={(e) => setInquiryNotes(e.target.value)}
                  disabled={creatingDeal !== null}
                />
                <p className="text-xs text-slate-400">ההערות ישלחו כהודעה ראשונה בערוץ התקשורת עם התאגיד</p>
              </div>

              {/* Inline error display (e.g. tier_2 verification gate) */}
              {error && (
                <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <Button
                  onClick={handleConfirmInquiry}
                  disabled={creatingDeal !== null || !canSend}
                  className="flex-1"
                  title={!canSend ? 'יש לאשר את אי-ההתאמה לדרישות תחילה' : undefined}
                >
                  {creatingDeal
                    ? <><Loader2 className="h-4 w-4 animate-spin" />שולח פנייה...</>
                    : <><MessageSquarePlus className="h-4 w-4" />שלח פנייה לתאגיד</>}
                </Button>
                <Button
                  variant="ghost"
                  onClick={closeModal}
                  disabled={creatingDeal !== null}
                >
                  ביטול
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Results */}
      {!loading && !timedOut && bundles.length > 0 && (
        <div className="space-y-5">
          <p className="text-slate-500 text-sm">
            נמצאו <strong className="text-slate-700">{bundles.length}</strong> הצעות מתאימות
          </p>

          {bundles.map((bundle, bundleIdx) => {
            const avgPct    = bundleAvgScorePct(bundle);
            const corpName  = (bundle.corporation_name && bundle.corporation_name !== bundle.corporation_id)
              ? bundle.corporation_name
              : `ספק #${bundleIdx + 1}`;
            const mismatches = detectMismatches(bundle, lineItemMap, profMap);

            return (
              <div key={bundle.corporation_id} className="space-y-2">

              {/* ── Mismatch banner — shown only for blocking conflicts;
                   count gaps are surfaced inside the inquiry modal instead ── */}
              {mismatches.hasBlockingMismatch && (
                <div className="bg-amber-50 border-2 border-amber-300 rounded-xl px-4 py-4 flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    {mismatches.paragraphs.map((para, i) => (
                      <p key={i} className="text-sm text-amber-800 leading-relaxed">{para}</p>
                    ))}
                  </div>
                </div>
              )}

              <Card className="overflow-hidden">
                {/* Bundle header */}
                <CardHeader className="bg-slate-50 border-b border-slate-100">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-slate-400">#{bundleIdx + 1}</span>
                        <CardTitle className="text-lg">{corpName}</CardTitle>
                      </div>

                      {/* Metrics row */}
                      <div className="flex flex-wrap gap-2 items-center">
                        {/* Per-profession fill counts */}
                        {(bundle.line_items ?? []).map(li => {
                          const liProfHe = profMap[li.profession] ?? li.profession;
                          const liFound  = li.workers?.length ?? 0;
                          const liNeeded = li.needed;
                          const liOk     = liFound >= liNeeded;
                          return (
                            <div key={li.line_item_id}
                              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs border font-medium ${
                                liOk
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                  : 'bg-amber-50 border-amber-200 text-amber-800'
                              }`}
                            >
                              {liOk
                                ? <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                : <AlertCircle  className="h-3 w-3 text-amber-500  shrink-0" />}
                              <span className="font-bold">{liFound}</span>
                              <span className="opacity-50">/</span>
                              <span>{liNeeded}</span>
                              <span>{liProfHe}</span>
                            </div>
                          );
                        })}

                        {/* Quality metric */}
                        <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5">
                          <Star className="h-3.5 w-3.5 text-amber-500" />
                          <div className="text-xs">
                            <span className="text-amber-600 font-medium">איכות: </span>
                            <span className={`font-bold ${avgPct >= 73 ? 'text-emerald-700' : avgPct >= 45 ? 'text-amber-700' : 'text-red-600'}`}>
                              {avgPct}%
                            </span>
                            <span className="text-amber-500 ms-1">({qualityLabel(avgPct)})</span>
                          </div>
                        </div>
                      </div>

                      {/* Threshold requirements (info only — contractor decides) */}
                      {bundle.threshold_requirements &&
                        Object.keys(bundle.threshold_requirements).length > 0 && (
                        <ThresholdRequirements req={bundle.threshold_requirements as Record<string, unknown>} />
                      )}
                    </div>

                    <Button
                      onClick={() => openInquiryModal(bundle)}
                      disabled={creatingDeal !== null}
                      size="sm"
                    >
                      {creatingDeal === bundle.corporation_id
                        ? <><Loader2 className="h-4 w-4 animate-spin" />יוצר פנייה...</>
                        : <><MessageSquarePlus className="h-4 w-4" />התקדם עם הצעה זו — צור קשר עם התאגיד</>}
                    </Button>
                  </div>
                </CardHeader>

                {/* Line items */}
                <CardContent className="p-0 divide-y divide-slate-100">
                  {(bundle.line_items ?? []).map((li, liIdx) => {
                    const reqLi        = lineItemMap[li.line_item_id];
                    const reqOrigins   = reqLi?.origin_preference ?? [];
                    const reqLangs     = reqLi?.required_languages ?? [];
                    const reqExpMonths = reqLi?.min_experience ?? 0;
                    // Map profession code to Hebrew name
                    const profHe       = profMap[li.profession] ?? li.profession;
                    const groups       = groupWorkers(li.workers ?? []);
                    const hasReq       = reqOrigins.length > 0 || reqLangs.length > 0 || reqExpMonths > 0;

                    return (
                      <div key={li.line_item_id}>
                        {/* Line item header */}
                        <div className="px-5 py-3 bg-slate-50/70 border-b border-slate-100">
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className="text-xs font-medium text-slate-400">#{liIdx + 1}</span>
                            <span className="text-sm font-semibold text-slate-800">{profHe}</span>
                            <Badge variant={li.is_filled ? 'success' : 'warning'} className="text-xs">
                              נמצאו {li.workers?.length ?? 0} / {li.needed} עובדים
                            </Badge>
                          </div>

                          {/* Requested criteria */}
                          {hasReq && (
                            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 ps-5 border-s-2 border-slate-200">
                              <span className="font-semibold text-slate-600">ביקשת:</span>
                              {reqOrigins.length > 0 && (
                                <span>
                                  מוצא:{' '}
                                  <strong className="text-slate-700">
                                    {reqOrigins.map(heOrigin).join(', ')}
                                  </strong>
                                </span>
                              )}
                              {reqLangs.length > 0 && (
                                <span>
                                  שפות:{' '}
                                  <strong className="text-slate-700">
                                    {reqLangs.map(heLang).join(', ')}
                                  </strong>
                                </span>
                              )}
                              {reqExpMonths > 0 && (
                                <span>
                                  ניסיון מינימלי:{' '}
                                  <strong className="text-slate-700">
                                    {expMonthsLabel(reqExpMonths)}
                                  </strong>
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Workers table */}
                        {groups.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-slate-400 text-xs border-b border-slate-100 bg-white">
                                  <th className="px-4 py-2 text-start font-medium">כמות</th>
                                  <th className="px-4 py-2 text-start font-medium">
                                    ארץ מוצא
                                    {reqOrigins.length > 0 && (
                                      <span className="text-slate-300 ms-1 font-normal">
                                        (ביקשת: {reqOrigins.map(heOrigin).join('/')})
                                      </span>
                                    )}
                                  </th>
                                  <th className="px-4 py-2 text-start font-medium">
                                    שפות
                                    {reqLangs.length > 0 && (
                                      <span className="text-slate-300 ms-1 font-normal">
                                        (נדרש: {reqLangs.map(heLang).join(', ')})
                                      </span>
                                    )}
                                  </th>
                                  <th className="px-4 py-2 text-start font-medium">
                                    שנות ניסיון
                                    {reqExpMonths > 0 && (
                                      <span className="text-slate-300 ms-1 font-normal">
                                        (מינ׳: {expMonthsLabel(reqExpMonths)})
                                      </span>
                                    )}
                                  </th>
                                  <th className="px-4 py-2 text-start font-medium">ויזה עד</th>
                                  <th className="px-4 py-2 text-start font-medium">
                                    <span className="flex items-center gap-1">
                                      ציון איכות
                                      <Info className="h-3 w-3" />
                                    </span>
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {groups.map((g, gi) => {
                                  const originMatch: 'ok' | 'mismatch' | 'none' =
                                    reqOrigins.length === 0 ? 'none'
                                    : reqOrigins.some((c) => c.toUpperCase() === (g.origin ?? '').toUpperCase())
                                      ? 'ok' : 'mismatch';

                                  const matchedLangCount = (g.languages ?? []).filter((l) =>
                                    reqLangs.some((r) => r.toLowerCase() === l.toLowerCase())
                                  ).length;
                                  const langMatch: 'ok' | 'mismatch' | 'none' =
                                    reqLangs.length === 0 ? 'none'
                                    : matchedLangCount === reqLangs.length ? 'ok' : 'mismatch';

                                  const expMatch: 'ok' | 'mismatch' | 'none' =
                                    reqExpMonths === 0 ? 'none'
                                    : (g.experienceYears * 12) >= reqExpMonths ? 'ok' : 'mismatch';

                                  return (
                                    <tr key={gi} className="border-b border-slate-50 hover:bg-slate-50/70 transition-colors">
                                      {/* Count */}
                                      <td className="px-4 py-3">
                                        <span className="inline-flex items-center gap-1 bg-primary-50 text-primary-700 border border-primary-100 rounded-full px-2.5 py-0.5 text-xs font-bold">
                                          <Users className="h-3 w-3" />
                                          {g.count}
                                        </span>
                                      </td>

                                      {/* Origin */}
                                      <td className="px-4 py-3">
                                        <CompareCell
                                          requested={reqOrigins.map(heOrigin).join(' / ')}
                                          found={heOrigin(g.origin)}
                                          match={originMatch}
                                          label="ביקשת"
                                        />
                                      </td>

                                      {/* Languages */}
                                      <td className="px-4 py-3">
                                        {g.languages.length > 0 ? (
                                          <CompareCell
                                            requested={reqLangs.map(heLang).join(', ')}
                                            found={g.languages.map(heLang).join(', ')}
                                            match={langMatch}
                                            label="נדרש"
                                          />
                                        ) : (
                                          <span className="text-slate-400 text-xs">—</span>
                                        )}
                                      </td>

                                      {/* Experience */}
                                      <td className="px-4 py-3">
                                        <CompareCell
                                          requested={expMonthsLabel(reqExpMonths) ?? '—'}
                                          found={g.experienceYears > 0 ? `${g.experienceYears} שנים` : '—'}
                                          match={expMatch}
                                          label="נדרש"
                                        />
                                      </td>

                                      {/* Visa */}
                                      <td className="px-4 py-3 text-slate-600 text-xs">
                                        {formatDate(g.minVisa)}
                                        {g.count > 1 && (
                                          <span className="block text-slate-400">(המוקדם)</span>
                                        )}
                                      </td>

                                      {/* Score */}
                                      <td className="px-4 py-3">
                                        <ScoreBreakdown wm={g.representative} />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="px-5 py-3 text-sm text-slate-400 italic">
                            אין עובדים זמינים עבור מקצוע זה
                          </p>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

