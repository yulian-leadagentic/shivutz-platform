'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Clock, Briefcase, Handshake, Users, Building2, HardHat,
  Loader2, AlertTriangle, ChevronLeft, ShieldCheck, Hourglass, Wallet, TrendingUp,
} from 'lucide-react';
import { adminApi, type AdminDashboard, type AdminAlerts } from '@/lib/adminApi';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const DEAL_STATUS_LABEL: Record<string, string> = {
  proposed:           'הצעה נשלחה',
  corp_committed:     'תאגיד הציג רשימה',
  approved:           'הקבלן אישר',
  rejected:           'נדחתה',
  expired:            'פגה',
  cancelled_by_corp:  'בוטלה ע״י תאגיד',
  closed:             'נסגרה',
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

function StatTile({ label, value, sub, icon: Icon, color, href }: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ElementType;
  color: string;
  href?: string;
}) {
  const content = (
    <Card className={href ? 'hover:shadow-md transition-shadow cursor-pointer h-full' : 'h-full'}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`text-3xl font-bold mt-0.5 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
          </div>
          <div className={`p-2.5 rounded-lg ${color.replace('text-', 'bg-').replace('-600', '-50')}`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default function AdminDashboard() {
  const [stats, setStats]   = useState<AdminDashboard | null>(null);
  const [alerts, setAlerts] = useState<AdminAlerts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([adminApi.dashboard(), adminApi.alerts()])
      .then(([s, a]) => { setStats(s); setAlerts(a); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 bg-slate-200 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }
  if (!stats) return <p className="text-red-600">שגיאה בטעינת הנתונים</p>;

  const queues = stats.deal_queues;
  const slaWarnings = alerts?.sla_warnings ?? [];

  // Demand vs supply heatmap — merge both per-profession lists by code.
  const profMap = new Map<string, { code: string; name_he: string; available: number; assigned: number; demand_qty: number; open_requests: number }>();
  for (const w of stats.workers_by_profession) {
    profMap.set(w.code, { ...w, demand_qty: 0, open_requests: 0 });
  }
  for (const d of stats.demand_by_profession) {
    const cur = profMap.get(d.code) ?? { code: d.code, name_he: d.name_he, available: 0, assigned: 0, demand_qty: 0, open_requests: 0 };
    cur.demand_qty    += d.demand_qty;
    cur.open_requests += d.open_requests;
    profMap.set(d.code, cur);
  }
  const profMerged = [...profMap.values()].sort((a, b) =>
    (b.demand_qty + b.available) - (a.demand_qty + a.available),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-slate-900">לוח בקרה</h1>
        <p className="text-xs text-slate-400" dir="ltr">as of {fmtDate(stats.as_of)}</p>
      </div>

      {/* SLA WARNINGS — top of page when present */}
      {slaWarnings.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-700 flex items-center gap-2">
              <Clock className="h-5 w-5" /> SLA בסכנה — אישורים שפגים תוך 8 שעות ({slaWarnings.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {slaWarnings.map((org) => (
              <div key={org.id} className="flex items-center justify-between p-2 bg-white rounded-md border border-amber-200">
                <div>
                  <p className="font-medium text-slate-900 text-sm">{org.company_name}</p>
                  <p className="text-xs text-slate-500" dir="ltr">{org.contact_email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="warning">{org.org_type === 'contractor' ? 'קבלן' : 'תאגיד'}</Badge>
                  <Link href={`/admin/approvals?highlight=${org.id}`} className="text-xs text-amber-700 underline font-medium">
                    אשר עכשיו
                  </Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* HIGH-LEVEL COUNTS — orgs / workers / activity */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 mb-2">סך הכל במערכת</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="קבלנים"      value={stats.contractors.total}
            sub={`${stats.contractors.approved} מאושרים · ${stats.contractors.pending} ממתינים`}
            icon={HardHat} color="text-blue-600" href="/admin/orgs?type=contractor" />
          <StatTile label="תאגידים"     value={stats.corporations.total}
            sub={`${stats.corporations.approved} מאושרים · ${stats.corporations.pending} ממתינים`}
            icon={Building2} color="text-purple-600" href="/admin/orgs?type=corporation" />
          <StatTile label="עובדים"      value={stats.workers.total}
            sub={`${stats.workers.available} פנויים · ${stats.workers.assigned} משובצים`}
            icon={Users} color="text-emerald-600" />
          <StatTile label="עסקאות בתהליך"
            value={(queues.by_status.proposed ?? 0) + (queues.by_status.corp_committed ?? 0) + (queues.by_status.approved ?? 0)}
            sub={`${queues.by_status.closed ?? 0} נסגרו`}
            icon={Handshake} color="text-amber-600" href="/admin/deals" />
        </div>
      </div>

      {/* WHO'S WAITING — pending approvals + corp_committed + approved */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <StatTile label="ארגונים ממתינים לאישורך"
          value={stats.pending_approvals}
          sub="קבלנים + תאגידים"
          icon={Hourglass} color="text-amber-600" href="/admin/approvals" />
        <StatTile label="עסקאות ממתינות לקבלן"
          value={queues.waiting_for_contractor.length}
          sub="התאגיד שלח רשימה — מחכים לאישור הקבלן"
          icon={Hourglass} color="text-blue-600" />
        <StatTile label="חיובים בחלון 48 שעות"
          value={queues.waiting_for_capture.length}
          sub="הקבלן אישר — חיוב יורד אוטומטית"
          icon={Wallet} color="text-emerald-600" />
      </div>

      {/* DEAL STATUS BREAKDOWN */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Handshake className="h-4 w-4 text-slate-400" /> פירוט עסקאות לפי סטטוס</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(DEAL_STATUS_LABEL).map(([code, label]) => (
              <div key={code} className="p-3 rounded-md bg-slate-50 border border-slate-200">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-2xl font-bold text-slate-800 mt-0.5">{queues.by_status[code] ?? 0}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* TWO QUEUES — waiting_for_contractor + waiting_for_capture */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <QueueCard
          title="ממתינים לאישור הקבלן"
          subtitle="התאגיד שלח רשימת עובדים — דחוף אם > 24 שעות"
          rows={queues.waiting_for_contractor.map((d) => ({
            id: d.id,
            primary: `${d.worker_count} עובדים`,
            secondary: `${d.hours_waiting ?? 0} שעות במתנה`,
            tertiary: `פג: ${fmtDate(d.expires_at)}`,
            urgent: (d.hours_waiting ?? 0) > 24,
          }))}
        />
        <QueueCard
          title="ממתינים לחיוב אוטומטי"
          subtitle="הקבלן אישר — חיוב כשהזמן יגיע (אלא אם התאגיד יבטל)"
          rows={queues.waiting_for_capture.map((d) => ({
            id: d.id,
            primary: `₪${(d.commission_amount ?? 0).toLocaleString('he-IL')}`,
            secondary: `${Math.max(d.hours_until_capture ?? 0, 0)} שעות עד חיוב`,
            tertiary: `${d.worker_count} עובדים`,
            urgent: (d.hours_until_capture ?? 0) <= 6,
          }))}
        />
      </div>

      {/* DEMAND vs SUPPLY by profession */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-slate-400" /> ביקוש מול היצע לפי מקצוע</CardTitle>
          <CardDescription>שורות באדום: יש ביקוש אבל אין עובדים פנויים</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {profMerged.length === 0 ? (
            <p className="text-center text-slate-400 py-8">אין נתונים</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500 text-xs">
                    <th className="px-3 py-2 text-start font-medium">מקצוע</th>
                    <th className="px-3 py-2 text-start font-medium">פנויים</th>
                    <th className="px-3 py-2 text-start font-medium">משובצים</th>
                    <th className="px-3 py-2 text-start font-medium">ביקוש פתוח</th>
                    <th className="px-3 py-2 text-start font-medium">פערים</th>
                  </tr>
                </thead>
                <tbody>
                  {profMerged.map((p) => {
                    const gap = p.demand_qty - p.available;
                    const cls = gap > 0 ? 'bg-red-50' : (p.demand_qty === 0 && p.available > 0) ? 'bg-amber-50/40' : '';
                    return (
                      <tr key={p.code} className={`border-b border-slate-50 last:border-0 ${cls}`}>
                        <td className="px-3 py-2 text-slate-800 font-medium">{p.name_he || p.code}</td>
                        <td className="px-3 py-2 text-emerald-700">{p.available}</td>
                        <td className="px-3 py-2 text-slate-600">{p.assigned}</td>
                        <td className="px-3 py-2 text-blue-700">{p.demand_qty}{p.open_requests > 0 && <span className="text-xs text-slate-400 ms-1">({p.open_requests} בקשות)</span>}</td>
                        <td className="px-3 py-2">
                          {gap > 0
                            ? <span className="text-red-600 font-semibold">חסרים {gap}</span>
                            : p.demand_qty === 0 && p.available > 0
                              ? <span className="text-amber-600">{p.available} ללא ביקוש</span>
                              : <span className="text-emerald-600">מאוזן</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* IDLE WORKERS — professions with availability but zero demand */}
      {stats.idle_professions.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              עובדים פנויים ללא ביקוש פתוח
            </CardTitle>
            <CardDescription>{stats.idle_professions.length} מקצועות — שווה לחפש קבלנים שיכולים להעסיק אותם</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.idle_professions.map((p) => (
                <span key={p.code} className="inline-flex items-center gap-2 bg-white border border-amber-200 rounded-full px-3 py-1 text-sm">
                  <span className="font-medium">{p.name_he || p.code}</span>
                  <span className="text-amber-700 font-semibold">{p.available} פנויים</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All clear */}
      {slaWarnings.length === 0 && stats.pending_approvals === 0 && queues.waiting_for_contractor.length === 0 && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="py-4 text-center text-emerald-700 font-medium">
            ✓ אין ארגונים ממתינים, אין עסקאות תקועות
          </CardContent>
        </Card>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────
// QueueCard — used for the two waiting-for queues
// ─────────────────────────────────────────────────────────────────────────

function QueueCard({ title, subtitle, rows }: {
  title: string;
  subtitle: string;
  rows: Array<{ id: string; primary: string; secondary: string; tertiary: string; urgent?: boolean }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-center text-slate-400 py-6 text-sm">אין רישומים</p>
        ) : (
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {rows.map((r) => (
              <Link key={r.id} href={`/admin/deals/${r.id}`}
                className={`block px-4 py-2.5 hover:bg-slate-50 ${r.urgent ? 'bg-red-50/60' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-slate-400">#{r.id.slice(0, 8)}</span>
                    <span className="font-semibold text-slate-800 text-sm">{r.primary}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className={r.urgent ? 'text-red-600 font-semibold' : 'text-slate-500'}>{r.secondary}</span>
                    <span className="text-slate-400">{r.tertiary}</span>
                    <ChevronLeft className="h-3 w-3 text-slate-300" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
