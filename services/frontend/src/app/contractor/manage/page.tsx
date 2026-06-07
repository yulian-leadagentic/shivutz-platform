'use client';

// Wave 4 — contractor "ניהול" page.
//
// Top: lightweight KPI strip (open searches, active deals, total
// workers placed, last-7-days deals).
// Below: two big sub-tiles — צוות + מסמכים — for the page-level admin
// flows.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ChevronRight, Users, FileText, FolderOpen, Handshake, Activity,
} from 'lucide-react';
import { searchApi, dealApi } from '@/lib/api';
import type { WorkerSearch, Deal } from '@/types';

const ACTIVE_DEAL_STATUSES = new Set([
  'proposed', 'corp_committed', 'counter_proposed',
  'accepted', 'active', 'reporting',
]);

function StatCard({ icon, label, value, loading, href }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  loading: boolean;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="text-slate-400">{icon}</div>
      </div>
      {loading ? (
        <div className="h-7 w-16 bg-slate-100 rounded mt-2 animate-pulse" />
      ) : (
        <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
      )}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="block bg-white border border-slate-200 rounded-2xl p-4 shadow-sm
                   hover:border-brand-500 hover:bg-brand-50/30 hover:shadow-md
                   active:scale-[0.99] transition"
      >
        {body}
      </Link>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      {body}
    </div>
  );
}

function ManageTile({ href, icon, title, subtitle }: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl border border-slate-200
                 bg-white p-5 hover:border-brand-500 hover:bg-brand-50/30
                 hover:shadow-md active:scale-[0.99] transition shadow-sm"
    >
      <div className="w-14 h-14 rounded-xl bg-brand-50 text-brand-600
                      flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-base font-bold text-slate-900">{title}</div>
        <div className="text-sm text-slate-500 mt-0.5">{subtitle}</div>
      </div>
      <ChevronRight className="h-5 w-5 text-slate-300 rotate-180 shrink-0" />
    </Link>
  );
}

export default function ContractorManagePage() {
  const [searches, setSearches] = useState<WorkerSearch[] | null>(null);
  const [deals, setDeals]       = useState<Deal[] | null>(null);

  useEffect(() => {
    Promise.allSettled([
      searchApi.list().then(setSearches).catch(() => setSearches([])),
      dealApi.list({ page_size: 200 }).then((r) => setDeals(r.items)).catch(() => setDeals([])),
    ]);
  }, []);

  const loading      = !searches || !deals;
  const openSearches = searches?.filter((s) => s.status === 'open').length ?? 0;
  const activeDeals  = deals?.filter((d) => ACTIVE_DEAL_STATUSES.has(d.status)).length ?? 0;
  const totalDeals   = deals?.length ?? 0;
  const last7Days    = deals?.filter((d) => {
    const created = new Date(d.created_at);
    return Date.now() - created.getTime() < 7 * 24 * 60 * 60 * 1000;
  }).length ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-center gap-2">
        <Link
          href="/contractor/dashboard"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          <ChevronRight className="w-3 h-3 ml-1" /> חזרה
        </Link>
      </header>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">ניהול</h1>
        <p className="text-sm text-slate-600">נתוני בקרה, צוות ומסמכים</p>
      </div>

      {/* KPI strip — every tile is a deep-link into the relevant list */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<FolderOpen className="h-5 w-5" />}
          label="חיפושים פתוחים"
          value={openSearches}
          loading={loading}
          href="/contractor/deals"
        />
        <StatCard
          icon={<Handshake className="h-5 w-5" />}
          label="עסקאות פעילות"
          value={activeDeals}
          loading={loading}
          href="/contractor/deals?filter=active"
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          label="עסקאות 7 ימים אחרונים"
          value={last7Days}
          loading={loading}
          href="/contractor/deals"
        />
        <StatCard
          icon={<Handshake className="h-5 w-5" />}
          label="סה״כ עסקאות"
          value={totalDeals}
          loading={loading}
          href="/contractor/deals"
        />
      </div>

      {/* Sub-tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ManageTile
          href="/contractor/users"
          icon={<Users className="h-7 w-7" />}
          title="צוות"
          subtitle="ניהול גישה לחברי צוות בארגון"
        />
        <ManageTile
          href="/contractor/documents"
          icon={<FileText className="h-7 w-7" />}
          title="מסמכים"
          subtitle="העלאה והצגת מסמכי הקבלן"
        />
      </div>
    </div>
  );
}
