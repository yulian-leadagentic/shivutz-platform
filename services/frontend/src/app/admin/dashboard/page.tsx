'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, Briefcase, Handshake, CheckCircle2, Loader2 } from 'lucide-react';
import { adminApi, type AdminDashboard, type AdminAlerts } from '@/lib/adminApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

function KpiCard({
  label, value, icon: Icon, color, href,
}: {
  label: string; value: number | string; icon: React.ElementType;
  color: string; href?: string;
}) {
  const inner = (
    <Card className="hover:shadow-md transition-shadow cursor-pointer">
      <CardContent className="pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
          <div className={`p-3 rounded-full bg-opacity-10 ${color.replace('text-', 'bg-')}`}>
            <Icon className={`h-6 w-6 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Skeleton() {
  return <div className="h-28 bg-slate-200 rounded-xl animate-pulse" />;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminDashboard | null>(null);
  const [alerts, setAlerts] = useState<AdminAlerts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([adminApi.dashboard(), adminApi.alerts()])
      .then(([s, a]) => { setStats(s); setAlerts(a); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function fmt(iso?: string) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  }

  return (
    <div className="space-y-8">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} />)
        ) : stats ? (
          <>
            <KpiCard label="ממתינים לאישור"  value={stats.pending_approvals}   icon={Clock}         color="text-amber-600"  href="/admin/approvals" />
            <KpiCard label="עסקאות פעילות"   value={stats.active_deals}        icon={Handshake}     color="text-blue-600"   href="/admin/deals" />
            <KpiCard label="בקשות עבודה פתוחות" value={stats.open_job_requests} icon={Briefcase}    color="text-purple-600" />
            <KpiCard label="עסקאות הושלמו"   value={stats.completed_deals}     icon={CheckCircle2}  color="text-green-600" />
          </>
        ) : null}
      </div>

      {/* Discrepancy alerts */}
      {alerts && alerts.discrepancy_alerts.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              התראות אי-התאמה ({alerts.discrepancy_alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 border-b border-red-200">
                  <th className="pb-2 text-start font-medium">מזהה עסקה</th>
                  <th className="pb-2 text-start font-medium">עודכן</th>
                  <th className="pb-2 text-start font-medium">פרטים</th>
                </tr>
              </thead>
              <tbody>
                {alerts.discrepancy_alerts.map(a => (
                  <tr key={a.id} className="border-b border-red-100 last:border-0">
                    <td className="py-2 font-mono text-xs">{a.id.slice(0, 8)}</td>
                    <td className="py-2 text-slate-600">{fmt(a.updated_at)}</td>
                    <td className="py-2 text-slate-600 truncate max-w-xs">{a.discrepancy_details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* SLA warnings */}
      {alerts && alerts.sla_warnings.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-amber-700 flex items-center gap-2">
              <Clock className="h-5 w-5" />
              SLA בסכנה — אישורים שפגות תוך 8 שעות ({alerts.sla_warnings.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alerts.sla_warnings.map(org => (
                <div key={org.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-amber-200">
                  <div>
                    <p className="font-medium text-slate-900">{org.company_name}</p>
                    <p className="text-xs text-slate-500">{org.contact_email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="warning">
                      {org.org_type === 'contractor' ? 'קבלן' : 'תאגיד'}
                    </Badge>
                    <Link
                      href={`/admin/approvals?highlight=${org.id}`}
                      className="text-xs text-amber-700 underline font-medium"
                    >
                      אשר עכשיו
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All clear */}
      {!loading && alerts && alerts.discrepancy_alerts.length === 0 && alerts.sla_warnings.length === 0 && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-6 text-center text-green-700 font-medium">
            ✓ אין התראות פעילות — הכל תקין
          </CardContent>
        </Card>
      )}
    </div>
  );
}
