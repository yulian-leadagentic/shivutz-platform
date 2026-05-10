'use client';

// Wave-5 — corporation dashboard rebuilt around the same tile pattern
// as the contractor dashboard. Three primary tiles + a pending-deals
// banner. KPI strip and inline tables removed — they live one click
// away on /corporation/deals and /corporation/workers.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Handshake, Users as UsersIcon, Settings as ManageIcon, Clock, AlertCircle,
} from 'lucide-react';
import { dealApi, workerApi, orgApi } from '@/lib/api';
import { getAccessToken, decodeJwtPayload } from '@/lib/auth';
import type { Deal, Worker } from '@/types';

const PENDING_DEAL_STATUSES = new Set(['proposed', 'counter_proposed']);
const ACTIVE_DEAL_STATUSES  = new Set(['accepted', 'active', 'reporting', 'corp_committed']);

function Tile({
  href, icon, title, subtitle, badge, accent = 'brand',
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: number | null;
  accent?: 'brand' | 'amber' | 'slate' | 'sky';
}) {
  const ringByAccent = {
    brand: 'hover:border-brand-500 hover:bg-brand-50/40',
    amber: 'hover:border-amber-400 hover:bg-amber-50/40',
    slate: 'hover:border-slate-400 hover:bg-slate-50/60',
    sky:   'hover:border-sky-400 hover:bg-sky-50/40',
  }[accent];
  const iconBgByAccent = {
    brand: 'bg-brand-50 text-brand-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-100 text-slate-600',
    sky:   'bg-sky-50 text-sky-600',
  }[accent];

  return (
    <Link
      href={href}
      className={`group relative flex flex-col items-center justify-center text-center
                  rounded-2xl border border-slate-200 bg-white
                  px-6 py-8 sm:py-10
                  ${ringByAccent} hover:shadow-md
                  active:scale-[0.99] transition shadow-sm`}
    >
      {badge != null && badge > 0 && (
        <div className="absolute top-3 left-3 min-w-[28px] h-7 px-2 rounded-full
                        bg-amber-500 text-white text-xs font-bold flex items-center
                        justify-center">
          {badge}
        </div>
      )}
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${iconBgByAccent}`}>
        {icon}
      </div>
      <div className="text-base sm:text-lg font-bold text-slate-900">{title}</div>
      <div className="text-sm text-slate-500 mt-1 max-w-[18rem]">{subtitle}</div>
    </Link>
  );
}

export default function CorporationDashboard() {
  const [pendingDeals, setPendingDeals] = useState<number | null>(null);
  const [activeDeals, setActiveDeals]   = useState<number | null>(null);
  const [workerCount, setWorkerCount]   = useState<number | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);

  useEffect(() => {
    // Org approval status from JWT
    const token = getAccessToken();
    if (token) {
      const payload  = decodeJwtPayload(token);
      const entityId = (payload?.entity_id || payload?.org_id) as string | undefined;
      const entType  = (payload?.entity_type || payload?.org_type) as string | undefined;
      if (entityId && entType === 'corporation') {
        orgApi.getCorporation(entityId)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then((c: any) => setApprovalStatus(c.approval_status ?? null))
          .catch(() => {});
      }
    }

    dealApi.list({ page_size: 200 })
      .then((res) => {
        setPendingDeals(res.items.filter((d: Deal) => PENDING_DEAL_STATUSES.has(d.status)).length);
        setActiveDeals(res.items.filter((d: Deal) => ACTIVE_DEAL_STATUSES.has(d.status)).length);
      })
      .catch(() => { setPendingDeals(0); setActiveDeals(0); });

    workerApi.list()
      .then((rows: Worker[]) => setWorkerCount(rows.length))
      .catch(() => setWorkerCount(0));
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Pending approval banner */}
      {approvalStatus === 'pending' && (
        <div className="flex items-start gap-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-900">החשבון ממתין לאישור</h3>
            <p className="text-sm text-amber-700 mt-0.5">
              הבקשה שלך מטופלת — תקבל SMS ברגע שהחשבון יאושר.
            </p>
          </div>
        </div>
      )}

      {/* Pending proposals strip — appears only when there's something
          urgent. A persistent affordance on top so the corp doesn't
          miss a contractor inquiry buried inside the deals page. */}
      {pendingDeals != null && pendingDeals > 0 && (
        <Link
          href="/corporation/deals?filter=proposed"
          className="flex items-center justify-between bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 hover:bg-amber-100 transition-colors shadow-sm"
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
            <div>
              <p className="font-semibold text-amber-900 text-sm">
                יש לך {pendingDeals} {pendingDeals === 1 ? 'הצעה' : 'הצעות'} שממתינות לתגובה שלך
              </p>
              <p className="text-amber-700 text-xs mt-0.5">לחץ לצפייה ולאישור</p>
            </div>
          </div>
          <span className="text-amber-700 text-sm font-medium whitespace-nowrap">לצפייה ←</span>
        </Link>
      )}

      {/* Hero — recruitment-side pitch for the corporation */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 sm:p-10">
        <div
          className="pointer-events-none absolute -top-24 end-0 h-72 w-72 rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, #38bdf8 0%, transparent 70%)' }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/30 bg-sky-400/10 px-3 py-1 text-xs font-medium text-sky-200">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-300 animate-pulse" />
              חבר ישירות לקבלנים פעילים
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white leading-[1.15] tracking-tight">
              פרסם עובדים זמינים — <span className="text-sky-300">קבלנים מחפשים</span>
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
              נהל את רשימת העובדים שלך, קבל פניות מקבלנים ועסקאות מאושרות במקום אחד.{' '}
              <span className="text-white font-medium">מנוע AI מתאים את העובדים לפרויקטים הנכונים.</span>
            </p>
          </div>

          <div className="lg:shrink-0">
            <Link
              href="/corporation/workers/new"
              className="inline-flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-slate-900 font-bold shadow-lg shadow-sky-500/20 px-7 h-11 rounded-lg text-base transition-colors"
            >
              <Plus className="h-5 w-5" />
              הוסף עובד
            </Link>
          </div>
        </div>
      </section>

      {/* Three primary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile
          href="/corporation/deals"
          icon={<Handshake className="h-9 w-9" />}
          title="עסקאות"
          subtitle="הצעות מקבלנים, עסקאות פעילות והיסטוריה"
          badge={(pendingDeals ?? 0) + (activeDeals ?? 0)}
          accent="amber"
        />
        <Tile
          href="/corporation/workers"
          icon={<UsersIcon className="h-9 w-9" />}
          title="עובדים"
          subtitle={
            workerCount == null
              ? 'נהל את רשימת העובדים, ויזות וזמינות'
              : `${workerCount} עובדים — נהל ויזות וזמינות`
          }
          accent="sky"
        />
        <Tile
          href="/corporation/manage"
          icon={<ManageIcon className="h-9 w-9" />}
          title="ניהול"
          subtitle="צוות, מסמכים, מנוי שוק והגדרות"
          accent="slate"
        />
      </div>
    </div>
  );
}
