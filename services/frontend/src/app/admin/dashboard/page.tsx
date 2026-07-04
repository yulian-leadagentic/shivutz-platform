'use client';

// Pivot/v2 admin dashboard — deal-free platform health snapshot.
// Legacy deals/tenders/workers tiles removed. New tiles: active corps,
// active contractors, active ads by type, trials expiring, reveals this
// month, pending registration approvals, subscribers by tier.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Building2, HardHat, Megaphone, Clock, Eye, ClipboardCheck, CreditCard,
} from 'lucide-react';
import { apiFetch } from '@/lib/api/client';

interface PivotStats {
  active_corps:       number;
  active_contractors: number;
  ads:                { worker: number; housing: number; total: number };
  trials_expiring_7d: number;
  reveals_this_month: number;
  pending_approvals:  number;
  subs_by_tier:       Record<string, number>;
  as_of:              string;
}

function Tile({
  icon: Icon, label, value, href, accent = 'brand',
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  href?:  string;
  accent?: 'brand' | 'amber' | 'emerald' | 'rose';
}) {
  const accentMap = {
    brand:   'bg-brand-50   text-brand-700',
    amber:   'bg-amber-50   text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    rose:    'bg-rose-50    text-rose-700',
  };
  const inner = (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-brand-300 transition">
      <div className={`w-10 h-10 rounded-lg ${accentMap[accent]} flex items-center justify-center mb-3`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-extrabold text-slate-900 mt-0.5">{value}</p>
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

export default function AdminDashboardPage() {
  const [stats, setStats]     = useState<PivotStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    apiFetch<PivotStats>('/admin/dashboard/pivot-stats')
      .then(setStats)
      .catch((e) => setError((e as Error).message ?? ''))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>;
  if (error || !stats) return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error || 'שגיאה'}</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">לוח בקרה</h1>
          <p className="text-xs text-slate-500">נכון ל־{new Date(stats.as_of).toLocaleString('he-IL')}</p>
        </div>
      </header>

      {stats.pending_approvals > 0 && (
        <Link
          href="/admin/approvals"
          className="flex items-start gap-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 hover:border-amber-300 transition"
        >
          <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-amber-900">{stats.pending_approvals} רישומים ממתינים לאישור</h3>
            <p className="text-sm text-amber-800 mt-0.5">תאגידים וקבלנים חדשים ממתינים לאישור מנהל.</p>
          </div>
        </Link>
      )}

      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">שוק</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile icon={Building2}  label="תאגידים פעילים"    value={stats.active_corps}       href="/admin/orgs" />
          <Tile icon={HardHat}    label="קבלנים פעילים"    value={stats.active_contractors} href="/admin/orgs" />
          <Tile icon={Megaphone}  label="מודעות עובדים"    value={stats.ads.worker}         href="/admin/ads?ad_type=worker"  accent="emerald" />
          <Tile icon={Megaphone}  label="מודעות דיור"      value={stats.ads.housing}        href="/admin/ads?ad_type=housing" accent="emerald" />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">מנויים ושימוש</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile icon={Clock}       label="ניסיונות שפגים ב-7 ימים"   value={stats.trials_expiring_7d} href="/admin/subscriptions?status=trialing" accent="amber" />
          <Tile icon={Eye}         label="חשיפות בחודש הנוכחי"        value={stats.reveals_this_month} accent="emerald" />
          <Tile icon={CreditCard}  label="מנויים בסיסי"                value={stats.subs_by_tier['basic']    ?? 0} href="/admin/subscriptions?tier=basic" />
          <Tile icon={CreditCard}  label="מנויים מתקדם + פרו"          value={(stats.subs_by_tier['advanced'] ?? 0) + (stats.subs_by_tier['pro'] ?? 0)} href="/admin/subscriptions" accent="emerald" />
        </div>
      </div>
    </div>
  );
}
