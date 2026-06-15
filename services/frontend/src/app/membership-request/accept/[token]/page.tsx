'use client';

/**
 * Owner-approval page for the inverted-invite flow.
 *
 * A new user tried to register a corp/contractor whose ח.פ is already
 * on file. The backend created a membership_requests row and SMS'd
 * the existing owner this link. The owner lands here, sees the
 * requester's name + phone + the entity they're asking to join, and
 * clicks Approve / Reject.
 *
 * GET is public (the page must render before the owner has logged in
 * — they may have followed the SMS link in a fresh browser). Approve
 * + Reject require auth, so we route to /login?next=... when the
 * owner hits one of those buttons without a token.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, CheckCircle2, XCircle, AlertCircle, UserPlus, Phone,
  Building2, HardHat, ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface RequestRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  entity_type: 'contractor' | 'corporation';
  entity_id: string;
  entity_name: string | null;
  requester_name: string;
  requester_phone: string;
  requested_role: 'owner' | 'admin' | 'viewer';
  created_at: string;
  expires_at: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner:  'בעלים',
  admin:  'מנהל',
  viewer: 'צופה',
};

const STATUS_COPY: Record<string, { title: string; desc: string; tone: string; icon: typeof CheckCircle2 }> = {
  approved: {
    title: 'הבקשה אושרה',
    desc:  'המשתמש הוסף לצוות. נשלחה הודעת SMS עם פרטי כניסה.',
    tone:  'emerald',
    icon:  CheckCircle2,
  },
  rejected: {
    title: 'הבקשה נדחתה',
    desc:  'נשלחה הודעת SMS למבקש.',
    tone:  'rose',
    icon:  XCircle,
  },
  expired: {
    title: 'הבקשה פגה תוקף',
    desc:  'הקישור כבר אינו תקף. אם המשתמש עדיין מעוניין להצטרף, עליו להירשם מחדש או לפנות אליך ישירות.',
    tone:  'slate',
    icon:  AlertCircle,
  },
};

export default function MembershipRequestAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [req, setReq]         = useState<RequestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [busy, setBusy]       = useState<'approve' | 'reject' | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // We capture the outcome state locally so the screen flips between
  // 'pending → approved/rejected' immediately, without a refetch race.
  const [outcome, setOutcome] = useState<'approved' | 'rejected' | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch<RequestRow>(`/membership-requests/${token}`)
      .then(setReq)
      .catch((e) => setError(e instanceof Error ? e.message : 'request_not_found'))
      .finally(() => setLoading(false));
  }, [token]);

  async function approve() {
    if (!getAccessToken()) {
      // Take them through login + bounce back here.
      router.push(`/login?next=${encodeURIComponent(`/membership-request/accept/${token}`)}`);
      return;
    }
    setBusy('approve'); setError('');
    try {
      await apiFetch(`/membership-requests/${token}/approve`, { method: 'POST', body: JSON.stringify({}) });
      setOutcome('approved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (!getAccessToken()) {
      router.push(`/login?next=${encodeURIComponent(`/membership-request/accept/${token}`)}`);
      return;
    }
    setBusy('reject'); setError('');
    try {
      await apiFetch(`/membership-requests/${token}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      });
      setOutcome('rejected');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      setBusy(null);
      setShowReject(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (error || !req) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-3">
            <AlertCircle className="h-12 w-12 text-rose-500" />
            <h2 className="text-lg font-bold text-slate-900">הבקשה לא נמצאה</h2>
            <p className="text-sm text-slate-600">
              ייתכן שהקישור שגוי או שהבקשה כבר טופלה. {error && <span className="block mt-1 text-xs">{error}</span>}
            </p>
            <Link href="/" className="text-brand-600 font-medium hover:underline text-sm">חזרה לדף הבית</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Outcome screens ─────────────────────────────────────────────────
  const finalStatus = outcome ?? (req.status !== 'pending' ? req.status : null);
  if (finalStatus) {
    const c = STATUS_COPY[finalStatus] || STATUS_COPY.expired;
    const Icon = c.icon;
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <Card className={`w-full max-w-md shadow-md text-center border-2 border-${c.tone}-300`}>
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-3">
            <Icon className={`h-16 w-16 text-${c.tone}-500`} />
            <h2 className="text-xl font-bold text-slate-900">{c.title}</h2>
            <p className="text-sm text-slate-700 leading-relaxed">{c.desc}</p>
            <div className="pt-2 flex gap-2 justify-center">
              <Link href="/" className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50">
                חזרה לדף הבית
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Pending — show the approve/reject UI ────────────────────────────
  const EntityIcon = req.entity_type === 'corporation' ? Building2 : HardHat;
  const entityKindHe = req.entity_type === 'corporation' ? 'תאגיד' : 'קבלן';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8">
      <Card className="w-full max-w-md shadow-md">
        <CardContent className="pt-6 pb-6 space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
            <div className="h-12 w-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
              <UserPlus className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">בקשה להצטרפות לצוות</h1>
              <p className="text-xs text-slate-500">דרך TagidAI · בקשה ל{entityKindHe} שלך</p>
            </div>
          </div>

          {/* Entity card */}
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 text-sm">
            <EntityIcon className="h-4 w-4 text-slate-400 shrink-0" />
            <span className="text-slate-500">ה{entityKindHe}:</span>
            <span className="font-semibold text-slate-900 truncate">{req.entity_name || '—'}</span>
          </div>

          {/* Requester details */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-800">המבקש להצטרף:</p>
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <UserPlus className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="text-xs text-slate-500">שם</span>
                <span className="font-medium text-slate-900 text-sm ms-auto">{req.requester_name}</span>
              </div>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="text-xs text-slate-500">טלפון</span>
                <a href={`tel:${req.requester_phone}`} className="font-mono font-semibold text-brand-700 text-sm ms-auto" dir="ltr">
                  {req.requester_phone}
                </a>
              </div>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <ShieldCheck className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="text-xs text-slate-500">תפקיד מבוקש</span>
                <span className="font-medium text-slate-900 text-sm ms-auto">
                  {ROLE_LABEL[req.requested_role] || req.requested_role}
                </span>
              </div>
            </div>
          </div>

          {/* Reject form (collapsed by default) */}
          {showReject && (
            <div className="space-y-2 p-3 bg-rose-50 border border-rose-200 rounded-lg">
              <p className="text-xs font-semibold text-rose-900">דחיית הבקשה</p>
              <Input
                placeholder="סיבת הדחייה (אופציונלי)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <div className="flex gap-2 pt-1">
                <Button onClick={() => setShowReject(false)} variant="outline" size="sm" disabled={busy === 'reject'} className="flex-1">
                  ביטול
                </Button>
                <Button onClick={reject} disabled={busy === 'reject'} size="sm" className="flex-1 bg-rose-600 hover:bg-rose-700">
                  {busy === 'reject' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                  דחה
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
          )}

          {/* Action buttons */}
          {!showReject && (
            <div className="flex gap-2 pt-1">
              <Button onClick={() => setShowReject(true)} variant="outline" disabled={busy !== null} className="flex-1">
                <XCircle className="h-4 w-4" />
                דחה
              </Button>
              <Button onClick={approve} disabled={busy !== null} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                אשר הצטרפות
              </Button>
            </div>
          )}

          {/* Auth hint when no token */}
          {!getAccessToken() && (
            <p className="text-xs text-slate-500 text-center pt-1">
              לאישור או דחיית הבקשה, התחבר תחילה לחשבון שלך.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
