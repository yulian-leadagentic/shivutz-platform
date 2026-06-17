'use client';

import { useState, FormEvent } from 'react';
import { Loader2, X, Pencil, Info } from 'lucide-react';
import { memberApi, type TeamMember } from '@/lib/api';
import { Input } from '@/components/ui/input';

const ROLE_OPTIONS_PENDING_OR_NEW: { value: string; label: string }[] = [
  { value: 'admin',  label: 'מנהל — גישה מלאה לבקשות, עסקאות וצוות' },
  { value: 'viewer', label: 'צופה — קריאה בלבד' },
];

// owner is shown for active rows because a demote-from-owner is a
// legitimate edit. Sole-owner protection is enforced server-side.
const ROLE_OPTIONS_ACTIVE: { value: string; label: string }[] = [
  { value: 'owner',  label: 'בעלים — שליטה מלאה כולל ניהול בעלים' },
  { value: 'admin',  label: 'מנהל — גישה מלאה לבקשות, עסקאות וצוות' },
  { value: 'viewer', label: 'צופה — קריאה בלבד' },
];

interface Props {
  orgType:  'contractors' | 'corporations';
  orgId:    string;
  member:   TeamMember;
  /** Called with the updated row after a successful save. */
  onSaved:  (next: TeamMember) => void;
  onClose:  () => void;
}

export function EditMemberModal({ orgType, orgId, member, onSaved, onClose }: Props) {
  const isPending = member.pending;

  // Field state — seeded from the row.
  const [firstName, setFirstName] = useState(member.invited_first_name ?? '');
  const [lastName,  setLastName]  = useState(member.invited_last_name  ?? '');
  const [phone,     setPhone]     = useState(member.phone ?? '');
  const [email,     setEmail]     = useState(member.email ?? '');
  const [jobTitle,  setJobTitle]  = useState(member.job_title ?? '');
  const [role,      setRole]      = useState(member.role);

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const phoneChanged = isPending && phone.trim() && phone.trim() !== (member.phone ?? '').trim();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError('');

    // Build a minimal patch — only send fields that actually changed.
    const patch: Parameters<typeof memberApi.update>[3] = {};
    if (role !== member.role) patch.role = role;
    if ((jobTitle || '').trim() !== (member.job_title ?? '')) {
      patch.job_title = jobTitle.trim() || null;
    }
    if (isPending) {
      if (firstName.trim() !== (member.invited_first_name ?? '')) {
        patch.invited_first_name = firstName.trim() || null;
      }
      if (lastName.trim() !== (member.invited_last_name ?? '')) {
        patch.invited_last_name = lastName.trim() || null;
      }
      if (phone.trim() !== (member.phone ?? '')) {
        if (!phone.trim()) { setError('יש להזין מספר טלפון'); return; }
        patch.invited_phone = phone.trim();
      }
    }
    if (email.trim() !== (member.email ?? '')) {
      const trimmed = email.trim();
      if (trimmed) {
        // Cheap client-side bounce before the network round-trip so
        // the user sees the error instantly. Server validates the same
        // shape + a TLD allowlist; this only catches the basic-format
        // case ("foo@bar", "@bar.com", spaces, etc.).
        const SHAPE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}$/;
        if (!SHAPE.test(trimmed)) {
          setError('כתובת מייל לא תקינה.');
          return;
        }
      }
      patch.email = trimmed;
    }

    if (Object.keys(patch).length === 0) { onClose(); return; }

    setSaving(true);
    try {
      const updated = await memberApi.update(orgType, orgId, member.membership_id, patch);
      onSaved(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('cannot_demote_sole_owner') || msg.includes('האחרון')) {
        setError('אי אפשר להוריד את הבעלים האחרון. הוסף בעלים נוסף קודם.');
      } else if (msg.includes('email_already_in_use') || msg.includes('כתובת המייל')) {
        setError('כתובת המייל הזו כבר רשומה אצל משתמש אחר.');
      } else if (msg.includes('invalid_email_tld') || msg.includes('סיומת המייל')) {
        setError('סיומת המייל לא נראית תקינה. בדוק את הכתובת.');
      } else if (msg.includes('invalid_email')) {
        setError('כתובת מייל לא תקינה.');
      } else {
        setError('שגיאה בשמירת השינויים. נסה שוב.');
      }
    } finally {
      setSaving(false);
    }
  }

  const roleOptions = isPending ? ROLE_OPTIONS_PENDING_OR_NEW : ROLE_OPTIONS_ACTIVE;
  const displayName = member.full_name
    || [member.invited_first_name, member.invited_last_name].filter(Boolean).join(' ')
    || member.phone
    || 'חבר צוות';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 pb-3 border-b border-slate-100">
          <div className="h-10 w-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
            <Pencil className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-slate-900 leading-tight">
              עריכת חבר צוות
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">{displayName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="סגור"
            className="h-8 w-8 inline-flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {isPending && (
            <>
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
            </>
          )}

          <Input
            label="כתובת מייל"
            type="email"
            dir="ltr"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
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
              {roleOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {phoneChanged && (
            <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>שינוי הטלפון ישלח הזמנה חדשה ב-SMS למספר החדש. הקישור הקיים ימשיך לעבוד.</span>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium text-sm disabled:opacity-50"
            >
              ביטול
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-sm disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              שמור שינויים
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
