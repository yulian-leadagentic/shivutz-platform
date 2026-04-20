'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, AlertCircle, Users, CheckCircle2, ArrowLeft,
  Info, CheckCheck, X as XIcon, Check, Star,
  MessageSquarePlus, AlertTriangle,
} from 'lucide-react';
import { jobApi, dealApi } from '@/lib/api';
import type { MatchBundle, WorkerMatchResult, JobRequest } from '@/types';
import { useEnums } from '@/features/enums/EnumsContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  heOrigin, heLang,
  MATCH_QUALITY_HIGH_PCT, MATCH_QUALITY_MEDIUM_PCT,
  MATCH_QUALITY_LABEL, matchQuality,
} from '@/i18n/he';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_SCORE = 110;

const CRITERIA_META: Record<string, { label: string; max: number }> = {
  profession:         { label: 'מקצוע',        max: 30 },
  region:             { label: 'אזור',          max: 20 },
  experience:         { label: 'ניסיון',        max: 20 },
  experience_partial: { label: 'ניסיון חלקי',   max: 12 },
  origin:             { label: 'ארץ מוצא',      max: 15 },
  languages:          { label: 'שפות',          max: 10 },
  languages_partial:  { label: 'שפות חלקיות',   max: 5  },
  visa:               { label: 'ויזה',          max: 15 },
  visa_tight:         { label: 'ויזה (גבולי)',  max: 8  },
};

const MISSING_META: Record<string, string> = {
  region: 'אזור', experience: 'ניסיון', origin: 'ארץ מוצא',
  languages: 'שפות', visa: 'ויזה',
};

function formatDate(s?: string) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('he-IL'); } catch { return s; }
}
function normalizeScore(raw: number) { return Math.min(1, Math.max(0, raw / MAX_SCORE)); }
function scorePct(raw: number) { return Math.round(normalizeScore(raw) * 100); }
function scoreColor(pct: number) {
  if (pct >= MATCH_QUALITY_HIGH_PCT) return 'success' as const;
  if (pct >= MATCH_QUALITY_MEDIUM_PCT) return 'warning' as const;
  return 'secondary' as const;
}
/** Human-readable quality label */
function qualityLabel(pct: number) {
  return MATCH_QUALITY_LABEL[matchQuality(pct)];
}

function expMonthsLabel(months: number) {
  if (!months || months <= 0) return null;
  if (months < 12) return `${months} חודשים`;
  const years = Math.floor(months / 12);
  const rem   = months % 12;
  return rem > 0 ? `${years} שנה ו-${rem} חודשים` : `${years}+ שנים`;
}

// ─── Comparison cell ──────────────────────────────────────────────────────────

function CompareCell({
  requested, found, match, label,
}: {
  requested: string; found: string;
  match: 'ok' | 'mismatch' | 'none'; label?: string;
}) {
  if (match === 'none') return <span className="text-slate-700">{found}</span>;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1">
        {match === 'ok'
          ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          : <XIcon  className="h-3.5 w-3.5 text-red-500   shrink-0" />}
        <span className={match === 'ok' ? 'text-slate-700' : 'text-slate-800 font-medium'}>
          {found}
        </span>
      </div>
      {match === 'mismatch' && (
        <div className="text-[10px] text-slate-400 ps-4">
          {label && `${label}: `}
          <span className="text-amber-600 font-medium">{requested}</span>
        </div>
      )}
    </div>
  );
}

// ─── Score breakdown tooltip ──────────────────────────────────────────────────

function ScoreBreakdown({ wm }: { wm: WorkerMatchResult }) {
  const [open, setOpen] = useState(false);
  const pct = scorePct(wm.score);
  return (
    <div className="relative inline-flex items-center gap-1">
      <Badge variant={scoreColor(pct)}>{pct}%</Badge>
      <button
        type="button"
        className="text-slate-400 hover:text-primary-500 transition-colors"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label="פירוט ציון"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute bottom-full end-0 mb-2 z-50 w-60 bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs">
          <div className="absolute bottom-[-6px] end-3 w-3 h-3 bg-white border-b border-e border-slate-200 rotate-45" />
          <p className="font-semibold text-slate-700 mb-0.5 text-center">
            {wm.score} / {MAX_SCORE} נקודות ({pct}%)
          </p>
          <p className="text-slate-400 text-center mb-2 text-[10px]">{qualityLabel(pct)}</p>
          <div className="space-y-1">
            {(wm.matched_criteria ?? []).map((c) => {
              const m = CRITERIA_META[c];
              if (!m) return null;
              return (
                <div key={c} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 text-emerald-700">
                    <CheckCheck className="h-3 w-3 shrink-0" /><span>{m.label}</span>
                  </div>
                  <span className="font-mono text-emerald-600">+{m.max}</span>
                </div>
              );
            })}
            {(wm.missing_criteria ?? []).map((c) => (
              <div key={c} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-red-500">
                  <XIcon className="h-3 w-3 shrink-0" /><span>{MISSING_META[c] ?? c}</span>
                </div>
                <span className="font-mono text-red-400">+0</span>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-slate-400 text-center text-[10px] leading-snug">
            מקצוע 30 · אזור 20 · ניסיון 20<br />
            ארץ מוצא 15 · ויזה 15 · שפות 10
          </div>
        </div>
      )}
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  if (tier === 'perfect') return <Badge variant="success">גבוהה</Badge>;
  if (tier === 'good')    return <Badge variant="warning">בינונית</Badge>;
  return <Badge variant="secondary">נמוכה</Badge>;
}

// ─── Worker grouping ──────────────────────────────────────────────────────────

interface WorkerGroup {
  origin: string;
  experienceYears: number;
  tier: string;
  languages: string[];
  minVisa?: string;
  avgScore: number;
  count: number;
  representative: WorkerMatchResult;
}

function groupWorkers(workers: WorkerMatchResult[]): WorkerGroup[] {
  const map = new Map<string, WorkerMatchResult[]>();
  for (const wm of workers) {
    const key = [
      (wm.worker.origin_country ?? '').toUpperCase(),
      wm.match_tier,
      wm.worker.experience_years ?? 0,
    ].join('|');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(wm);
  }
  const groups: WorkerGroup[] = [];
  for (const members of map.values()) {
    const rep = members[0];
    let minVisa: string | undefined;
    for (const m of members) {
      const v = m.worker.visa_valid_until;
      if (v && (!minVisa || v < minVisa)) minVisa = v;
    }
    const langSets = members.map((m) => new Set(m.worker.languages ?? []));
    const commonLangs = (members[0].worker.languages ?? []).filter((l) =>
      langSets.every((s) => s.has(l))
    );
    groups.push({
      origin: rep.worker.origin_country ?? '',
      experienceYears: rep.worker.experience_years ?? 0,
      tier: rep.match_tier,
      languages: commonLangs,
      minVisa,
      avgScore: Math.round(members.reduce((s, m) => s + m.score, 0) / members.length),
      count: members.length,
      representative: rep,
    });
  }
  const tierOrder = { perfect: 0, good: 1, partial: 2 };
  groups.sort((a, b) =>
    (tierOrder[a.tier as keyof typeof tierOrder] ?? 3) -
    (tierOrder[b.tier as keyof typeof tierOrder] ?? 3) ||
    b.avgScore - a.avgScore
  );
  return groups;
}

// ─── Bundle helpers ────────────────────────────────────────────────────────────

function getBundleWorkers(bundle: MatchBundle): WorkerMatchResult[] {
  return (bundle.line_items ?? []).flatMap((li) => li.workers ?? []);
}

function bundleAvgScorePct(bundle: MatchBundle): number {
  const ws = getBundleWorkers(bundle);
  if (!ws.length) return 0;
  return scorePct(ws.reduce((s, w) => s + w.score, 0) / ws.length);
}

// ─── Threshold requirements display ──────────────────────────────────────────

const THRESHOLD_LABELS: Record<string, string> = {
  minimum_contract_months: 'מינימום חוזה',
  housing_provided:        'דיור',
  insurance_included:      'ביטוח',
  employment_conditions:   'תנאי העסקה',
  other_notes:             'הערות',
  transportation:          'הסעות',
  meals_provided:          'ארוחות',
};

function formatThresholdValue(key: string, val: unknown): string {
  if (typeof val === 'boolean') return val ? 'כן ✓' : 'לא ✗';
  if (key === 'minimum_contract_months' && typeof val === 'number') {
    return `${val} חודשים`;
  }
  return String(val);
}

function ThresholdRequirements({ req }: { req: Record<string, unknown> }) {
  const entries = Object.entries(req).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!entries.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs bg-slate-100/80 border border-slate-200 rounded-lg px-3 py-2">
      <span className="font-semibold text-slate-600 shrink-0">תנאי סף:</span>
      {entries.map(([key, val]) => (
        <span key={key} className="text-slate-700">
          <span className="font-medium">{THRESHOLD_LABELS[key] ?? key}:</span>{' '}
          <span className={
            (key === 'housing_provided' || key === 'insurance_included' || key === 'transportation' || key === 'meals_provided')
              ? (val ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold')
              : ''
          }>
            {formatThresholdValue(key, val)}
          </span>
        </span>
      ))}
    </div>
  );
}

// ─── Construction animation ───────────────────────────────────────────────────

function ConstructionAnimation() {
  return (
    <div className="flex flex-col items-center gap-5">
      <svg viewBox="0 0 200 180" className="w-52 h-48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <style>{`
          @keyframes rise { from { transform: scaleY(0); opacity:0; } to { transform: scaleY(1); opacity:1; } }
          @keyframes crane-swing { 0%,100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
          @keyframes bob { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(-4px); } }
          @keyframes flash { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
          .f1 { transform-origin: 100px 158px; animation: rise 0.45s 0.15s ease-out both; }
          .f2 { transform-origin: 100px 139px; animation: rise 0.45s 0.55s ease-out both; }
          .f3 { transform-origin: 100px 120px; animation: rise 0.45s 0.95s ease-out both; }
          .f4 { transform-origin: 100px 101px; animation: rise 0.45s 1.35s ease-out both; }
          .crane { transform-origin: 163px 44px; animation: crane-swing 2.4s 1.8s ease-in-out infinite; }
          .w1 { transform-origin: 36px 158px; animation: bob 1.1s 0.3s ease-in-out infinite; }
          .w2 { transform-origin: 164px 158px; animation: bob 1.1s 0.8s ease-in-out infinite; }
          .spark { animation: flash 0.9s 1.4s ease-in-out infinite; }
        `}</style>

        {/* Ground */}
        <rect x="8" y="161" width="184" height="4" rx="2" fill="#e2e8f0"/>

        {/* Building — 4 floors (rise bottom-up) */}
        <rect x="52" y="140" width="96" height="21" rx="3" fill="#fb923c" className="f1"/>
        <rect x="55" y="119" width="90" height="21" rx="3" fill="#f97316" className="f2"/>
        <rect x="58" y="98"  width="84" height="21" rx="3" fill="#fb923c" className="f3"/>
        <rect x="62" y="77"  width="76" height="21" rx="3" fill="#f97316" className="f4"/>

        {/* Windows floor 1 */}
        <rect x="65"  y="145" width="11" height="13" rx="1.5" fill="#fff7ed" className="f1"/>
        <rect x="80"  y="145" width="11" height="13" rx="1.5" fill="#fff7ed" className="f1"/>
        <rect x="109" y="145" width="11" height="13" rx="1.5" fill="#fff7ed" className="f1"/>
        <rect x="124" y="145" width="11" height="13" rx="1.5" fill="#fff7ed" className="f1"/>

        {/* Windows floor 2 */}
        <rect x="68"  y="124" width="10" height="12" rx="1.5" fill="#fff7ed" className="f2"/>
        <rect x="82"  y="124" width="10" height="12" rx="1.5" fill="#fff7ed" className="f2"/>
        <rect x="108" y="124" width="10" height="12" rx="1.5" fill="#fff7ed" className="f2"/>
        <rect x="122" y="124" width="10" height="12" rx="1.5" fill="#fff7ed" className="f2"/>

        {/* Crane group */}
        <g className="crane">
          {/* Tower */}
          <rect x="161" y="40" width="7" height="121" rx="1.5" fill="#fbbf24"/>
          {/* Horizontal arm */}
          <rect x="100" y="37" width="71" height="7" rx="1.5" fill="#fbbf24"/>
          {/* Counterweight */}
          <rect x="161" y="37" width="14" height="7" rx="1" fill="#f59e0b"/>
          {/* Cable */}
          <line x1="118" y1="44" x2="118" y2="77" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 2"/>
          {/* Hook */}
          <path d="M115 75 Q118 80 121 75" stroke="#f59e0b" strokeWidth="2" fill="none" strokeLinecap="round"/>
          {/* Spark on hook */}
          <circle cx="118" cy="81" r="2.5" fill="#fef08a" className="spark"/>
        </g>

        {/* Worker 1 — left */}
        <g className="w1">
          <circle cx="36" cy="149" r="5.5" fill="#64748b"/>
          <rect x="33" y="154" width="7" height="10" rx="1.5" fill="#475569"/>
          {/* Hard hat */}
          <path d="M30.5 148.5 Q36 142 41.5 148.5" fill="#f97316"/>
          <rect x="30.5" y="148" width="11" height="2.5" rx="1" fill="#f97316"/>
          {/* Tool */}
          <line x1="43" y1="156" x2="50" y2="148" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/>
        </g>

        {/* Worker 2 — right */}
        <g className="w2">
          <circle cx="164" cy="149" r="5.5" fill="#64748b"/>
          <rect x="161" y="154" width="7" height="10" rx="1.5" fill="#475569"/>
          {/* Hard hat */}
          <path d="M158.5 148.5 Q164 142 169.5 148.5" fill="#f97316"/>
          <rect x="158.5" y="148" width="11" height="2.5" rx="1" fill="#f97316"/>
          {/* Tool */}
          <line x1="157" y1="156" x2="150" y2="148" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/>
        </g>
      </svg>

      <div className="text-center space-y-2">
        <p className="text-slate-800 font-bold text-xl">מחפש את ההתאמות הטובות ביותר…</p>
        <p className="text-slate-400 text-sm max-w-xs mx-auto leading-relaxed">
          המערכת סורקת עובדים זמינים לפי מקצוע, אזור, ניסיון, שפות וויזה
        </p>
      </div>

      {/* Bouncing dots */}
      <div className="flex gap-2">
        {[0, 150, 300].map((delay) => (
          <div
            key={delay}
            className="w-2.5 h-2.5 rounded-full bg-brand-500 animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Smart mismatch text generator ───────────────────────────────────────────

interface MismatchInfo {
  paragraphs: string[];   // natural Hebrew sentences, one per line-item with issues
  hasMismatch: boolean;
}

/**
 * Generates conversational Hebrew paragraphs describing what was found vs.
 * what the contractor requested, e.g.:
 * "נמצא רק עובד טייח אחד במאגר (מתוך 34 שביקשת) — הוא ממוצא אוקראינה
 *  ודובר אוקראינית בלבד. אם זה מתאים לך, תוכל להתקדם עם התאגיד.
 *  הבקשה תישאר פתוחה ונעדכן את התאגידים השונים בדבר החיפוש."
 */
function detectMismatches(
  bundle: MatchBundle,
  lineItemMap: Record<string, { origin_preference?: string[]; required_languages?: string[]; min_experience?: number }>,
  profMap: Record<string, string>,
): MismatchInfo {
  const paragraphs: string[] = [];

  for (const li of bundle.line_items ?? []) {
    const reqLi      = lineItemMap[li.line_item_id];
    if (!reqLi) continue;
    const workers    = li.workers ?? [];
    const profHe     = profMap[li.profession] ?? li.profession;
    const needed     = li.needed;
    const found      = workers.length;
    const reqOrigins = reqLi.origin_preference ?? [];
    const reqLangs   = reqLi.required_languages ?? [];
    const reqExpMon  = reqLi.min_experience ?? 0;

    // Derived facts
    const foundOrigins  = found > 0
      ? [...new Set(workers.map(w => (w.worker.origin_country ?? '').toUpperCase()).filter(Boolean))]
      : [];
    const allWorkerLangs = found > 0
      ? [...new Set(workers.flatMap(w => w.worker.languages ?? []).map(l => l.toLowerCase()))]
      : [];
    const countIssue    = found < needed;
    const originMismatch = reqOrigins.length > 0
      && foundOrigins.some(o => !reqOrigins.some(r => r.toUpperCase() === o));
    const langMismatch   = reqLangs.length > 0
      && reqLangs.some(rl => !allWorkerLangs.includes(rl.toLowerCase()));
    const expMismatch    = reqExpMon > 0
      && workers.some(w => (w.worker.experience_years ?? 0) * 12 < reqExpMon);

    if (!countIssue && !originMismatch && !langMismatch && !expMismatch) continue;

    // ── No workers found at all ──
    if (found === 0) {
      paragraphs.push(
        `לא נמצאו עובדי ${profHe} פנויים במאגר כרגע. ` +
        `הבקשה תישאר פתוחה ונעדכן את התאגידים השונים בדבר החיפוש.`
      );
      continue;
    }

    // ── Build sentence ──
    const sentence: string[] = [];

    // Count
    const plural     = found > 1;
    const foundWord  = plural ? `${found} עובדי ${profHe}` : `עובד ${profHe} אחד`;
    sentence.push(
      countIssue
        ? `נמצא${plural ? 'ו' : ''} רק ${foundWord} במאגר (מתוך ${needed} שביקשת)`
        : `נמצא${plural ? 'ו' : ''} ${foundWord} במאגר`
    );

    // Describe the found worker(s) if there's any mismatch
    if (originMismatch || langMismatch || expMismatch) {
      const pronoun = plural ? 'הם' : 'הוא';
      const attrs: string[] = [];
      if (foundOrigins.length > 0) {
        attrs.push(`ממוצא ${foundOrigins.map(heOrigin).join('/')}`);
      }
      if (allWorkerLangs.length > 0) {
        attrs.push(`דובר${plural ? 'י' : ''} ${allWorkerLangs.map(heLang).join(', ')} בלבד`);
      }
      if (attrs.length > 0) {
        sentence[0] += ` — ${pronoun} ${attrs.join(' ו')}`;
      }
    }

    // Mismatch specifics
    if (originMismatch && reqOrigins.length > 0) {
      sentence.push(`ביקשת עובדים מ-${reqOrigins.map(heOrigin).join('/')}`);
    }
    if (expMismatch && reqExpMon > 0) {
      const underExp = workers.filter(w => (w.worker.experience_years ?? 0) * 12 < reqExpMon);
      if (underExp.length === workers.length) {
        sentence.push(`לא עומד${plural ? 'ים' : ''} בדרישת ניסיון של ${expMonthsLabel(reqExpMon)}`);
      } else {
        sentence.push(`${underExp.length} מהעובדים לא עומדים בדרישת הניסיון`);
      }
    }

    // Closing
    sentence.push('אם זה מתאים לך, תוכל להתקדם עם התאגיד');
    sentence.push('הבקשה תישאר פתוחה ונעדכן את התאגידים השונים בדבר החיפוש');

    paragraphs.push(sentence.join('. ') + '.');
  }

  return { paragraphs, hasMismatch: paragraphs.length > 0 };
}

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

  const runMatch = useCallback(async () => {
    setLoading(true);
    setError('');
    setTimedOut(false);

    const timer = setTimeout(() => { setTimedOut(true); setLoading(false); }, 8000);
    try {
      const [reqData, results] = await Promise.all([
        jobApi.get(id).catch(() => null),
        jobApi.match(id),
      ]);
      clearTimeout(timer);
      setJobRequest(reqData);
      setBundles(results);
    } catch (err) {
      clearTimeout(timer);
      setError(err instanceof Error ? err.message : 'שגיאה בחיפוש התאמות');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { runMatch(); }, [runMatch]);

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
            <p className="text-slate-600 font-medium">לא נמצאו התאמות מתאימות</p>
            <p className="text-slate-400 text-sm">נסה לשנות את דרישות הבקשה</p>
            <Button variant="outline" asChild>
              <Link href="/contractor/requests/new">בקשה חדשה</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Inquiry modal ───────────────────────────────────────────────── */}
      {modalBundle && (() => {
        const modalMismatches = detectMismatches(modalBundle, lineItemMap, profMap);
        const canSend = !modalMismatches.hasMismatch || mismatchAcknowledged;
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

              {/* ── Mismatch acknowledgment (shown only when mismatches exist) ── */}
              {modalMismatches.hasMismatch && (
                <div className={`rounded-xl border-2 p-4 space-y-3 transition-colors ${
                  mismatchAcknowledged
                    ? 'bg-green-50 border-green-200'
                    : 'bg-amber-50 border-amber-300'
                }`}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`h-5 w-5 shrink-0 ${mismatchAcknowledged ? 'text-green-500' : 'text-amber-500'}`} />
                    <p className={`font-bold text-sm ${mismatchAcknowledged ? 'text-green-800' : 'text-amber-800'}`}>
                      שים לב — לפני השליחה
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

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <Button
                  onClick={handleConfirmInquiry}
                  disabled={creatingDeal !== null || !canSend}
                  className="flex-1"
                  title={!canSend ? 'יש לאשר את האי-התאמות תחילה' : undefined}
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

              {/* ── Mismatch banner ── */}
              {mismatches.hasMismatch && (
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

