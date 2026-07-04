'use client';

// Pivot/v2 — real-numbers trust bar for the landing. Aggregate stats
// only, no PII. Silently hides itself if the endpoint 500s.

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
  ];

  return (
    <section className="max-w-4xl mx-auto px-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map(({ icon: Icon, label, value }) => (
          <div key={label} className="bg-white rounded-2xl border border-slate-200 p-3 text-center">
            <Icon className="w-4 h-4 text-brand-600 mx-auto" />
            <p className="text-xl font-extrabold text-slate-900 mt-1">{value.toLocaleString('he-IL')}</p>
            <p className="text-[11px] text-slate-500">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
