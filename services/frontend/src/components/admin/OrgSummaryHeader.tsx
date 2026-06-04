'use client';

/**
 * Single-glance summary for the admin /admin/orgs/{id} detail page.
 *
 * Shows everything the admin needs without scrolling past the edit
 * form: deal counts per status, team size, workers (corp) / open
 * searches (contractor), live gov data, and the most recent 10
 * deals. Backed by GET /admin/orgs/{id}/summary which aggregates
 * across org_db / deal_db / auth_db / worker_db.
 */

import Link from 'next/link';
import {
  Loader2, Handshake, Users, HardHat, FileSearch, ShieldCheck,
  AlertTriangle, MapPin, Mail, Phone, CalendarDays, Hash,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/adminApi';
import { dealRef } from '@/lib/utils';
import StatusBadge from '@/components/StatusBadge';

type Summary = Awaited<ReturnType<typeof adminApi.getOrgSummary>>;
type OrgType = 'contractor' | 'corporation';

// Status buckets surfaced on the strip. Order matches the contractor
// + corp deals pages so the admin scans them in the same order they
// see in the user-facing UIs.
const DEAL_STATUS_GROUPS: Array<{
  key: string;
  label: string;
  statuses: string[];
  tone: string;
}> = [
  { key: 'proposed',       label: 'הצעה נכנסה',   statuses: ['proposed'],                                          tone: 'bg-sky-500 text-white' },
  { key: 'corp_committed', label: 'התאגיד הגיב',  statuses: ['corp_committed'],                                    tone: 'bg-amber-500 text-white' },
  { key: 'approved',       label: 'בעבודה',       statuses: ['approved', 'active', 'counter_proposed', 'accepted'], tone: 'bg-emerald-500 text-white' },
  { key: 'closed',         label: 'נסגרו',        statuses: ['closed'],                                            tone: 'bg-slate-700 text-white' },
  { key: 'cancelled',      label: 'בוטלו / נדחו', statuses: ['cancelled', 'cancelled_by_corp', 'cancelled_by_contractor', 'rejected', 'expired'], tone: 'bg-rose-500 text-white' },
];

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('he-IL'); } catch { return iso; }
}

function fmtNumberOrDash(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('he-IL');
}

export function OrgSummaryHeader({ orgId, orgType, refreshKey }: {
  orgId: string;
  orgType: OrgType;
  /** Bump to force a re-fetch (e.g. after status change on the page). */
  refreshKey?: number;
}) {
  const [data, setData]       = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    adminApi.getOrgSummary(orgId, orgType)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'שגיאה'))
      .finally(() => setLoading(false));
  }, [orgId, orgType, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
        <Loader2 className="h-4 w-4 animate-spin" /> טוען מידע מצרפי...
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800">
        לא ניתן לטעון את המידע המצרפי: {error}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Verification verdict — admin sees at a glance whether this
          contractor self-verified vs. was admin-approved, and whether
          their contact info matches what פנקס הקבלנים has on file. */}
      {orgType === 'contractor' && data.verification_status && (
        <ContractorVerificationBanner status={data.verification_status} />
      )}

      {/* KPI strip — deal status counts + team + workers / searches */}
      <DealStatusStrip
        counts={data.deal_counts}
        teamCount={data.team_count}
        workers={data.workers}
        openSearches={data.open_searches}
        orgType={orgType}
      />

      {/* Gov data — different shape per role. */}
      {orgType === 'contractor' && data.gov.contractor && (
        <ContractorGovPanel gov={data.gov.contractor} businessNumber={(data.org.business_number as string) ?? ''} />
      )}
      {orgType === 'corporation' && data.gov.corporation && (
        <CorporationGovPanel gov={data.gov.corporation} businessNumber={(data.org.business_number as string) ?? ''} />
      )}

      {/* Recent deals — the actual activity on this org */}
      {data.recent_deals.length > 0 && (
        <RecentDealsTable deals={data.recent_deals} orgType={orgType} />
      )}
    </div>
  );
}

// ── Contractor verification verdict banner ────────────────────────────────
function ContractorVerificationBanner({ status }: {
  status: NonNullable<Summary['verification_status']>;
}) {
  const verdict = status.verdict;
  const phoneMatch = status.phone_match;
  const emailMatch = status.email_match;
  const anyMismatch = phoneMatch === false || emailMatch === false;

  // Tone is picked by verdict, then escalated if any contact channel
  // mismatches the registry — a 'verified' verdict with a mismatched
  // phone is a real warning sign worth surfacing.
  let tone: 'good' | 'warn' | 'danger';
  let icon: React.ReactNode;
  let title: string;
  let body: string;

  if (verdict === 'verified' && !anyMismatch) {
    tone = 'good';
    icon = <ShieldCheck className="h-5 w-5" />;
    title = 'מאומת מול פנקס הקבלנים';
    body  = status.method === 'phone_match'
      ? 'אומת לפי התאמת מספר טלפון'
      : status.method === 'email_match'
        ? 'אומת לפי התאמת כתובת אימייל'
        : 'אומת לפי התאמת ח.פ';
  } else if (verdict === 'manual') {
    tone = anyMismatch ? 'danger' : 'warn';
    icon = <AlertTriangle className="h-5 w-5" />;
    title = 'אושר ידנית — ללא אימות אוטומטי';
    body  = anyMismatch
      ? 'מנהל אישר ידנית, אך פרטי הקשר שהוזנו אינם תואמים את הרשום בפנקס הקבלנים. ראה פירוט למטה.'
      : 'הקבלן לא עבר אימות מול פנקס הקבלנים — אישור ניתן ידנית על ידי מנהל המערכת.';
  } else if (verdict === 'unverified' || verdict === 'legacy') {
    tone = anyMismatch ? 'danger' : 'warn';
    icon = <AlertTriangle className="h-5 w-5" />;
    title = 'לא אומת מול פנקס הקבלנים';
    body  = verdict === 'legacy'
      ? 'הקבלן הגיע ל-tier_2 דרך מסלול ישן (אימות מייל/SMS לפני שהוטמע אימות מספר רישיון). מומלץ לבקש מהקבלן לחזור ולאמת מספר רישיון.'
      : 'הקבלן ב-tier_2 ללא הוכחה של זהות מול הרשם.';
  } else { // pending
    tone = 'warn';
    icon = <AlertTriangle className="h-5 w-5" />;
    title = 'ממתין לאישור מנהל';
    body  = 'הקבלן לא במצב מאושר.';
  }

  const toneCls = tone === 'good'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
    : tone === 'warn'
      ? 'bg-amber-50 border-amber-200 text-amber-900'
      : 'bg-rose-50 border-rose-200 text-rose-900';
  const iconCls = tone === 'good' ? 'text-emerald-600'
    : tone === 'warn' ? 'text-amber-600'
    : 'text-rose-600';

  return (
    <div className={`rounded-lg border ${toneCls} px-4 py-3 flex flex-col gap-2`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 ${iconCls}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs mt-0.5">{body}</p>
        </div>
      </div>

      {/* Channel-match grid — only show when we have something to compare. */}
      {(status.registry_phone || status.registry_email) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1 text-xs">
          {status.registry_phone && (
            <ChannelMatchRow
              label="טלפון"
              userValue={status.user_phone}
              registryValue={status.registry_phone}
              match={status.phone_match}
            />
          )}
          {status.registry_email && (
            <ChannelMatchRow
              label="אימייל"
              userValue={status.user_email}
              registryValue={status.registry_email}
              match={status.email_match}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ChannelMatchRow({ label, userValue, registryValue, match }: {
  label: string;
  userValue: string | null;
  registryValue: string | null;
  match: boolean | null;
}) {
  // Three-state visual: green/red dot, or grey if comparison wasn't possible.
  const dot = match === true ? 'bg-emerald-500'
    : match === false ? 'bg-rose-500'
    : 'bg-slate-300';
  const matchLabel = match === true ? 'תואם'
    : match === false ? 'לא תואם'
    : '—';
  return (
    <div className="rounded-md bg-white/70 border border-current/20 px-2.5 py-1.5">
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
        <span className="font-medium">{label}</span>
        <span className="text-xs opacity-70 ms-auto">{matchLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] opacity-80">
        <div>
          <p className="opacity-60">שהוזן</p>
          <p dir="ltr" className="font-mono truncate">{userValue || '—'}</p>
        </div>
        <div>
          <p className="opacity-60">בפנקס הקבלנים</p>
          <p dir="ltr" className="font-mono truncate">{registryValue || '—'}</p>
        </div>
      </div>
    </div>
  );
}

// ── KPI strip ──────────────────────────────────────────────────────────────
function DealStatusStrip({ counts, teamCount, workers, openSearches, orgType }: {
  counts: Summary['deal_counts'];
  teamCount: number;
  workers: Summary['workers'];
  openSearches: number;
  orgType: OrgType;
}) {
  function sumGroup(statuses: string[]): number {
    return statuses.reduce((acc, s) => acc + (counts[s] || 0), 0);
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {/* Total deals (always shown) */}
      <KpiTile
        icon={<Handshake className="h-4 w-4" />}
        label="עסקאות בסה״כ"
        value={counts.total ?? 0}
        tone="bg-slate-900 text-white"
      />

      {/* Per-status grouped buckets */}
      {DEAL_STATUS_GROUPS.map((g) => (
        <KpiTile
          key={g.key}
          icon={<Handshake className="h-4 w-4" />}
          label={g.label}
          value={sumGroup(g.statuses)}
          tone={g.tone}
        />
      ))}

      {/* Role-specific tile */}
      {orgType === 'contractor' && (
        <KpiTile
          icon={<FileSearch className="h-4 w-4" />}
          label="בקשות פתוחות"
          value={openSearches}
          tone="bg-brand-600 text-white"
        />
      )}
      {orgType === 'corporation' && workers && (
        <KpiTile
          icon={<HardHat className="h-4 w-4" />}
          label="עובדים בסה״כ"
          value={workers.total}
          tone="bg-brand-600 text-white"
          subtitle={`${workers.available} זמינים · ${workers.assigned} משובצים`}
        />
      )}

      {/* Team count — last tile, wraps to next row on narrow screens */}
      <KpiTile
        icon={<Users className="h-4 w-4" />}
        label="חברי צוות"
        value={teamCount}
        tone="bg-slate-200 text-slate-700"
      />
    </div>
  );
}

function KpiTile({ icon, label, value, tone, subtitle }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center justify-center h-7 w-7 rounded-md ${tone}`}>
          {icon}
        </span>
        <span className="text-2xl font-bold text-slate-900 leading-none">{fmtNumberOrDash(value)}</span>
      </div>
      <p className="text-xs font-medium text-slate-500 mt-2 truncate">{label}</p>
      {subtitle && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{subtitle}</p>}
    </div>
  );
}

// ── Contractor gov panel: פנקס הקבלנים + רשם החברות snapshot ───────────────
function ContractorGovPanel({ gov, businessNumber }: {
  gov: NonNullable<Summary['gov']['contractor']>;
  businessNumber: string;
}) {
  const govLink = businessNumber
    ? `https://www.gov.il/apps/moch/rasham/home?bn=${businessNumber}`
    : 'https://www.gov.il/apps/moch/rasham/home';
  return (
    <section className="rounded-lg border-2 border-blue-200 bg-blue-50/40 p-4 space-y-3">
      <header className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-900">פנקס הקבלנים + רשם החברות</h3>
          <p className="text-xs text-slate-600">
            נטען מ-data.gov.il לאחרונה ב-{fmtDate(gov.fetched_at)} ·{' '}
            <a href={govLink} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand-700">
              צפה באתר הממשלה
            </a>
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
        {/* From פנקס הקבלנים */}
        {gov.pinkash?.kablan_number && (
          <Field icon={<Hash className="h-4 w-4" />} label="מספר קבלן" value={gov.pinkash.kablan_number} ltr />
        )}
        {gov.pinkash?.kvutza && gov.pinkash?.sivug != null && (
          <Field icon={<Hash className="h-4 w-4" />} label="סיווג" value={`${gov.pinkash.kvutza}-${gov.pinkash.sivug}`} />
        )}
        {gov.pinkash?.gov_branch && (
          <Field label="ענף" value={gov.pinkash.gov_branch} />
        )}
        {gov.pinkash?.email && (
          <Field icon={<Mail className="h-4 w-4" />} label="אימייל בפנקס" value={gov.pinkash.email} ltr />
        )}
        {gov.pinkash?.phone && (
          <Field icon={<Phone className="h-4 w-4" />} label="טלפון בפנקס" value={gov.pinkash.phone} ltr />
        )}
        {gov.pinkash?.company_name_he && (
          <Field label="שם בפנקס" value={gov.pinkash.company_name_he} />
        )}
        {/* From רשם החברות */}
        {gov.ica?.gov_company_status && (
          <Field label="סטטוס רשם החברות" value={gov.ica.gov_company_status} />
        )}
        {gov.ica?.company_name_he && (
          <Field label="שם ברשם" value={gov.ica.company_name_he} />
        )}
      </div>

      {!gov.pinkash_found && !gov.ica_found && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          לא נמצאה התאמה ברשם החברות או בפנקס הקבלנים — נדרש אישור ידני.
        </div>
      )}
    </section>
  );
}

// ── Corporation gov panel: matched row from the uploaded gov PDF ───────────
function CorporationGovPanel({ gov, businessNumber }: {
  gov: NonNullable<Summary['gov']['corporation']>;
  businessNumber: string;
}) {
  return (
    <section className="rounded-lg border-2 border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
      <header className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-900">רשות האוכלוסין וההגירה</h3>
          <p className="text-xs text-slate-600">
            רשימת תאגידי כוח אדם מורשים לשנת <strong>{gov.source_year}</strong> · נטען ב-{fmtDate(gov.imported_at)}
            {businessNumber && <> · ח.פ <span dir="ltr" className="font-mono">{businessNumber}</span></>}
            {gov.serial_no != null && <> · שורה #{gov.serial_no} ברשימה</>}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        {gov.company_name_he && (
          <Field label="שם ברשימה" value={gov.company_name_he} />
        )}
        {gov.address && (
          <Field icon={<MapPin className="h-4 w-4" />} label="כתובת" value={gov.address} />
        )}
        {gov.phone_mobile_1 && (
          <Field icon={<Phone className="h-4 w-4" />} label="נייד" value={gov.phone_mobile_1} ltr />
        )}
        {gov.phone_mobile_2 && (
          <Field icon={<Phone className="h-4 w-4" />} label="נייד נוסף" value={gov.phone_mobile_2} ltr />
        )}
        {gov.phone_landline_1 && (
          <Field icon={<Phone className="h-4 w-4" />} label="טלפון משרד" value={gov.phone_landline_1} ltr />
        )}
        {gov.phone_landline_2 && (
          <Field icon={<Phone className="h-4 w-4" />} label="טלפון משרד נוסף" value={gov.phone_landline_2} ltr />
        )}
      </div>
    </section>
  );
}

// ── Recent deals ───────────────────────────────────────────────────────────
// "Waiting on whom" — the most operationally meaningful column for an
// admin reviewing one org's deal history. Mirrors the STUCK_OWNER map
// in services/admin/app/routes/deals.py + org_summary.py. The label
// + tone is the admin shortcut for "where is this stuck right now."
const STUCK_LABEL: Record<string, string> = {
  corp:       'אצל התאגיד',
  contractor: 'אצל הקבלן',
  system:     'אצל המערכת',
  admin:      'דורש אדמין',
  neither:    'סגור',
  unknown:    '?',
};
const STUCK_TONE: Record<string, string> = {
  corp:       'bg-amber-100 text-amber-800 border-amber-200',
  contractor: 'bg-sky-100 text-sky-800 border-sky-200',
  system:     'bg-navy-100 text-navy-800 border-navy-200',
  admin:      'bg-rose-100 text-rose-800 border-rose-200',
  neither:    'bg-slate-100 text-slate-600 border-slate-200',
  unknown:    'bg-slate-100 text-slate-500 border-slate-200',
};

function StuckBadge({ on }: { on: string }) {
  const tone = STUCK_TONE[on] || STUCK_TONE.unknown;
  return (
    <span className={`inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded border ${tone} whitespace-nowrap`}>
      {STUCK_LABEL[on] || on}
    </span>
  );
}

function RecentDealsTable({ deals, orgType }: {
  deals: Summary['recent_deals'];
  orgType: OrgType;
}) {
  // The admin already knows whose page they're on, so we show the
  // OTHER party's name on each row — "with this contractor" / "with
  // this corp." Plus profession + stuck-on so the admin can see at a
  // glance where each deal is sitting.
  const otherSide = orgType === 'contractor' ? 'תאגיד' : 'קבלן';
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-bold text-slate-900 text-sm inline-flex items-center gap-2">
          <Handshake className="h-4 w-4 text-slate-500" />
          עסקאות אחרונות
        </h3>
        <Link href="/admin/deals" className="text-xs text-brand-600 hover:underline">
          ראה הכל
        </Link>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-500 text-xs bg-slate-50/60">
              <th className="px-3 py-2 text-start font-medium">עסקה</th>
              <th className="px-3 py-2 text-start font-medium">סטטוס</th>
              <th className="px-3 py-2 text-start font-medium">ממתין ל</th>
              <th className="px-3 py-2 text-start font-medium">{otherSide}</th>
              <th className="px-3 py-2 text-start font-medium">מקצוע</th>
              <th className="px-3 py-2 text-start font-medium">עובדים</th>
              <th className="px-3 py-2 text-start font-medium">סכום</th>
              <th className="px-3 py-2 text-start font-medium">עדכון אחרון</th>
              <th className="px-3 py-2 text-start font-medium">נפתחה</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" dir="ltr">{dealRef(d.id)}</td>
                <td className="px-3 py-2"><StatusBadge status={d.status} /></td>
                <td className="px-3 py-2"><StuckBadge on={d.stuck_on} /></td>
                <td className="px-3 py-2 text-slate-700 max-w-[180px] truncate" title={d.other_party_name ?? ''}>
                  {d.other_party_name ?? '—'}
                </td>
                <td className="px-3 py-2 text-slate-700">{d.profession_he ?? d.profession_type ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700">{fmtNumberOrDash(d.workers_count ?? d.dw_count)}</td>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                  {d.commission_amount != null ? `₪${Number(d.commission_amount).toLocaleString('he-IL')}` : '—'}
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3 text-slate-400" />
                    {fmtDate(d.updated_at)}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs whitespace-nowrap">{fmtDate(d.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Shared row primitive used by both gov panels ───────────────────────────
function Field({ icon, label, value, ltr }: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 bg-white/70 rounded-lg px-3 py-2 border border-white/40">
      {icon && <span className="text-slate-400 shrink-0">{icon}</span>}
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className="font-semibold text-slate-900 ms-auto truncate" dir={ltr ? 'ltr' : undefined}>{value}</span>
    </div>
  );
}
