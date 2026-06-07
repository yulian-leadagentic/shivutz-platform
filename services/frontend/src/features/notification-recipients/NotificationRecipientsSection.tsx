'use client';

// Manage which team members receive system notifications, and on which
// channels. Used by both /corporation/users and /contractor/users —
// same shape on both sides since the backend stores everything keyed
// by (entity_type, entity_id, user_id).
//
// Rules surfaced in the UI:
//   - Cap: 5 active recipients per entity (server-enforced; the UI
//     pre-blocks the 6th with a clear message).
//   - Default channel set when toggling someone ON for the first time:
//     SMS + WhatsApp. Email is opt-in.
//   - WhatsApp checkbox is shown but tagged "בקרוב" — the channel
//     persists at the DB level so when Vonage WA goes live, opt-ins
//     are already there.
//   - Anyone with admin/owner role can flag others; any user can
//     self opt-out (server gates that).

import { useEffect, useMemo, useState } from 'react';
import { Bell, BellOff, Loader2, CheckCircle2, AlertCircle, MessageCircle, Mail, Send } from 'lucide-react';
import {
  notificationRecipientsApi,
  type RecipientRow,
  type NotificationChannel,
} from '@/lib/api';

const MAX_RECIPIENTS = 5;
const DEFAULT_CHANNELS: NotificationChannel[] = ['sms', 'whatsapp'];

interface Props {
  entityType: 'corporation' | 'contractor';
  entityId:   string | null;
  /** Optional callback so the parent page can react to membership / recipient changes. */
  onChange?: (rows: RecipientRow[]) => void;
}

export function NotificationRecipientsSection({ entityType, entityId, onChange }: Props) {
  const [rows, setRows]         = useState<RecipientRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [savingUid, setSaving]  = useState<string | null>(null);
  const [error, setError]       = useState('');

  // Load.
  useEffect(() => {
    if (!entityId) return;
    setLoading(true); setError('');
    notificationRecipientsApi.list(entityType, entityId)
      .then((data) => { setRows(data); onChange?.(data); })
      .catch((e) => setError(e instanceof Error ? e.message : 'שגיאה'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  const activeCount = useMemo(() => rows.filter((r) => r.is_recipient).length, [rows]);
  const atCap       = activeCount >= MAX_RECIPIENTS;

  async function persist(row: RecipientRow, next: { is_recipient: boolean; channels: NotificationChannel[] }) {
    if (!entityId) return;
    setSaving(row.user_id); setError('');
    try {
      const res = await notificationRecipientsApi.upsert(entityType, entityId, row.user_id, {
        is_active: next.is_recipient,
        channels:  next.channels,
      });
      const merged = rows.map((r) => r.user_id === row.user_id
        ? { ...r, is_recipient: res.is_active, channels: res.channels }
        : r);
      setRows(merged);
      onChange?.(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בעדכון');
    } finally {
      setSaving(null);
    }
  }

  function toggleRecipient(row: RecipientRow) {
    if (!row.is_recipient && atCap) {
      setError(`ניתן לסמן עד ${MAX_RECIPIENTS} משתמשים כמקבלי התראות. בטל סימון של חבר צוות אחר לפני הוספה.`);
      return;
    }
    const willActivate = !row.is_recipient;
    const channels = willActivate
      ? (row.channels.length > 0 ? row.channels : DEFAULT_CHANNELS)
      : row.channels; // keep saved channels when deactivating
    persist(row, { is_recipient: willActivate, channels });
  }

  function toggleChannel(row: RecipientRow, ch: NotificationChannel) {
    if (!row.is_recipient) return; // toggle is the entry point
    const has = row.channels.includes(ch);
    const next = has ? row.channels.filter((c) => c !== ch) : [...row.channels, ch];
    // Don't allow zero channels on an active recipient — the toggle is
    // the right control for that.
    if (next.length === 0) {
      setError('עליך לבחור לפחות ערוץ אחד למשתמש פעיל. בטל סימון של המקבל אם אין צורך בהתראות.');
      return;
    }
    persist(row, { is_recipient: true, channels: next });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Counter chip */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-base font-bold text-slate-900 inline-flex items-center gap-2">
          <Bell className="h-4 w-4 text-brand-600" />
          מקבלי התראות
        </h3>
        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${
          atCap ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
        }`}>
          {activeCount}/{MAX_RECIPIENTS} משתמשים מסומנים
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <p className="flex-1">{error}</p>
          <button onClick={() => setError('')} className="text-rose-500 hover:text-rose-700 text-xs font-bold">×</button>
        </div>
      )}

      {/* Per-member rows */}
      {rows.length === 0 ? (
        <p className="text-center text-slate-400 py-4 text-sm">אין חברי צוות פעילים</p>
      ) : (
        <ul className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
          {rows.map((r) => {
            const busy = savingUid === r.user_id;
            return (
              <li key={r.user_id} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">
                    {r.full_name || r.email || r.phone || r.user_id}
                  </p>
                  <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                    {r.phone && <span dir="ltr">{r.phone}</span>}
                    {r.email && <span dir="ltr">{r.email}</span>}
                  </div>
                </div>

                {/* Channel checkboxes — visible only when the toggle is on. */}
                {r.is_recipient && (
                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    <ChannelBox
                      icon={<Mail className="h-3.5 w-3.5" />} label="דוא״ל"
                      checked={r.channels.includes('email')}
                      disabled={busy || !r.email}
                      onChange={() => toggleChannel(r, 'email')}
                      hint={!r.email ? 'אין כתובת מייל למשתמש' : undefined}
                    />
                    <ChannelBox
                      icon={<Send className="h-3.5 w-3.5" />} label="SMS"
                      checked={r.channels.includes('sms')}
                      disabled={busy || !r.phone}
                      onChange={() => toggleChannel(r, 'sms')}
                      hint={!r.phone ? 'אין טלפון למשתמש' : undefined}
                    />
                    <ChannelBox
                      icon={<MessageCircle className="h-3.5 w-3.5" />} label="WhatsApp"
                      badge="בקרוב"
                      checked={r.channels.includes('whatsapp')}
                      disabled={busy || !r.phone}
                      onChange={() => toggleChannel(r, 'whatsapp')}
                      hint={!r.phone ? 'אין טלפון למשתמש' : undefined}
                    />
                  </div>
                )}

                {/* Toggle — recipient on/off. */}
                <button
                  type="button"
                  onClick={() => toggleRecipient(r)}
                  disabled={busy}
                  aria-pressed={r.is_recipient}
                  className={`shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-colors border ${
                    r.is_recipient
                      ? 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700'
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                  } disabled:opacity-50`}
                  title={r.is_recipient ? 'בטל קבלת התראות' : 'סמן כמקבל התראות'}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                    r.is_recipient ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                  {r.is_recipient ? 'מקבל' : 'אינו מקבל'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ChannelBox({
  icon, label, checked, disabled, onChange, badge, hint,
}: {
  icon: React.ReactNode; label: string;
  checked: boolean; disabled?: boolean;
  onChange: () => void;
  badge?: string; hint?: string;
}) {
  return (
    <label
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border ${
        checked ? 'border-brand-300 bg-brand-50/60 text-brand-800' : 'border-slate-200 bg-white text-slate-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-brand-400'}`}
      title={hint || ''}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="h-3.5 w-3.5 accent-brand-600"
      />
      {icon}
      <span className="font-semibold whitespace-nowrap">{label}</span>
      {badge && (
        <span className="text-[9px] uppercase tracking-wider font-bold bg-amber-100 text-amber-800 px-1 py-0.5 rounded">
          {badge}
        </span>
      )}
    </label>
  );
}

// Re-export the success indicator for parent use if needed.
export const RecipientsSavedIcon = CheckCircle2;
