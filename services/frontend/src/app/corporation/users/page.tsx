'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { Loader2, UserPlus, Clock, CheckCircle2, Trash2, AlertCircle, Pencil } from 'lucide-react';
import { memberApi, type TeamMember } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NotificationRecipientsSection } from '@/features/notification-recipients/NotificationRecipientsSection';
import { EditMemberModal } from '@/components/team/EditMemberModal';
import { TableToolbar } from '@/components/table/TableToolbar';
import { useTableState } from '@/components/table/useTableState';

// Wave 2: 'operator' dropped — three roles cover the cases.
const ROLE_LABELS: Record<string, string> = {
  owner: 'בעלים', admin: 'מנהל', viewer: 'צופה',
};
const ROLE_COLORS: Record<string, string> = {
  owner:  'bg-navy-100 text-navy-700',
  admin:  'bg-blue-100 text-blue-700',
  viewer: 'bg-slate-100 text-slate-600',
};

export default function CorporationUsersPage() {
  const { entityId } = useAuth();
  const [members, setMembers]   = useState<TeamMember[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [phone, setPhone]       = useState('');
  const [role, setRole]         = useState('admin');
  const [jobTitle, setJobTitle] = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  // Delete-confirmation modal state — null means closed; otherwise the
  // row we're about to remove.
  const [pendingDelete, setPendingDelete] = useState<TeamMember | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Edit-modal state — null means closed; otherwise the row being edited.
  const [editing, setEditing] = useState<TeamMember | null>(null);

  // Per-row toggle for is_deal_contact. Server enforces min-1; if a
  // user tries to unmark the last remaining contact we surface the
  // server's Hebrew message via the existing `error` channel.
  async function handleToggleDealContact(m: TeamMember, next: boolean) {
    if (!entityId) return;
    setError('');
    // Optimistic update — server's min-1 check rejects with a clear
    // message; we revert if that happens.
    const prev = members;
    setMembers((cur) => cur.map((x) => x.membership_id === m.membership_id ? { ...x, is_deal_contact: next } : x));
    try {
      await memberApi.setDealContact('corporations', entityId, m.membership_id, next);
    } catch (e) {
      setMembers(prev);
      const msg = e instanceof Error ? e.message : 'שגיאה בעדכון איש קשר';
      setError(msg);
      setTimeout(() => setError(''), 5000);
    }
  }

  async function handleDelete() {
    if (!entityId || !pendingDelete) return;
    setDeleting(true); setError('');
    try {
      await memberApi.remove('corporations', entityId, pendingDelete.membership_id);
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
    if (!entityId) {
      // No entity context (admin role, or multi-entity user yet to
      // pick one). Don't leave the spinner running forever — render
      // the empty state instead. The "select an entity" CTA in the
      // TopBar covers the recovery path.
      setLoading(false);
      return;
    }
    memberApi.list('corporations', entityId)
      .then(setMembers)
      .catch((e) => {
        console.error('memberApi.list corporation failed', e);
      })
      .finally(() => setLoading(false));
  }, [entityId]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!entityId) return;
    if (!phone.trim()) { setError('יש להזין מספר טלפון'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const m = await memberApi.invite('corporations', entityId, {
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
      setError(err instanceof Error ? err.message : 'שגיאה');
    } finally { setSaving(false); }
  }

  function fmt(iso?: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('he-IL');
  }

  // ── Filter + sort (light pattern — typical team is 2-20 rows) ──
  const [roleFilter, setRoleFilter] = useState<'all' | 'owner' | 'admin' | 'viewer'>('all');
  const [search, setSearch] = useState('');

  const memberFilter = useCallback((m: TeamMember) => {
    if (roleFilter !== 'all' && m.role !== roleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [m.full_name, m.phone, m.job_title].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }, [roleFilter, search]);

  type MemberSortKey = 'name' | 'joined' | 'role';
  const memberSortBy = useCallback((m: TeamMember, key: MemberSortKey) => {
    switch (key) {
      case 'name':   return m.full_name || '';
      case 'joined': return m.invitation_accepted_at ? new Date(m.invitation_accepted_at) : (m.created_at ? new Date(m.created_at) : null);
      case 'role':   return m.role || '';
    }
  }, []);

  const { visible: visibleMembers, sortKey, sortDir, setSortKey, flipSortDir } =
    useTableState<TeamMember, MemberSortKey>({
      rows: members,
      initialSortKey: 'joined',
      initialSortDir: 'desc',
      filter: memberFilter,
      sortBy: memberSortBy,
    });

  const active  = visibleMembers.filter((m) => !m.pending);
  const pending = visibleMembers.filter((m) => m.pending);

  const hasActiveFilter = roleFilter !== 'all' || search.trim() !== '';
  function clearFilters() { setRoleFilter('all'); setSearch(''); }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">צוות התאגיד</h2>
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
                <option value="admin">מנהל — גישה מלאה לעסקאות, עובדים וצוות</option>
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

      {members.length > 0 && (
        <TableToolbar
          pills={{
            options: [
              { key: 'all',    label: 'הכל',    count: members.length,                                tone: 'bg-slate-900 text-white' },
              { key: 'owner',  label: 'בעלים',  count: members.filter((m) => m.role === 'owner').length, tone: 'bg-navy-600 text-white' },
              { key: 'admin',  label: 'מנהלים', count: members.filter((m) => m.role === 'admin').length, tone: 'bg-blue-500 text-white' },
              { key: 'viewer', label: 'צופים',  count: members.filter((m) => m.role === 'viewer').length, tone: 'bg-slate-500 text-white' },
            ],
            active: roleFilter,
            onChange: setRoleFilter,
          }}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="חיפוש: שם / טלפון / תפקיד"
          sortOptions={[
            { key: 'joined', label: 'תאריך הצטרפות' },
            { key: 'name',   label: 'שם' },
            { key: 'role',   label: 'הרשאה' },
          ]}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortKeyChange={setSortKey}
          onSortDirToggle={flipSortDir}
          hasActiveFilter={hasActiveFilter}
          onClear={clearFilters}
        />
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
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="px-4 py-3 text-start font-medium">שם</th>
                  <th className="px-4 py-3 text-start font-medium">תפקיד</th>
                  <th className="px-4 py-3 text-start font-medium">טלפון</th>
                  <th className="px-4 py-3 text-start font-medium">הרשאה</th>
                  <th className="px-4 py-3 text-start font-medium">איש קשר לעסקאות</th>
                  <th className="px-4 py-3 text-start font-medium">הצטרף</th>
                  <th className="px-4 py-3 text-end font-medium w-12" aria-label="פעולות" />
                </tr>
              </thead>
              <tbody>
                {active.map((m) => (
                  <tr key={m.membership_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{m.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{m.job_title || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap" dir="ltr">{m.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ROLE_LABELS[m.role] ?? m.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {/* Toggle whether this member is exposed to the
                          contractor on approved deals as a contact
                          point. At least one row must stay checked —
                          enforced server-side, error surfaces via the
                          page-level `error` banner. */}
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!m.is_deal_contact}
                          onChange={(e) => handleToggleDealContact(m, e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          aria-label={`סמן את ${m.full_name ?? 'המשתמש'} כאיש קשר לעסקאות`}
                        />
                        <span className="text-xs text-slate-500">
                          {m.is_deal_contact ? 'מוצג לקבלן' : 'לא מוצג'}
                        </span>
                      </label>
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmt(m.invitation_accepted_at)}</td>
                    <td className="px-3 py-3 text-end whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setEditing(m)}
                          title="ערוך משתמש"
                          aria-label={`ערוך את ${m.full_name ?? 'המשתמש'}`}
                          className="inline-flex items-center justify-center h-7 w-7 rounded-full text-slate-400 hover:bg-brand-50 hover:text-brand-600 transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setPendingDelete(m)}
                          title="הסר משתמש"
                          aria-label={`הסר את ${m.full_name ?? 'המשתמש'}`}
                          className="inline-flex items-center justify-center h-7 w-7 rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notification recipients — per-user opt-in + channel choice.
          Lives below the active-members table because it's a power
          feature; the team list itself is the primary content. */}
      <NotificationRecipientsSection entityType="corporation" entityId={entityId} />

      {pending.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              {pending.length} הזמנות ממתינות
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="px-4 py-3 text-start font-medium">שם</th>
                  <th className="px-4 py-3 text-start font-medium">תפקיד</th>
                  <th className="px-4 py-3 text-start font-medium">טלפון</th>
                  <th className="px-4 py-3 text-start font-medium">הרשאה</th>
                  <th className="px-4 py-3 text-start font-medium">נשלח</th>
                  <th className="px-4 py-3 text-end font-medium w-12" aria-label="פעולות" />
                </tr>
              </thead>
              <tbody>
                {pending.map((m) => (
                  <tr key={m.membership_id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{m.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{m.job_title || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap" dir="ltr">{m.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ROLE_LABELS[m.role] ?? m.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmt(m.created_at)}</td>
                    <td className="px-3 py-3 text-end whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setEditing(m)}
                          title="ערוך הזמנה"
                          aria-label="ערוך הזמנה"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-full text-slate-400 hover:bg-brand-50 hover:text-brand-600 transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setPendingDelete(m)}
                          title="בטל הזמנה"
                          aria-label="בטל הזמנה"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit modal — shared by active + pending rows. */}
      {editing && entityId && (
        <EditMemberModal
          orgType="corporations"
          orgId={entityId}
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setMembers((prev) => prev.map((x) => x.membership_id === next.membership_id ? next : x));
            setEditing(null);
            setSuccess('פרטי חבר הצוות עודכנו');
            setTimeout(() => setSuccess(''), 4000);
          }}
        />
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
                    : 'המשתמש לא יוכל להיכנס לתאגיד ולא יקבל יותר התראות. הפעולה ניתנת לשחזור על ידי הזמנה מחדש.'}
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
