'use client';

// Match-preview gate — public counterpart of the "found matches"
// screen the real /contractor/find form lands on after submission.
// Two states:
//   1. Matches found (likely) — show teaser count + blurred placeholder
//      cards + registration gate.
//   2. No exact matches — explain we'll broadcast to all registered
//      corporations after registration. Same gate, different hero.
//
// The matcher is NOT actually run here (Phase 1). Phase 2 can swap the
// `decideOutcome` heuristic for a real public preview endpoint with
// proper redaction.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck, UserPlus, ArrowLeft, Sparkles, AlertCircle, Lock, Users, Send,
} from 'lucide-react';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { readPendingSearch, readProspect } from '@/features/prospect/state';
import type { PendingSearch } from '@/features/prospect/state';

type Outcome =
  | { kind: 'matched'; count: number }
  | { kind: 'no_match' };

// Decide outcome from the form. Phase 1: deterministic heuristic so a
// given form input always produces the same outcome (no flicker on
// back/forward). Phase 2: swap for a real public preview endpoint.
function decideOutcome(s: PendingSearch): Outcome {
  // No-match scenarios — demanding combos that would realistically
  // return zero exact hits in the real matcher:
  //   - 2+ years experience required (high bar)
  //   - very large group (15+) with strict origin preferences
  //   - very small group (1) with strict experience + origin
  const tight = (s.min_experience ?? 0) >= 24;
  const huge  = s.quantity >= 15 && (s.origin_preference?.length ?? 0) > 0;
  const niche = s.quantity === 1 && (s.min_experience ?? 0) >= 12 && (s.origin_preference?.length ?? 0) > 0;
  if (tight || huge || niche) return { kind: 'no_match' };

  const seed = s.quantity + (s.origin_preference?.length ?? 0) * 3 + (s.min_experience ?? 0);
  // 4-9 — believable inventory signal
  return { kind: 'matched', count: 4 + (seed % 6) };
}

function pickPreviewOrigins(s: PendingSearch): string[] {
  const fallback = ['UA', 'TH', 'IN'];
  const prefs = s.origin_preference ?? [];
  if (prefs.length >= 3) return prefs.slice(0, 3);
  const filler = fallback.filter((o) => !prefs.includes(o));
  return [...prefs, ...filler].slice(0, 3);
}

function originLabel(code: string): string {
  const map: Record<string, string> = {
    UA: 'אוקראינה', MD: 'מולדובה', LK: 'סרי לנקה',
    IN: 'הודו', PH: 'פיליפינים', TH: 'תאילנד', CN: 'סין',
  };
  return map[code] ?? code;
}

export default function MatchPreviewPage() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingSearch | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const prospect = readProspect();
    if (!prospect) { router.replace('/login?intent=contractor'); return; }
    const search = readPendingSearch();
    if (!search) { router.replace('/try/contractor'); return; }
    setPending(search);
    setReady(true);
  }, [router]);

  if (!ready || !pending) return <div className="min-h-screen bg-slate-50" />;

  const outcome = decideOutcome(pending);
  const previewOrigins = pickPreviewOrigins(pending);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8" dir="rtl">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Hero — varies by outcome */}
        {outcome.kind === 'matched' ? (
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 mb-2">
              <Sparkles className="h-7 w-7" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
              מצאנו עד <span className="text-emerald-700">{outcome.count}</span> התאמות פוטנציאליות
            </h1>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              תאגידים מאומתים עם עובדים מתאימים לבקשה שלך. כדי לראות את הפרטים
              ולפנות אליהם — צריך להירשם לפלטפורמה.
            </p>
          </div>
        ) : (
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 text-amber-700 mb-2">
              <Send className="h-7 w-7" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
              לא נמצאו התאמות מדויקות
            </h1>
            <p className="text-sm text-slate-700 max-w-md mx-auto leading-relaxed">
              אך הבקשה שלך מעניינת. כדי להפיץ אותה לכל התאגידים הרשומים בפלטפורמה
              ולקבל הצעות תוך 48 שעות — עליך להירשם.
            </p>
          </div>
        )}

        {/* Preview cards — only when there ARE matches. The no-match
            state skips the placeholder cards because there's nothing
            to preview; the broadcast gate below carries the message. */}
        {outcome.kind === 'matched' && (
          <>
            <div className="space-y-3">
              {previewOrigins.map((origin, idx) => (
                <div
                  key={`${origin}-${idx}`}
                  className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4"
                >
                  <div className="flex items-center gap-4">
                    {/* Profession icon — visible, no blur. The prospect
                        already chose this profession so it carries no
                        new info to hide. */}
                    <ProfessionIcon
                      code={pending.profession_type}
                      size={56}
                      className="shrink-0 object-contain"
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-base font-bold text-slate-900">
                          תאגיד {idx + 1}
                        </p>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">
                          <Lock className="h-3 w-3" /> מוסתר עד להרשמה
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 inline-flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-slate-400" />
                        {Math.max(2, pending.quantity - idx)} עובדים זמינים
                        {origin && ` · מ${originLabel(origin)}`}
                      </p>
                      {/* Blurred detail strips — represent the metadata
                          that would be visible to a registered user
                          (ניסיון, ויזה, אזור, מחיר). Filtered (blur)
                          + low contrast so they read as "more details
                          exist, locked away". */}
                      <div className="flex gap-2 mt-2 flex-wrap" aria-hidden="true">
                        <span className="h-2.5 w-20 rounded-full bg-slate-200 blur-[2px]" />
                        <span className="h-2.5 w-14 rounded-full bg-slate-200 blur-[2px]" />
                        <span className="h-2.5 w-24 rounded-full bg-slate-200 blur-[2px]" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {outcome.count > 3 && (
              <p className="text-center text-sm text-slate-500">
                + עוד {outcome.count - 3} התאמות פוטנציאליות נוספות
              </p>
            )}
          </>
        )}

        {/* Registration gate — same for both outcomes, copy adapted */}
        <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/40 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                כדי להמשיך — צריך להירשם
              </h2>
              <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                {outcome.kind === 'matched'
                  ? 'ההרשמה מהירה — הטלפון שלך כבר אומת, נשאר רק למלא פרטי חברה. לאחר ההרשמה תראה את ההתאמות המלאות ותוכל לפנות לתאגידים.'
                  : 'ההרשמה מהירה — הטלפון שלך כבר אומת, נשאר רק למלא פרטי חברה. לאחר ההרשמה הבקשה תופץ לכל התאגידים הרשומים ותקבל הצעות רלוונטיות.'}
              </p>
            </div>
          </div>
          <Link
            href="/register/contractor?from=trial"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-base shadow-md transition-colors"
          >
            <UserPlus className="h-5 w-5" />
            המשך להרשמה
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </div>

        <div className="text-center text-sm">
          <Link
            href={`/try/contractor/domestic/${pending.profession_type}`}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"
          >
            <AlertCircle className="h-4 w-4" />
            רוצה לעדכן את הבקשה?
          </Link>
        </div>

      </div>
    </div>
  );
}
