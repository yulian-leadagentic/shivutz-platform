'use client';

// Pivot/v2 — real-numbers trust bar for the landing. Aggregate stats
// only, no PII. Silently hides itself if the endpoint 500s. Tiles with
// a zero count are dropped (a "0" on a trust bar is worse than nothing);
// if every tile drops, the section hides entirely.

import { useEffect, useState } from 'react';
import { Building2, Users, Home, Eye } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';

interface PublicStats {
  active_corps:     number;
  worker_ads:       number;
  housing_ads:      number;
  reveals_last_30d: number;
}

export function LandingTrustBar() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  useEffect(() => {
    apiFetch<PublicStats>('/ads/public/stats')
      .then(setStats)
      .catch(() => setStats(null));
  }, []);
  if (!stats) return null;

  const items = [
    { icon: Building2, label: 'תאגידים פעילים',    value: stats.active_corps },
    { icon: Users,     label: 'מודעות עובדים',    value: stats.worker_ads   },
    { icon: Home,      label: 'מודעות דיור',      value: stats.housing_ads  },
    { icon: Eye,       label: 'חשיפות ב-30 יום',  value: stats.reveals_last_30d },
  ].filter(i => i.value > 0);

  if (items.length === 0) return null;

  return (
    <section className="max-w-4xl mx-auto px-4">
      <div className={`grid gap-3 ${items.length === 1 ? 'grid-cols-1' : items.length === 2 ? 'grid-cols-2' : items.length === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
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
