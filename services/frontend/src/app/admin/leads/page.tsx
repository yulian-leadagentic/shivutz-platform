'use client';

import { useEffect, useState } from 'react';
import { Loader2, Phone, Check, RotateCcw, Trash2, Inbox } from 'lucide-react';
import { adminApi, type Lead } from '@/lib/adminApi';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Filter = 'false' | 'true' | 'all';
const FILTER_LABEL: Record<Filter, string> = {
  false: 'ממתינים',
  true:  'טופלו',
  all:   'הכל',
};

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('he-IL');
}

function sourceLabel(s: string | null) {
  if (!s) return 'לא ידוע';
  if (s === 'landing_page')   return 'דף נחיתה';
  if (s === 'refund_request') return '⚠ בקשת החזר';
  return s;
}

export default function AdminLeadsPage() {
  const [leads, setLeads]     = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<Filter>('false');
  const [error, setError]     = useState('');
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [toast, setToast]     = useState('');

  function pushToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000); }

  function load() {
    setLoading(true);
    setError('');
    adminApi.listLeads(filter)
      .then(setLeads)
      .catch((e) => setError(e instanceof Error ? e.message : 'שגיאה'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  async function markHandled(l: Lead) {
    setBusyId(l.id);
    try {
      await adminApi.markLeadHandled(l.id);
      pushToast('✓ סומן כטופל');
      load();
    } catch (e) {
      pushToast(`✗ ${e instanceof Error ? e.message : 'שגיאה'}`);
    } finally { setBusyId(null); }
  }
  async function reopen(l: Lead) {
    setBusyId(l.id);
    try {
      await adminApi.reopenLead(l.id);
      pushToast('✓ נפתח מחדש');
      load();
    } catch (e) {
      pushToast(`✗ ${e instanceof Error ? e.message : 'שגיאה'}`);
    } finally { setBusyId(null); }
  }
  async function remove(l: Lead) {
    if (!confirm('למחוק את הליד? פעולה זו אינה הפיכה.')) return;
    setBusyId(l.id);
    try {
      await adminApi.deleteLead(l.id);
      pushToast('✓ נמחק');
      load();
    } catch (e) {
      pushToast(`✗ ${e instanceof Error ? e.message : 'שגיאה'}`);
    } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">השאר פרטים לחזרה</h1>
        <p className="text-sm text-slate-500 mt-1">
          פניות מדף הנחיתה ובקשות החזר כספי מתאגידים.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5">
        {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}>
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : error ? (
            <p className="p-4 text-sm text-red-600">{error}</p>
          ) : leads.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Inbox className="h-10 w-10 mx-auto mb-2" />
              {filter === 'false' ? 'אין פניות ממתינות' : 'אין פניות'}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {leads.map((l) => {
                const isRefund = l.source === 'refund_request';
                const handled = !!l.handled_at;
                return (
                  <li key={l.id} className={`px-4 py-3 ${handled ? 'bg-slate-50/60' : ''} ${isRefund ? 'border-r-4 border-r-red-500' : ''}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-[200px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-slate-900">{l.full_name}</p>
                          <Badge variant={l.org_type === 'contractor' ? 'default' : 'secondary'}>
                            {l.org_type === 'contractor' ? 'קבלן' : 'תאגיד'}
                          </Badge>
                          {isRefund && <Badge variant="destructive">בקשת החזר</Badge>}
                          {handled && <Badge variant="outline" className="text-emerald-700 border-emerald-300">טופל</Badge>}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-slate-600">
                          <span className="inline-flex items-center gap-1" dir="ltr">
                            <Phone className="h-3 w-3 text-slate-400" />
                            <a href={`tel:${l.phone}`} className="hover:underline">{l.phone}</a>
                          </span>
                          <span className="text-xs text-slate-400">{sourceLabel(l.source)}</span>
                          <span className="text-xs text-slate-400" dir="ltr">{fmtDate(l.created_at)}</span>
                        </div>
                        {l.notes && <p className="mt-1.5 text-xs text-slate-600 whitespace-pre-wrap bg-slate-50 rounded p-2">{l.notes}</p>}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {handled ? (
                          <Button size="sm" variant="outline" onClick={() => reopen(l)} disabled={busyId === l.id}>
                            <RotateCcw className="h-3 w-3" /> פתח מחדש
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => markHandled(l)} disabled={busyId === l.id}
                                  className="bg-emerald-600 hover:bg-emerald-700">
                            <Check className="h-3 w-3" /> סמן כטופל
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => remove(l)} disabled={busyId === l.id}
                                className="text-red-600 hover:bg-red-50">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {toast && (
        <div className={`fixed bottom-6 start-6 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white z-50 ${toast.startsWith('✓') ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast}
        </div>
      )}
    </div>
  );
}
