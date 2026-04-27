'use client';

import { useState } from 'react';
import { CheckCheck, X as XIcon, Info } from 'lucide-react';
import type { WorkerMatchResult } from '@/types';
import { Badge } from '@/components/ui/badge';
import { CRITERIA_META, MISSING_META, MAX_SCORE, scorePct, scoreColor, qualityLabel } from '../score';

export function ScoreBreakdown({ wm }: { wm: WorkerMatchResult }) {
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

export function TierBadge({ tier }: { tier: string }) {
  if (tier === 'perfect') return <Badge variant="success">גבוהה</Badge>;
  if (tier === 'good')    return <Badge variant="warning">בינונית</Badge>;
  return <Badge variant="secondary">נמוכה</Badge>;
}
