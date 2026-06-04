'use client';

import { useEffect, useState, FormEvent } from 'react';
import { Loader2, UserPlus, Clock, CheckCircle2, Trash2, AlertCircle } from 'lucide-react';
import { memberApi, type TeamMember } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NotificationRecipientsSection } from '@/features/notification-recipients/NotificationRecipientsSection';

// Wave 2: 'operator' dropped — three roles cover the cases.
const ROLE_LABELS: Record<string, string> = {
  owner: 'בעלים', admin: 'מנהל', viewer: 'צופה',
};
const ROLE_COLORS: Record<string, string> = {
  owner:  'bg-navy-100 text-navy-700',
  admin:  'bg-blue-100 text-blue-700',
  viewer: 'bg-slate-100 text-slate-600',
};

export default function ContractorUsersPage() {
  const { entityId } = useAuth();
  const [members, setMembers]     = useState<TeamMember[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [phone, setPhone]         = useState('');
  const [role, setRole]           = useState('admin');
  const [jobTitle, setJobTitle]   = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [pendingDelete, setPendingDelete] = useState<TeamMember | null>(null);
  const [deleting, setDeleting]   = useState(false);

  async function handleDelete() {
    if (!entityId || !pendingDelete) return;
    setDeleting(true); setError('');
    try {
      await memberApi.remove('contractors', entityId, pendingDelete.membership_id);
      setMembers((prev) => prev.filter((m) => m.membership_id !== pendingDelete.membership_id));
      setPendingDelete(null);
      setSuccess('המשתמש הוסר מהצוות');
      setTimeout(() => setSuccess(''), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בהסרת המשתמש');
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!entityId) return;
    memberApi.list('contractors', entityId)
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
      const m = await memberApi.invite('contractors', entityId, {
        phone:      phone.trim(),
        role,
        jobTitle:   jobTitle || undefined,
        firstName:  firstName.trim() || undefined,
        lastName:   lastName.trim()  || undefined,
      });
      const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || null;
      setMembers((p) => [...p, {
        membership_id: m.membership_id, user_id: null, role: m.role,
        job_title: jobTitle || null, is_active: false,
        invitation_accepted_at: null, created_at: new Date().toISOString(),
        phone: phone.trim(), full_name: fullName, email: null, pending: true,
        invited_first_name: firstName.trim() || null,
        invited_last_name:  lastName.trim()  || null,
      }]);
      setFirstName(''); setLastName(''); setPhone(''); setRole('admin'); setJobTitle('');
      setShowForm(false);
      setSuccess('ההזמנה נשלחה ב-SMS / WhatsApp');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה';
      setError(msg === 'Contractor not found' ? 'ארגון לא נמצא' : msg);
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
            <p className="text-xs text-slate-500">קוד הזמנה ישלח ב-SMS / WhatsApp למספר הטלפון שתזין</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="שם פרטי"
                placeholder="ישראל"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
              <Input
                label="שם משפחה"
                placeholder="ישראלי"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
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
              placeholder="מנהל אתר בנייה"
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
                <option value="admin">מנהל — גישה מלאה לבקשות, עסקאות וצוות</option>
                <option value="viewer">צופה — קריאה בלבד</option>
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
                  <th className="px-4 py-3 text-end font-medium w-12" aria-label="פעולות" />
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
                    <td className="px-3 py-3 text-end">
                      <button
                        onClick={() => setPendingDelete(m)}
                        title="הסר משתמש"
                        aria-label={`הסר את ${m.full_name ?? 'המשתמש'}`}
                        className="inline-flex items-center justify-center h-7 w-7 rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Notification recipients — per-user opt-in + channel choice. */}
      <NotificationRecipientsSection entityType="contractor" entityId={entityId} />

      {/* Pending invitations */}
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
                  <th className="px-4 py-3 text-end font-medium w-12" aria-label="פעולות" />
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
                    <td className="px-3 py-3 text-end">
                      <button
                        onClick={() => setPendingDelete(m)}
                        title="בטל הזמנה"
                        aria-label="בטל הזמנה"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Delete confirmation modal — shared by active + pending rows. */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4"
          onClick={() => !deleting && setPendingDelete(null)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                {pendingDelete.pending ? <Clock className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-slate-900">
                  {pendingDelete.pending ? 'לבטל את ההזמנה?' : `להסיר את ${pendingDelete.full_name ?? 'המשתמש'} מהצוות?`}
                </h2>
                <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                  {pendingDelete.pending
                    ? 'ההזמנה תיעלם והקישור שנשלח יפסיק להיות תקף. ניתן להזמין שוב מאוחר יותר.'
                    : 'המשתמש לא יוכל להיכנס לקבלן ולא יקבל יותר התראות. הפעולה ניתנת לשחזור על ידי הזמנה מחדש.'}
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium text-sm disabled:opacity-50"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm shadow-sm disabled:opacity-50"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {pendingDelete.pending ? 'בטל הזמנה' : 'הסר משתמש'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
