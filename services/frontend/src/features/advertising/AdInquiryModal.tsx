'use client';

// Pivot/v2 — sponsor-inquiry modal.
// Opens from the AdCarousel CTA and any "advertise here" slot.
// POSTs to /api/support-tickets so the message lands in
// /admin/support alongside customer-service tickets. Admin can then
// call the lead back or reply from there.

import { useState } from 'react';
import { X, Loader2, CheckCircle2, Send } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';

export function AdInquiryModal({
  open,
  onClose,
  subject = 'ad-inquiry',
  heading = 'צור קשר לפרסום',
  tagline = 'השאירו פרטים ונחזור אליכם עם הצעת מחיר תוך יום עסקים.',
}: {
  open: boolean;
  onClose: () => void;
  subject?: string;
  heading?: string;
  tagline?: string;
}) {
  const [name, setName]       = useState('');
  const [phone, setPhone]     = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [sent, setSent]       = useState(false);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (name.trim().length < 2)  { setError('יש להזין שם'); return; }
    if (phone.trim().length < 9) { setError('מספר טלפון לא תקין'); return; }
    setBusy(true);
    setError('');
    try {
      await apiFetch('/support-tickets', {
        method: 'POST',
        body: JSON.stringify({
          subject: `[${subject}] ${name.trim()}`,
          body:    `טלפון: ${phone.trim()}\n\n${message.trim() || '(ללא הודעה)'}`,
          contact_name:  name.trim(),
          contact_phone: phone.trim(),
        }),
      });
      setSent(true);
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בשליחה');
    } finally { setBusy(false); }
  }

  function close() {
    if (busy) return;
    setName(''); setPhone(''); setMessage('');
    setSent(false); setError('');
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={close}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6 space-y-4 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="סגור"
          className="absolute top-3 end-3 w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 inline-flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>

        {sent ? (
          <div className="text-center py-6 space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <h3 className="text-lg font-bold text-slate-900">תודה, קיבלנו!</h3>
            <p className="text-sm text-slate-600">נחזור אליך בהקדם עם הצעת מחיר.</p>
            <button
              type="button"
              onClick={close}
              className="mt-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-5 py-2 rounded-lg"
            >
              סגור
            </button>
          </div>
        ) : (
          <>
            <div>
              <h3 className="text-lg font-bold text-slate-900">{heading}</h3>
              <p className="text-sm text-slate-500 mt-1">{tagline}</p>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">שם מלא</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">טלפון</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="050-0000000"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">הודעה (אופציונלי)</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder="ספרו לנו על מה שאתם רוצים לפרסם"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>

              {error && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-lg disabled:bg-slate-300 inline-flex items-center justify-center gap-2"
              >
                {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> שולח…</> : <><Send className="w-4 h-4" /> שלח</>}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
