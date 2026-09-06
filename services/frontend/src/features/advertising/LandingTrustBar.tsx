'use client';

// Pivot/v2 — real-numbers trust bar for the landing. Aggregate stats
// only, no PII.
//
// H8 §1 — threshold-gated. A trust bar with tiny numbers PROVES the
// platform is empty; below the threshold it persuades in the wrong
// direction. Gate on both:
//   • worker_ads >= WORKER_AD_MIN (20)
//   • active_corps >= ACTIVE_CORPS_MIN (10)
// Under the threshold: `return null`. The component stays wired in
// so that once the numbers cross the line naturally the bar comes
// back with zero code changes — that's the whole point of the gate:
// **presence is the decision, not the code path**.
//
// `reveals_last_30d` was also removed as a tile: it's an internal
// metric — it just tells a visitor how little activity is going on.
// Not deleted from the API (admin still uses it); just no longer
// displayed on the public bar.

import { useEffect, useState } from 'react';
import { Building2, Users, Home } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';

interface PublicStats {
  active_corps:     number;
  worker_ads:       number;
  housing_ads:      number;
  reveals_last_30d: number;
}

// H8 §1 thresholds — a trust bar under this feels sadder than empty.
// If both conditions clear, we're at least showing real numbers that
// don't invite pity.
const WORKER_AD_MIN   = 20;
const ACTIVE_CORPS_MIN = 10;

function housingLabel(n: number): string {
  // "1 מודעות דיור" is plural-noun on a singular number and reads as
  // broken Hebrew. Proper form for n=1 is a feminine singular.
  if (n === 1) return 'מודעת דיור אחת';
  return 'מודעות דיור';
}
function workersLabel(n: number): string {
  if (n === 1) return 'מודעת עובדים אחת';
  return 'מודעות עובדים';
}
function corpsLabel(n: number): string {
  if (n === 1) return 'תאגיד פעיל אחד';
  return 'תאגידים פעילים';
}

export function LandingTrustBar() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  useEffect(() => {
    apiFetch<PublicStats>('/ads/public/stats')
      .then(setStats)
      .catch(() => setStats(null));
  }, []);
  if (!stats) return null;

  // H8 §1 · Threshold gate. Under these levels, the bar hides
  // entirely — the section returns null and reserves no space.
  if (stats.worker_ads < WORKER_AD_MIN)     return null;
  if (stats.active_corps < ACTIVE_CORPS_MIN) return null;

  const items = [
    { icon: Building2, label: corpsLabel(stats.active_corps),   value: stats.active_corps },
    { icon: Users,     label: workersLabel(stats.worker_ads),   value: stats.worker_ads   },
    { icon: Home,      label: housingLabel(stats.housing_ads),  value: stats.housing_ads  },
  ].filter(i => i.value > 0);

  if (items.length === 0) return null;

  return (
    <section className="max-w-4xl mx-auto px-4 pb-6">
      <div className={`grid gap-3 ${items.length === 1 ? 'grid-cols-1' : items.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {items.map(({ icon: Icon, label, value }) => (
          <div key={label} className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
            <Icon className="w-5 h-5 text-brand-700 mx-auto" />
            <p className="text-2xl font-extrabold text-slate-900 mt-1.5 tabular-nums">{value.toLocaleString('he-IL')}</p>
            <p className="text-[11px] font-medium text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 text-center mt-2">מעודכן בזמן אמת · מספרים אמיתיים מהמערכת</p>
    </section>
  );
}
