'use client';

// "פניה לשירות לקוחות" — QA-R3 #24. Shared form reachable from the
// contractor + corp layouts. Submitting hits POST /api/support-tickets;
// admins handle the inbox at /admin/support.

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send, CheckCircle2, AlertCircle, ArrowRight, MessageCircle } from 'lucide-react';
import { supportApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function SupportPage() {
  const router = useRouter();
  const [subject, setSubject]   = useState('');
  const [body, setBody]         = useState('');
  const [phone, setPhone]       = useState('');
  const [submitting, setSubmit] = useState(false);
  const [error, setError]       = useState('');
  const [done, setDone]         = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (subject.trim().length < 2)  { setError('יש להזין נושא'); return; }
    if (body.trim().length    < 5)  { setError('יש להזין תיאור קצר של הפנייה'); return; }
    setSubmit(true); setError('');
    try {
      await supportApi.submit({
        subject: subject.trim(),
        body:    body.trim(),
        contact_phone: phone.trim() || undefined,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשליחת הפנייה');
    } finally { setSubmit(false); }
  }

  if (done) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 space-y-4 text-center">
        <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
        <h1 className="text-xl font-bold text-slate-900">הפנייה התקבלה</h1>
        <p className="text-sm text-slate-600">
          קיבלנו את הפנייה שלך ונחזור אליך בהקדם. אם הנושא דחוף, ניתן לפנות גם בטלפון לשעות הפעילות.
        </p>
        <div className="flex gap-3 justify-center">
          <Button onClick={() => router.back()}>חזרה</Button>
          <Button variant="outline" onClick={() => {
            setSubject(''); setBody(''); setPhone(''); setDone(false);
          }}>פנייה נוספת</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
      <button type="button" onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ArrowRight className="h-4 w-4" /> חזרה
      </button>

      <header className="flex items-center gap-2">
        <MessageCircle className="h-6 w-6 text-brand-600" />
        <h1 className="text-2xl font-bold text-slate-900">פנייה לשירות לקוחות</h1>
      </header>

      <p className="text-sm text-slate-600 leading-relaxed">
        נתקלת בבעיה, יש לך שאלה על תהליך, או רוצה להציע שיפור? כתוב לנו כאן ונחזור אליך בהקדם.
      </p>

      <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 space-y-4" noValidate>
        <Input
          label="נושא *"
          placeholder="למשל: שאלה על תהליך אישור הרישיון"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          autoFocus
        />

        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">תיאור הפנייה *</label>
          <textarea
            value={body} onChange={(e) => setBody(e.target.value)} rows={6}
            placeholder="פרט מה הבעיה או השאלה. ככל שתהיה יותר ספציפי, נוכל לעזור מהר יותר."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <Input
          label="טלפון לחזרה (אופציונלי)"
          placeholder="אם תרצה שנחזיר במספר אחר מהמספר הרשום אצלינו"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          type="tel"
          dir="ltr"
        />

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח…</>
              : <><Send className="h-4 w-4" /> שלח פנייה</>}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            ביטול
          </Button>
        </div>
      </form>
    </div>
  );
}
