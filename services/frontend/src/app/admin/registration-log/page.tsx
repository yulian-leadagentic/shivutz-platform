'use client';

import { useEffect, useState } from 'react';
import { Loader2, Phone, RefreshCw, ShieldAlert, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface LogEntry {
  otp_id: string;
  phone: string;
  attempts: number;
  status: 'verified' | 'expired' | 'locked' | 'failed_attempts' | 'pending';
  ip_address: string | null;
  created_at: string;
  expires_at: string;
  verified_at: string | null;
}

const STATUS_MAP: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  verified:        { label: 'עבר אימות',   cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  expired:         { label: 'פג תוקף',     cls: 'bg-slate-100 text-slate-500',     icon: Clock },
  locked:          { label: 'נחסם (5 ניסיונות)', cls: 'bg-red-100 text-red-700', icon: ShieldAlert },
  failed_attempts: { label: 'ניסיונות כושלים', cls: 'bg-amber-100 text-amber-700', icon: AlertTriangle },
  pending:         { label: 'ממתין',        cls: 'bg-blue-100 text-blue-700',      icon: Clock },
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

export default function RegistrationLogPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<'all' | 'failed' | 'verified'>('all');

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ entries: LogEntry[] }>(
        `/admin/registration-log?status=${filter}&limit=200`
      );
      setEntries(data.entries);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [filter]);

  const failed = entries.filter((e) => ['failed_attempts', 'locked', 'expired'].includes(e.status));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">לוג ניסיונות רישום</h1>
          <p className="text-sm text-slate-500 mt-1">OTP שנשלחו בתהליך הרישום — כולל כישלונות</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors">
          <RefreshCw className="h-3.5 w-3.5" />
          רענן
        </button>
      </div>

      {/* Summary banner for failures */}
      {failed.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">{failed.length} ניסיונות כושלים</p>
            <p className="text-xs text-amber-700 mt-0.5">
              מספרים שלא הצליחו לאמת — ייתכן שזקוקים לרישום ידני
            </p>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['all', 'failed', 'verified'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-sm font-medium px-4 py-2 rounded-xl border transition-colors ${
              filter === f
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300'
            }`}
          >
            {f === 'all' ? 'הכל' : f === 'failed' ? 'כישלונות' : 'הצליחו'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin me-2" />טוען...
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Phone className="h-10 w-10 mx-auto mb-3 text-slate-200" />
            <p>אין רשומות</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-xs text-slate-500 font-medium">
                <th className="text-start px-5 py-3">טלפון</th>
                <th className="text-start px-5 py-3">סטטוס</th>
                <th className="text-start px-5 py-3">ניסיונות</th>
                <th className="text-start px-5 py-3">IP</th>
                <th className="text-start px-5 py-3">נשלח</th>
                <th className="text-start px-5 py-3">אומת</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {entries.map((e) => {
                const s = STATUS_MAP[e.status] ?? STATUS_MAP.pending;
                const Icon = s.icon;
                return (
                  <tr key={e.otp_id} className="hover:bg-slate-50/50">
                    <td className="px-5 py-3 font-mono text-sm font-medium text-slate-900" dir="ltr">
                      {e.phone}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>
                        <Icon className="h-3 w-3" />
                        {s.label}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-bold ${e.attempts >= 3 ? 'text-red-600' : 'text-slate-500'}`}>
                        {e.attempts}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400 font-mono" dir="ltr">
                      {e.ip_address || '—'}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{fmtDate(e.created_at)}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{fmtDate(e.verified_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
