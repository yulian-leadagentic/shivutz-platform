'use client';

import { useEffect, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { getAccessToken, decodeJwtPayload } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface OrgUser { id: string; user_id: string; email: string; role: string; joined_at: string; }

const ROLE_LABELS: Record<string, string> = {
  owner: 'בעלים', manager: 'מנהל', staff: 'עובד',
};

export default function CorporationUsersPage() {
  const [users, setUsers]     = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId]     = useState('');
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole]       = useState('staff');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const payload = decodeJwtPayload(token);
    const id = payload?.org_id as string;
    if (!id) return;
    setOrgId(id);
    apiFetch<OrgUser[]>(`/organizations/corporations/${id}/users`)
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleInvite() {
    if (!email || !password) { setError('יש למלא אימייל וסיסמה'); return; }
    setSaving(true); setError('');
    try {
      const u = await apiFetch<OrgUser>(`/organizations/corporations/${orgId}/users`, {
        method: 'POST',
        body: JSON.stringify({ email, password, role }),
      });
      setUsers((p) => [...p, u]);
      setEmail(''); setPassword(''); setRole('staff'); setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה');
    } finally { setSaving(false); }
  }

  function fmt(iso?: string) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('he-IL');
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">ניהול משתמשים</h2>
        <Button onClick={() => setShowForm((p) => !p)} variant={showForm ? 'outline' : 'default'} size="sm">
          <UserPlus className="h-4 w-4" />
          {showForm ? 'ביטול' : 'הוסף משתמש'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <h3 className="font-semibold text-slate-800 text-sm">הוספת משתמש חדש לארגון</h3>
            <Input label="אימייל" type="email" placeholder="user@corp.com" dir="ltr"
              value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input label="סיסמה זמנית" type="password" placeholder="לפחות 8 תווים" dir="ltr"
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">תפקיד</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="staff">עובד</option>
                <option value="manager">מנהל</option>
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button onClick={handleInvite} disabled={saving} className="w-full">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> שומר...</> : 'הוסף'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">
            {loading ? '...' : `${users.length} משתמשים`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : users.length === 0 ? (
            <p className="text-center text-slate-400 py-8">אין משתמשים</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="px-4 py-3 text-start font-medium">אימייל</th>
                  <th className="px-4 py-3 text-start font-medium">תפקיד</th>
                  <th className="px-4 py-3 text-start font-medium">הצטרף</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-900" dir="ltr">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        u.role === 'owner' ? 'bg-purple-100 text-purple-700' :
                        u.role === 'manager' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>{ROLE_LABELS[u.role] ?? u.role}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmt(u.joined_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
