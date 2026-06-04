'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { orgApi } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Backfill page — existing contractors who registered before the
 * kablan-match flow was added (or whose first attempt mismatched) can
 * type their license number here.
 *
 * Match → bumped to tier_2 immediately, redirect to dashboard with
 *         success state.
 * No match → row stays pending; we tell the user we'll review.
 * Registry unreachable → offer "try again later" — the user isn't
 *         blocked, but we can't auto-promote.
 */
export default function VerifyKablanPage() {
  const router = useRouter();
  const { entityId, entityType } = useAuth();

  const [kablan, setKablan]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState<null | { matched: true } | { matched: false; reason?: string }>(null);

  // Guard — page is contractor-only. A corp user landing here means
  // someone deep-linked to a path that doesn't apply to their role.
  if (entityType !== 'contractor') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md shadow-md text-center">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-3">
            <AlertCircle className="h-12 w-12 text-amber-500" />
            <h2 className="text-lg font-bold text-slate-900">דף זה זמין לקבלנים בלבד</h2>
            <Button onClick={() => router.push('/')} variant="outline">חזרה לדף הבית</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!entityId) return;
    if (!kablan.trim()) { setError('יש להזין מספר רישיון קבלן'); return; }
    setLoading(true); setError('');
    try {
      const res = await orgApi.verifyKablan(entityId, kablan.trim());
      if (res.matched) {
        setDone({ matched: true });
        // Give the success screen a beat, then route to dashboard.
        setTimeout(() => router.push('/contractor/dashboard'), 1800);
      } else {
        setDone({ matched: false, reason: res.reason });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה באימות. נסה שוב.');
    } finally {
      setLoading(false);
    }
  }

  // ── Success screens ─────────────────────────────────────────────────
  if (done?.matched === true) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md shadow-md text-center">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-3">
            <CheckCircle2 className="h-14 w-14 text-emerald-500" />
            <h2 className="text-xl font-bold text-slate-900">אומת מול פנקס הקבלנים</h2>
            <p className="text-slate-600 text-sm">החשבון שלך פעיל במלואו — מעביר אותך לדשבורד...</p>
            <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done?.matched === false) {
    const isUnreachable = done.reason === 'registry_unreachable';
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md shadow-md text-center">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-3">
            <AlertCircle className="h-14 w-14 text-amber-500" />
            <h2 className="text-xl font-bold text-slate-900">
              {isUnreachable ? 'אין כרגע גישה לפנקס הקבלנים' : 'המספר לא תואם'}
            </h2>
            <p className="text-slate-700 text-sm leading-relaxed">
              {isUnreachable
                ? 'שירות פנקס הקבלנים אינו זמין כרגע. ננסה לאמת אוטומטית מאוחר יותר, או שתוכל לנסות שוב בעוד מספר דקות.'
                : 'הפרטים שהזנת התקבלו. מנהל יבדוק את הבקשה — בדרך כלל תוך 48 שעות. נשלח אליך SMS לאחר האישור.'}
            </p>
            <div className="flex gap-2 pt-2">
              {isUnreachable ? (
                <Button onClick={() => { setDone(null); }} variant="default">נסה שוב</Button>
              ) : (
                <Button onClick={() => router.push('/contractor/dashboard')} variant="default">
                  חזרה לדשבורד
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8">
      <Card className="w-full max-w-md shadow-md">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-3">
            <div className="h-12 w-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
              <ShieldCheck className="h-6 w-6" />
            </div>
          </div>
          <CardTitle className="text-xl">אימות מספר רישיון קבלן</CardTitle>
          <CardDescription className="mt-1">
            הזן את מספר הרישיון שלך מפנקס הקבלנים — אנו נצליב אותו מול הרישום הרשמי.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input
              label="מספר רישיון קבלן"
              placeholder="לדוגמה: 3842"
              value={kablan}
              onChange={(e) => setKablan(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              dir="ltr"
              autoFocus
            />
            <p className="text-xs text-slate-500 leading-snug">
              ניתן למצוא את המספר בתעודת הקבלן הרשמית או באתר רשם הקבלנים של משרד הבינוי והשיכון.
            </p>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
            )}
            <Button type="submit" disabled={loading} className="w-full mt-1">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> מאמת...</> : 'אמת'}
            </Button>
            <button
              type="button"
              onClick={() => router.push('/contractor/dashboard')}
              className="text-sm text-slate-500 hover:underline text-center pt-1"
            >
              ← חזרה לדשבורד
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
