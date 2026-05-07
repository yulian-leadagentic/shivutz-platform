'use client';

// Wave 4 (2026-05-07) — contractor dashboard simplified per
// key-user feedback: "המשתמשים אמרו שזה מסובך להם".
//
// Three primary tiles + a pending-approval banner. No more KPI cards,
// no urgent-deals strip, no recent-searches list — those live one
// click away on the dedicated pages.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Handshake, Settings as ManageIcon, Clock,
} from 'lucide-react';
import { dealApi, orgApi } from '@/lib/api';
import { getAccessToken, decodeJwtPayload } from '@/lib/auth';
import type { Deal } from '@/types';

const ACTIVE_DEAL_STATUSES = new Set([
  'proposed', 'corp_committed', 'counter_proposed',
  'accepted', 'active', 'reporting',
]);

function Tile({
  href, icon, title, subtitle, badge, accent = 'brand',
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: number | null;
  accent?: 'brand' | 'amber' | 'slate';
}) {
  const ringByAccent = {
    brand: 'hover:border-brand-500 hover:bg-brand-50/40',
    amber: 'hover:border-amber-400 hover:bg-amber-50/40',
    slate: 'hover:border-slate-400 hover:bg-slate-50/60',
  }[accent];
  const iconBgByAccent = {
    brand: 'bg-brand-50 text-brand-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-100 text-slate-600',
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

export default function ContractorDashboardPage() {
  const [activeDeals, setActiveDeals] = useState<number | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);

  useEffect(() => {
    // Org approval status from JWT
    const token = getAccessToken();
    if (token) {
      const payload  = decodeJwtPayload(token);
      const entityId = (payload?.entity_id || payload?.org_id) as string | undefined;
      const entType  = (payload?.entity_type || payload?.org_type) as string | undefined;
      if (entityId && entType === 'contractor') {
        orgApi.getContractor(entityId)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then((c: any) => setApprovalStatus(c.approval_status ?? null))
          .catch(() => {});
      }
    }

    // Active deals — for the "מצב עובדים" tile badge
    dealApi.list({ page_size: 200 })
      .then((res) => {
        const count = res.items.filter((d: Deal) =>
          ACTIVE_DEAL_STATUSES.has(d.status)
        ).length;
        setActiveDeals(count);
      })
      .catch(() => setActiveDeals(0));
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
              הבקשה שלך מטופלת — תקבל SMS עם קישור ישיר ברגע שהחשבון יאושר.
            </p>
          </div>
        </div>
      )}

      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">לוח בקרה</h1>
        <p className="text-sm text-slate-600">בחר פעולה</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile
          href="/contractor/deals"
          icon={<Handshake className="h-9 w-9" />}
          title="בדיקת מצב עובדים"
          subtitle="כל ההצעות, העסקאות הפעילות והדיווחים שלך"
          badge={activeDeals}
          accent="amber"
        />
        <Tile
          href="/contractor/find"
          icon={<Plus className="h-9 w-9" />}
          title="יצירת בקשת עובדים חדשה"
          subtitle="חיפוש קליל לפי מקצוע — תוצאות מתאגידים בלחיצה"
          accent="brand"
        />
        <Tile
          href="/contractor/manage"
          icon={<ManageIcon className="h-9 w-9" />}
          title="ניהול"
          subtitle="צוות, מסמכים ונתוני בקרה"
          accent="slate"
        />
      </div>
    </div>
  );
}
