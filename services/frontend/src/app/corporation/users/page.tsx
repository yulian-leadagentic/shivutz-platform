'use client';

import { useEffect, useState, FormEvent } from 'react';
import { Loader2, UserPlus, Clock, CheckCircle2 } from 'lucide-react';
import { memberApi, type TeamMember } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ROLE_LABELS: Record<string, string> = {
  owner: 'בעלים', admin: 'מנהל', operator: 'מפעיל', viewer: 'צופה',
};
const ROLE_COLORS: Record<string, string> = {
  owner:    'bg-purple-100 text-purple-700',
  admin:    'bg-blue-100 text-blue-700',
  operator: 'bg-green-100 text-green-700',
  viewer:   'bg-slate-100 text-slate-600',
};

export default function CorporationUsersPage() {
  const { entityId } = useAuth();
  const [members, setMembers]   = useState<TeamMember[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [phone, setPhone]       = useState('');
  const [role, setRole]         = useState('operator');
  const [jobTitle, setJobTitle] = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  useEffect(() => {
    if (!entityId) return;
    memberApi.list('corporations', entityId)
      .then(setMembers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [entityId]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!entityId) return;
    if (!phone.trim()) { setError('יש להזין מספר טלפון'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const m = await memberApi.invite('corporations', entityId, phone.trim(), role, jobTitle || undefined);
      setMembers((p) => [...p, {
        membership_id: m.membership_id, user_id: null, role: m.role,
        job_title: jobTitle || null, is_active: false,
        invitation_accepted_at: null, created_at: new Date().toISOString(),
        phone: phone.trim(), full_name: null, email: null, pending: true,
      }]);
      setPhone(''); setRole('operator'); setJobTitle('');
      setShowForm(false);
      setSuccess('ההזמנה נשלחה ב-SMS');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה');
    } finally { setSaving(false); }
  }

  function fmt(iso?: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('he-IL');
  }

  const active  = members.filter((m) => !m.pending);
  const pending = members.filter((m) => m.pending);

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">ניהול צוות</h2>
        <Button
          onClick={() => { setShowForm((p) => !p); setError(''); }}
          variant={showForm ? 'outline' : 'default'}
          size="sm"
        >
          <UserPlus className="h-4 w-4" />
          {showForm ? 'ביטול' : 'הזמן חבר צוות'}
        </Button>
      </div>

      {success && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}

      {showForm && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h3 className="font-semibold text-slate-800 text-sm">הזמנת חבר צוות חדש</h3>
            <p className="text-xs text-slate-500">קוד הזמנה ישלח ב-SMS למספר הטלפון שתזין</p>
            <Input
              label="מספר טלפון נייד"
              type="tel"
              placeholder="050-0000000"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Input
              label="תפקיד בארגון (אופציונלי)"
              placeholder="מנהל השמה"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">הרשאות</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="operator">מפעיל — יכול לנהל עסקאות ועובדים</option>
                <option value="viewer">צופה — קריאה בלבד</option>
                <option value="admin">מנהל — גישה מלאה</option>
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="button" onClick={handleInvite} disabled={saving} className="w-full">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח...</> : 'שלח הזמנה'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Active members */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">
            {loading ? '...' : `${active.length} חברי צוות פעילים`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : active.length === 0 ? (
            <p className="text-center text-slate-400 py-6 text-sm">אין חברי צוות</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="px-4 py-3 text-start font-medium">שם / טלפון</th>
                  <th className="px-4 py-3 text-start font-medium">הרשאה</th>
                  <th className="px-4 py-3 text-start font-medium">הצטרף</th>
                </tr>
              </thead>
              <tbody>
                {active.map((m) => (
                  <tr key={m.membership_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{m.full_name ?? '—'}</div>
                      {m.phone && <div className="text-xs text-slate-400" dir="ltr">{m.phone}</div>}
                      {m.job_title && <div className="text-xs text-slate-400">{m.job_title}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ROLE_LABELS[m.role] ?? m.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmt(m.invitation_accepted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              {pending.length} הזמנות ממתינות
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="px-4 py-3 text-start font-medium">טלפון</th>
                  <th className="px-4 py-3 text-start font-medium">הרשאה</th>
                  <th className="px-4 py-3 text-start font-medium">נשלח</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((m) => (
                  <tr key={m.membership_id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 text-slate-500" dir="ltr">{m.phone ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ROLE_LABELS[m.role] ?? m.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{fmt(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
