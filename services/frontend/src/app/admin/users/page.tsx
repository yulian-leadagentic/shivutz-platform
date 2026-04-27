'use client';

import { useEffect, useState, FormEvent } from 'react';
import { Loader2, UserPlus, ShieldCheck, ShieldAlert, Phone, Mail, Building2 } from 'lucide-react';
import { adminApi, type AdminUser } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const ROLE_LABEL: Record<string, string> = {
  admin:       'מנהל',
  contractor:  'קבלן',
  corporation: 'תאגיד',
};

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('he-IL');
}

export default function AdminUsersPage() {
  const [users, setUsers]       = useState<AdminUser[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [filterRole, setFilterRole] = useState<'all' | 'admin' | 'contractor' | 'corporation'>('all');
  const [search, setSearch]     = useState('');
  const [adding, setAdding]     = useState(false);
  const [addForm, setAddForm]   = useState({ full_name: '', phone: '' });
  const [addingBusy, setAddingBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [toasts, setToasts]     = useState<string[]>([]);

  function pushToast(msg: string) {
    setToasts((t) => [...t, msg]);
    setTimeout(() => setToasts((t) => t.slice(1)), 4000);
  }

  function load() {
    setLoading(true);
    setError('');
    adminApi.listUsers()
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : 'שגיאה'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAddError('');
    if (!addForm.full_name.trim() || !addForm.phone.trim()) {
      setAddError('יש להזין שם וטלפון');
      return;
    }
    setAddingBusy(true);
    try {
      await adminApi.addAdminUser({ full_name: addForm.full_name.trim(), phone: addForm.phone.trim() });
      pushToast('✓ מנהל חדש נוסף, נשלחה הודעת SMS');
      setAddForm({ full_name: '', phone: '' });
      setAdding(false);
      load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'שגיאה');
    } finally {
      setAddingBusy(false);
    }
  }

  async function toggle(u: AdminUser) {
    const op = u.is_active ? 'disable' : 'enable';
    try {
      if (u.is_active) await adminApi.disableUser(u.id);
      else             await adminApi.enableUser(u.id);
      pushToast(op === 'disable' ? '✓ המשתמש הושבת' : '✓ המשתמש הופעל');
      setUsers((arr) => arr.map((x) => (x.id === u.id ? { ...x, is_active: !x.is_active } : x)));
    } catch (e) {
      pushToast(`✗ ${e instanceof Error ? e.message : 'שגיאה'}`);
    }
  }

  const filtered = users.filter((u) => {
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [u.full_name, u.phone, u.email, u.org_name].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const adminCount = users.filter((u) => u.role === 'admin' && u.is_active).length;

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">משתמשים</h1>
          <p className="text-sm text-slate-500 mt-1">כל המשתמשים הרשומים במערכת — קבלנים, תאגידים, מנהלים.</p>
        </div>
        <Button onClick={() => setAdding(true)} className="shrink-0">
          <UserPlus className="h-4 w-4" /> הוסף מנהל
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          ['סה״כ',     users.length],
          ['מנהלים',  adminCount],
          ['קבלנים',  users.filter((u) => u.role === 'contractor').length],
          ['תאגידים', users.filter((u) => u.role === 'corporation').length],
        ] as Array<[string, number]>).map(([label, n]) => (
          <Card key={label}>
            <CardContent className="py-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="text-2xl font-bold text-slate-900 mt-0.5">{n}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add admin form */}
      {adding && (
        <Card className="border-brand-300 bg-brand-50/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-brand-600" /> מנהל חדש
            </CardTitle>
            <CardDescription>
              ייווצר משתמש עם הרשאת מנהל. הודעת SMS עם קישור לכניסה תישלח אוטומטית.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="text-xs text-slate-500 block mb-1">שם מלא</label>
                <input value={addForm.full_name}
                  onChange={(e) => setAddForm((f) => ({ ...f, full_name: e.target.value }))}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">טלפון נייד</label>
                <input value={addForm.phone} type="tel" placeholder="050-0000000" dir="ltr"
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={addingBusy}>
                  {addingBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  צור והודע
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setAdding(false); setAddError(''); }}>ביטול</Button>
              </div>
              {addError && (
                <p className="sm:col-span-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{addError}</p>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters + search */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5">
          {(['all', 'admin', 'contractor', 'corporation'] as const).map((r) => (
            <button key={r} onClick={() => setFilterRole(r)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filterRole === r
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}>
              {r === 'all' ? 'הכל' : ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חפש לפי שם / טלפון / אימייל"
          className="h-9 flex-1 min-w-[200px] max-w-sm rounded-md border border-slate-300 bg-white px-3 text-sm" />
      </div>

      {/* Users table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : error ? (
            <p className="p-4 text-sm text-red-600">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-10">אין משתמשים תואמים</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500 text-xs">
                    <th className="px-3 py-2.5 text-start font-medium">שם</th>
                    <th className="px-3 py-2.5 text-start font-medium">טלפון</th>
                    <th className="px-3 py-2.5 text-start font-medium">אימייל</th>
                    <th className="px-3 py-2.5 text-start font-medium">תפקיד</th>
                    <th className="px-3 py-2.5 text-start font-medium">ארגון</th>
                    <th className="px-3 py-2.5 text-start font-medium">כניסה אחרונה</th>
                    <th className="px-3 py-2.5 text-start font-medium">סטטוס</th>
                    <th className="px-3 py-2.5 text-end font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="px-3 py-2.5 text-slate-800 font-medium">{u.full_name || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600" dir="ltr">{u.phone || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600" dir="ltr">{u.email || '—'}</td>
                      <td className="px-3 py-2.5">
                        <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                          {ROLE_LABEL[u.role] || u.role}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 text-xs">{u.org_name || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-500 text-xs" dir="ltr">{fmtDate(u.last_login_at)}</td>
                      <td className="px-3 py-2.5">
                        {u.is_active
                          ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><ShieldCheck className="h-3 w-3" /> פעיל</span>
                          : <span className="inline-flex items-center gap-1 text-xs text-red-700"><ShieldAlert className="h-3 w-3" /> מושבת</span>}
                      </td>
                      <td className="px-3 py-2.5 text-end">
                        <Button size="sm" variant="outline" onClick={() => toggle(u)}>
                          {u.is_active ? 'השבת' : 'הפעל'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Toasts */}
      <div className="fixed bottom-6 start-6 space-y-2 z-50">
        {toasts.map((msg, i) => (
          <div key={i} className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${msg.startsWith('✓') ? 'bg-green-600' : 'bg-red-600'}`}>
            {msg}
          </div>
        ))}
      </div>
    </div>
  );
}
