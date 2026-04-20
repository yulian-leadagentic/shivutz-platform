'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Phone, User, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { leadsApi } from '@/lib/api';
import type { LeadFormData } from '@/types';

interface LeadCaptureModalProps {
  open: boolean;
  onClose: () => void;
}

export default function LeadCaptureModal({ open, onClose }: LeadCaptureModalProps) {
  const [form, setForm] = useState<LeadFormData>({
    full_name: '',
    phone: '',
    org_type: 'contractor',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    if (open) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  function handleClose() {
    if (submitting) return;
    onClose();
    setTimeout(() => { setSubmitted(false); setError(''); setForm({ full_name: '', phone: '', org_type: 'contractor', notes: '' }); }, 300);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim() || !form.phone.trim()) {
      setError('נא למלא שם ומספר טלפון');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await leadsApi.submit(form);
      setSubmitted(true);
    } catch {
      setError('אירעה שגיאה — אנא נסה שנית');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === overlayRef.current) handleClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-slide-up">
        {/* Header gradient */}
        <div className="bg-gradient-to-br from-brand-600 to-indigo-700 px-7 pt-7 pb-8">
          <button
            onClick={handleClose}
            className="absolute top-4 start-4 text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="סגור"
          >
            <X className="h-5 w-5" />
          </button>
          <h2 className="text-xl font-bold text-white mb-1">השאר פרטים — נחזור אליך</h2>
          <p className="text-brand-200 text-sm">
            נציג שלנו יצור איתך קשר לסיוע ברישום ובהתחלה
          </p>
        </div>

        {/* Body */}
        <div className="px-7 py-6">
          {submitted ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900 mb-1">תודה, {form.full_name}!</p>
                <p className="text-sm text-slate-500">
                  קיבלנו את פרטיך — נציג שלנו יצור איתך קשר בהקדם
                </p>
              </div>
              <Button onClick={handleClose} className="mt-2 w-full bg-brand-600 hover:bg-brand-700 text-white">
                סגור
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Org type toggle */}
              <div>
                <Label className="text-sm font-semibold text-slate-700 mb-2 block">סוג עסק</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(['contractor', 'corporation'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, org_type: t }))}
                      className={`py-2.5 px-4 rounded-xl text-sm font-semibold border-2 transition-all duration-150 ${
                        form.org_type === t
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {t === 'contractor' ? '🏗️ קבלן' : '🏢 תאגיד'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Full name */}
              <div>
                <Label htmlFor="lead-name" className="text-sm font-semibold text-slate-700 mb-1.5 block">
                  שם מלא *
                </Label>
                <div className="relative">
                  <User className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  <Input
                    id="lead-name"
                    value={form.full_name}
                    onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                    placeholder="ישראל ישראלי"
                    className="pe-9"
                    required
                  />
                </div>
              </div>

              {/* Phone */}
              <div>
                <Label htmlFor="lead-phone" className="text-sm font-semibold text-slate-700 mb-1.5 block">
                  מספר טלפון *
                </Label>
                <div className="relative">
                  <Phone className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  <Input
                    id="lead-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="050-0000000"
                    className="pe-9"
                    dir="ltr"
                    required
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <Label htmlFor="lead-notes" className="text-sm font-semibold text-slate-700 mb-1.5 block">
                  הערות (אופציונלי)
                </Label>
                <textarea
                  id="lead-notes"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="ספר לנו קצת על הצרכים שלך..."
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-11 bg-brand-600 hover:bg-brand-700 text-white font-semibold shadow-lg shadow-brand-600/20"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin me-2" />שולח...</>
                ) : (
                  'שלח פרטים'
                )}
              </Button>

              <p className="text-xs text-center text-slate-400">
                לא נשתף את פרטיך עם גורמים חיצוניים
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
