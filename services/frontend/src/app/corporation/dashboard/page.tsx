'use client';

// QA-R4 #C4 — corp dashboard restructured around the three inbound
// streams the corp actually triages:
//   1. Immediate-availability requests (contractor needs workers now)
//   2. Foreign-import requests          (contractor needs workers from abroad)
//   3. Deals (full lifecycle / history)
// Workers + Manage live in the sidebar; this surface is "what needs
// my attention today". Tile badges carry the urgency that used to be
// duplicated in a separate amber strip — that strip is gone now.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Settings as ManageIcon, Zap, Globe2, Clock,
} from 'lucide-react';
import { dealApi, orgApi } from '@/lib/api';
import { tenderApi } from '@/lib/api/tenders';
import { getAccessToken, decodeJwtPayload } from '@/lib/auth';
import type { Deal } from '@/types';

const PENDING_DEAL_STATUSES = new Set(['proposed', 'counter_proposed']);

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
        <div className="absolute top-3 end-3 min-w-[28px] h-7 px-2 rounded-full
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
  const [openTenders, setOpenTenders]   = useState<number | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [verificationTier, setVerificationTier] = useState<string | null>(null);

  useEffect(() => {
    // Org approval status from JWT
    const token = getAccessToken();
    if (token) {
      const payload  = decodeJwtPayload(token);
      const entityId = (payload?.entity_id || payload?.org_id) as string | undefined;
      const entType  = (payload?.entity_type || payload?.org_type) as string | undefined;
      if (entityId && entType === 'corporation') {
        orgApi.getCorporation(entityId)
          .then((c) => {
            setApprovalStatus(c.approval_status ?? null);
            setVerificationTier(c.verification_tier ?? null);
          })
          .catch(() => {});
      }
    }

    dealApi.list({ page_size: 200 })
      .then((res) => {
        setPendingDeals(res.items.filter((d: Deal) => PENDING_DEAL_STATUSES.has(d.status)).length);
      })
      .catch(() => { setPendingDeals(0); });

    // Foreign-import tenders the corp can still bid on — same filter
    // /corporation/tenders uses (no bid yet, or only withdrawn).
    tenderApi.listOpen()
      .then((open) => {
        const biddable = open.filter((t) => !t.my_bid || t.my_bid.status === 'withdrawn');
        setOpenTenders(biddable.length);
      })
      .catch(() => setOpenTenders(0));
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Two flavours of the pending-approval banner — depend on
          whether the corp made it to tier_2 (gov-list-matched but the
          typed phone didn't match the registered gov phones) or is
          still at tier_0/tier_1.
            tier_2 + pending  → can operate, admin doing extra verification
            tier_<2 + pending → blocked from publishing, waiting on admin */}
      {approvalStatus === 'pending' && verificationTier === 'tier_2' && (
        <div className="flex items-start gap-4 bg-sky-50 border border-sky-200 rounded-2xl p-4">
          <div className="shrink-0 w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center">
            <Clock className="h-5 w-5 text-sky-600" />
          </div>
          <div>
            <h3 className="font-semibold text-sky-900">החשבון מאושר לפעולה</h3>
            <p className="text-sm text-sky-700 mt-0.5">
              התאגיד מופיע ברשימת התאגידים המורשים — אישור סופי על ידי מנהל יושלם תוך 48 שעות. בינתיים תוכל להתחיל לפעול במלוא היקף השירותים.
            </p>
          </div>
        </div>
      )}
      {approvalStatus === 'pending' && verificationTier !== 'tier_2' && (
        <div className="flex items-start gap-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-900">החשבון ממתין לאישור</h3>
            <p className="text-sm text-amber-700 mt-0.5">
              הבקשה שלך מטופלת — תקבל SMS / WhatsApp ברגע שהחשבון יאושר.
            </p>
          </div>
        </div>
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
              התחבר ישירות לקבלנים פעילים
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white leading-[1.15] tracking-tight">
              פרסם עובדים זמינים מיידית — <span className="text-sky-300">עשרות קבלנים כבר מחפשים עובדים</span>
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
              נהל את רשימת העובדים שלך, קבל פניות מקבלנים ואשר עסקאות בקליק במקום אחד.{' '}
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

      {/* Three primary tiles — ordered to match the corp's mental
          model from QA-R4 R5 feedback:
            1. ניהול                              → /corporation/manage
            2. דרישה לעובדים בזמינות מיידית      → /corporation/deals?filter=proposed
            3. בקשת ייבוא של עובדים חדשים       → /corporation/tenders
          Tile labels mirror the prospect-side /try/corporation entry
          page so the same vocabulary (דרישה / בקשת ייבוא) carries
          through registration into the working dashboard. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile
          href="/corporation/manage"
          icon={<ManageIcon className="h-9 w-9" />}
          title="ניהול"
          subtitle="צוות, מסמכים, מנוי שירותים נלווים והגדרות"
          accent="slate"
        />
        <Tile
          href="/corporation/deals"
          icon={<Zap className="h-9 w-9" />}
          title="קבלנים מחפשים עובדים בזמינות מיידית"
          subtitle="כל הדרישות הפעילות של קבלנים + העסקאות שלך — במקום אחד"
          badge={pendingDeals}
          accent="amber"
        />
        <Tile
          href="/corporation/tenders"
          icon={<Globe2 className="h-9 w-9" />}
          title="בקשת ייבוא של עובדים חדשים"
          subtitle="קבלנים שמבקשים עובדים מחו״ל — אפשר להגיש הצעה"
          badge={openTenders}
          accent="sky"
        />
      </div>
    </div>
  );
}
