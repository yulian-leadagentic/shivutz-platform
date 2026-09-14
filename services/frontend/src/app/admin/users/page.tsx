'use client';

import { Fragment, useCallback, useEffect, useState, FormEvent } from 'react';
import { Loader2, UserPlus, ShieldCheck, ShieldAlert, ChevronDown, ChevronLeft } from 'lucide-react';
import { adminApi, type AdminUser } from '@/lib/adminApi';
import { mapApiError } from '@/lib/api/errors';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TableToolbar, type PillOption } from '@/components/table/TableToolbar';
import { useTableState } from '@/components/table/useTableState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/admin/EmptyState';
import { Users, Download } from 'lucide-react';
import { exportCsv } from '@/lib/csv';
import { useTableKeyNav } from '@/hooks/useTableKeyNav';

const ROLE_LABEL: Record<string, string> = {
  admin:            'מנהל',
  contractor:       'קבלן',
  corporation:      'תאגיד',
  service_provider: 'ספק שירות',
};

// U11 §3 · row-detail state. Kept out of AdminUser to avoid recomputing
// the base list when detail rows come in.
type UserDetails = Awaited<ReturnType<typeof adminApi.getUserDetails>>;
type DetailState = { loading: true } | { loading: false; data: UserDetails } | { loading: false; error: string };

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('he-IL');
}

export default function AdminUsersPage() {
  useTableKeyNav();
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
  // Confirm dialog for "השבת" — disabling a user can kick them out of
  // a live session mid-deal. Need to surface that consequence before
  // an accidental click.
  const [pendingDisable, setPendingDisable] = useState<AdminUser | null>(null);
  const [toggling, setToggling] = useState(false);
  // U11 §3 · lazy-loaded row detail. `expandedId` is what's open now,
  // `details` caches every row we've fetched so re-opening is instant.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  async function toggleExpand(userId: string) {
    const willOpen = expandedId !== userId;
    setExpandedId(willOpen ? userId : null);
    // Fetch only on first open; cached responses stay put so a close
    // → reopen is instant. If a fetch previously errored, retry on
    // next click by leaving that entry as-is (user re-triggers a
    // fetch by closing + opening).
    if (!willOpen) return;
    if (details[userId]) return;
    setDetails((m) => ({ ...m, [userId]: { loading: true } }));
    try {
      const data = await adminApi.getUserDetails(userId);
      setDetails((m) => ({ ...m, [userId]: { loading: false, data } }));
    } catch (e) {
      setDetails((m) => ({ ...m, [userId]: { loading: false, error: mapApiError(e) } }));
    }
  }

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
      pushToast('✓ מנהל חדש נוסף, נשלחה הודעת SMS / WhatsApp');
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
    // Re-activations don't need confirmation; only the destructive
    // path needs a dialog.
    if (u.is_active) { setPendingDisable(u); return; }
    try {
      await adminApi.enableUser(u.id);
      pushToast('✓ המשתמש הופעל');
      setUsers((arr) => arr.map((x) => (x.id === u.id ? { ...x, is_active: true } : x)));
    } catch (e) {
      pushToast(`✗ ${e instanceof Error ? e.message : 'שגיאה'}`);
    }
  }
  async function confirmDisable() {
    if (!pendingDisable) return;
    setToggling(true);
    try {
      await adminApi.disableUser(pendingDisable.id);
      pushToast('✓ המשתמש הושבת');
      setUsers((arr) => arr.map((x) => (x.id === pendingDisable.id ? { ...x, is_active: false } : x)));
      setPendingDisable(null);
    } catch (e) {
      pushToast(`✗ ${e instanceof Error ? e.message : 'שגיאה'}`);
    } finally {
      setToggling(false);
    }
  }

  const filterPredicate = useCallback((u: AdminUser) => {
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [u.full_name, u.phone, u.email, u.org_name].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }, [filterRole, search]);

  type UserSortKey = 'name' | 'last_login' | 'role' | 'org';
  const sortBy = useCallback((u: AdminUser, key: UserSortKey) => {
    switch (key) {
      case 'name':       return u.full_name || '';
      case 'last_login': return u.last_login_at ? new Date(u.last_login_at) : null;
      case 'role':       return u.role || '';
      case 'org':        return u.org_name || '';
    }
  }, []);

  const { visible: filtered, sortKey, sortDir, setSortKey, flipSortDir } =
    useTableState<AdminUser, UserSortKey>({
      rows: users,
      initialSortKey: 'last_login',
      initialSortDir: 'desc',
      filter: filterPredicate,
      sortBy,
    });

  const hasActiveFilter = filterRole !== 'all' || search.trim() !== '';
  function clearFilters() { setFilterRole('all'); setSearch(''); }

  const roleCounts = {
    admin:       users.filter((u) => u.role === 'admin').length,
    contractor:  users.filter((u) => u.role === 'contractor').length,
    corporation: users.filter((u) => u.role === 'corporation').length,
  };
  const ROLE_PILLS: PillOption<typeof filterRole>[] = [
    { key: 'all',         label: 'הכל',     count: users.length,         tone: 'bg-slate-900 text-white' },
    { key: 'admin',       label: 'מנהלים',  count: roleCounts.admin,     tone: 'bg-brand-600 text-slate-900' },
    { key: 'contractor',  label: 'קבלנים',  count: roleCounts.contractor, tone: 'bg-amber-500 text-white' },
    { key: 'corporation', label: 'תאגידים', count: roleCounts.corporation, tone: 'bg-navy-600 text-white' },
  ];

  const adminCount = users.filter((u) => u.role === 'admin' && u.is_active).length;

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">משתמשים</h1>
          <p className="text-sm text-slate-500 mt-1">כל המשתמשים הרשומים במערכת — קבלנים, תאגידים, מנהלים.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const today = new Date().toISOString().slice(0, 10);
              exportCsv(
                `users-${today}`,
                ['שם מלא', 'טלפון', 'דוא״ל', 'תפקיד', 'ארגון', 'פעיל', 'התחבר לאחרונה'],
                users.map((u) => [
                  u.full_name || '',
                  u.phone || '',
                  u.email || '',
                  u.role,
                  u.org_name || '',
                  u.is_active ? 'כן' : 'לא',
                  u.last_login_at || '',
                ]),
              );
            }}
            disabled={users.length === 0}
          >
            <Download className="h-4 w-4" /> ייצוא ל-CSV
          </Button>
          <Button onClick={() => setAdding(true)} className="shrink-0">
            <UserPlus className="h-4 w-4" /> הוסף מנהל
          </Button>
        </div>
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
              ייווצר משתמש עם הרשאת מנהל. הודעת SMS / WhatsApp עם קישור לכניסה תישלח אוטומטית.
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

      <TableToolbar
        pills={{ options: ROLE_PILLS, active: filterRole, onChange: setFilterRole }}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="חיפוש: שם / טלפון / אימייל / שם ארגון"
        sortOptions={[
          { key: 'last_login', label: 'כניסה אחרונה' },
          { key: 'name',       label: 'שם' },
          { key: 'role',       label: 'תפקיד' },
          { key: 'org',        label: 'ארגון' },
        ]}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortKeyChange={setSortKey}
        onSortDirToggle={flipSortDir}
        hasActiveFilter={hasActiveFilter}
        onClear={clearFilters}
      />

      {/* Users table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : error ? (
            <p className="p-4 text-sm text-red-600">{error}</p>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title="לא נמצאו משתמשים"
              description="אין משתמשים שתואמים את הסינון או החיפוש הנוכחי."
            />
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
                  {filtered.map((u) => {
                    const isExpanded = expandedId === u.id;
                    const detail = details[u.id];
                    return (
                      <Fragment key={u.id}>
                        <tr
                          data-table-row="true"
                          tabIndex={-1}
                          onClick={() => toggleExpand(u.id)}
                          className="border-b border-slate-50 last:border-0 hover:bg-slate-50 focus:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-inset cursor-pointer"
                        >
                          <td className="px-3 py-2.5 text-slate-800 font-medium">
                            <span className="inline-flex items-center gap-1.5">
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronLeft className="h-3.5 w-3.5 text-slate-400" />}
                              {u.full_name || '—'}
                            </span>
                          </td>
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
                            <Button size="sm" variant="outline" data-table-row-action
                              onClick={(e) => { e.stopPropagation(); toggle(u); }}>
                              {u.is_active ? 'השבת' : 'הפעל'}
                            </Button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <td colSpan={8} className="px-4 py-3">
                              <UserDetailBlock state={detail} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Toasts */}
      <div className="fixed top-4 start-4 end-4 sm:end-auto sm:top-auto sm:bottom-6 sm:start-6 space-y-2 z-50">
        {toasts.map((msg, i) => (
          <div key={i} className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${msg.startsWith('✓') ? 'bg-green-600' : 'bg-red-600'}`}>
            {msg}
          </div>
        ))}
      </div>

      {/* ConfirmDialog immediately below */}
      <ConfirmDialog
        open={!!pendingDisable}
        title="השבתת משתמש"
        message={pendingDisable
          ? `להשבית את ${pendingDisable.full_name || pendingDisable.phone}? המשתמש לא יוכל להתחבר; אם הוא מחובר כרגע — הסשן ינותק בבקשת ה-API הבאה. ניתן להפעיל מחדש בכל עת.`
          : ''}
        confirmLabel="השבת"
        variant="destructive"
        busy={toggling}
        onConfirm={confirmDisable}
        onCancel={() => setPendingDisable(null)}
      />
    </div>
  );
}

// U11 §3 · row-detail renderer. Three parallel cards (Entity, Owner,
// Subscription) — each independently null-safe:
//   - entity=null    → "המשתמש לא משויך לישות" (usually an admin)
//   - owner=null     → "בעל חשבון לא נמצא" (data anomaly worth flagging)
//   - subscription=null → "אין מנוי פעיל" (not an error; U5 §3 rule)
function UserDetailBlock({ state }: { state: DetailState | undefined }) {
  if (!state || state.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> טוען פרטים…
      </div>
    );
  }
  if ('error' in state) {
    return (
      <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
        {state.error}
      </div>
    );
  }
  const { entity, owner, subscription } = state.data;
  const ENTITY_TYPE_HE: Record<string, string> = {
    contractor:       'קבלן',
    corporation:      'תאגיד',
    service_provider: 'ספק שירות',
  };
  const STATUS_HE: Record<string, string> = {
    approved: 'מאושר', pending: 'ממתין לאישור', rejected: 'נדחה',
    suspended: 'מושהה', active: 'פעיל',
  };
  const TIER_HE: Record<string, string> = {
    basic: 'Basic', advanced: 'Advanced', pro: 'Pro',
  };
  const SUB_STATUS_HE: Record<string, string> = {
    trialing: 'ניסיון', active: 'פעיל', past_due: 'חוב', cancelled: 'בוטל', expired: 'פג תוקף',
  };
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('he-IL') : '—';
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
      {/* Entity */}
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">הישות</div>
        {entity ? (
          <>
            <div className="font-semibold text-slate-800">{entity.name || '—'}</div>
            <dl className="mt-1.5 space-y-0.5 text-xs">
              <div className="flex justify-between"><dt className="text-slate-500">סוג</dt><dd>{ENTITY_TYPE_HE[entity.type] || entity.type}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">ח.פ / ע.מ</dt><dd dir="ltr">{entity.business_number || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">סטטוס</dt><dd>{entity.approval_status ? (STATUS_HE[entity.approval_status] || entity.approval_status) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">הצטרפות</dt><dd>{fmt(entity.joined_at)}</dd></div>
              <div className="flex justify-between">
                <dt className="text-slate-500">משתמשים</dt>
                <dd>{entity.seats_included != null ? `${entity.seats_used} מתוך ${entity.seats_included}` : `${entity.seats_used}`}</dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="text-slate-400 text-xs">המשתמש אינו משויך לישות (בדרך כלל: משתמש מנהל).</div>
        )}
      </div>
      {/* Owner */}
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">בעל החשבון · ליצירת קשר</div>
        {owner ? (
          <>
            <div className="font-semibold text-slate-800">{owner.full_name || '—'}</div>
            <dl className="mt-1.5 space-y-0.5 text-xs">
              <div className="flex justify-between items-baseline">
                <dt className="text-slate-500">טלפון</dt>
                <dd>{owner.phone ? <a className="text-brand-700 hover:underline" dir="ltr" href={`tel:${owner.phone}`}>{owner.phone}</a> : '—'}</dd>
              </div>
              <div className="flex justify-between items-baseline">
                <dt className="text-slate-500">אימייל</dt>
                <dd>{owner.email ? <a className="text-brand-700 hover:underline" dir="ltr" href={`mailto:${owner.email}`}>{owner.email}</a> : '—'}</dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="text-slate-400 text-xs">לא נמצא בעל חשבון פעיל.</div>
        )}
      </div>
      {/* Subscription */}
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">המנוי</div>
        {subscription ? (
          <>
            <div className="font-semibold text-slate-800">{TIER_HE[subscription.tier] || subscription.tier}</div>
            <dl className="mt-1.5 space-y-0.5 text-xs">
              <div className="flex justify-between"><dt className="text-slate-500">סטטוס</dt><dd>{SUB_STATUS_HE[subscription.status] || subscription.status}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">ניסיון עד</dt><dd>{fmt(subscription.trial_ends_at)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">חיוב הבא</dt><dd>{fmt(subscription.current_period_end)}</dd></div>
            </dl>
          </>
        ) : (
          <div className="text-slate-400 text-xs">אין מנוי פעיל.</div>
        )}
      </div>
    </div>
  );
}
