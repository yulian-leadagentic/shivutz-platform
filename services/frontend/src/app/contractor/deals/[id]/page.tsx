'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2, Send, FileText, Users, Clock, CheckCircle2,
  Building2, Phone, Mail, UserCheck, HandshakeIcon, Download,
} from 'lucide-react';
import { dealApi, workerApi, orgApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import StatusBadge from '@/components/StatusBadge';
import type { Deal, Message, Worker, Corporation } from '@/types';

const EXP_LABELS: Record<string, string> = {
  '0-6': '0–6 חודשים', '6-12': '6–12 חודשים',
  '12-24': '12–24 חודשים', '24-36': '24–36 חודשים', '36+': '36+ חודשים',
};

interface ReportForm {
  actual_workers: string;
  actual_start_date: string;
  actual_end_date: string;
}

const STATUS_EXPLANATION: Record<string, { icon: React.ReactNode; text: string; color: string }> = {
  proposed: {
    icon: <Clock className="h-4 w-4 shrink-0" />,
    text: 'הפנייה נשלחה לתאגיד — ממתינים לאישור',
    color: 'bg-blue-50 border-blue-200 text-blue-800',
  },
  counter_proposed: {
    icon: <Clock className="h-4 w-4 shrink-0" />,
    text: 'התאגיד שלח הצעה נגדית — בדוק את הצ׳אט',
    color: 'bg-amber-50 border-amber-200 text-amber-800',
  },
  accepted: {
    icon: <CheckCircle2 className="h-4 w-4 shrink-0" />,
    text: 'התאגיד אישר ושיבץ עובדים — בדוק את פרטי יצירת הקשר ואשר את ההתקשרות',
    color: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  },
  active: {
    icon: <CheckCircle2 className="h-4 w-4 shrink-0" />,
    text: 'עסקה פעילה — העובדים בשטח',
    color: 'bg-green-50 border-green-200 text-green-800',
  },
  reporting: {
    icon: <FileText className="h-4 w-4 shrink-0" />,
    text: 'שלב דיווח — יש להגיש דוח ביצוע',
    color: 'bg-amber-50 border-amber-200 text-amber-800',
  },
};

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [deal, setDeal]         = useState<Deal | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [workers, setWorkers]   = useState<Worker[]>([]);
  const [corp, setCorp]         = useState<Corporation | null>(null);
  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const [reportForm, setReportForm] = useState<ReportForm>({
    actual_workers: '', actual_start_date: '', actual_end_date: '',
  });
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadDeal() {
    const d = await dealApi.get(id);
    setDeal(d);
    if (d.corporation_id) {
      orgApi.getCorporation(d.corporation_id)
        .then((c) => setCorp(c))
        .catch(() => {});
    }
    return d;
  }

  async function loadMessages() {
    try {
      const msgs = await dealApi.messages(id);
      setMessages(msgs);
    } catch { /* silent */ }
  }

  async function loadWorkers() {
    try {
      const stubs = await dealApi.workers(id);
      if (!stubs || stubs.length === 0) return;
      const full = await Promise.allSettled(
        stubs.map((s: { id: string }) => workerApi.get(s.id))
      );
      setWorkers(
        full
          .filter((r): r is PromiseFulfilledResult<Worker> => r.status === 'fulfilled')
          .map((r) => r.value)
      );
    } catch { /* graceful */ }
  }

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        await loadDeal();
        await Promise.all([loadMessages(), loadWorkers()]);
      } catch {
        setError('שגיאה בטעינת העסקה');
      } finally {
        setLoading(false);
      }
    }
    init();
    pollRef.current = setInterval(loadMessages, 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!msgInput.trim()) return;
    setSending(true);
    try {
      const msg = await dealApi.sendMsg(id, msgInput.trim());
      setMessages((prev) => [...prev, msg]);
      setMsgInput('');
    } catch { /* keep input */ }
    finally { setSending(false); }
  }

  async function handleConfirm() {
    setConfirming(true);
    setConfirmError('');
    try {
      await dealApi.updateStatus(id, 'active');
      // Reload deal + messages to get the system message
      await Promise.all([loadDeal(), loadMessages()]);
    } catch (e: unknown) {
      setConfirmError(e instanceof Error ? e.message : 'שגיאה באישור ההתקשרות');
    } finally {
      setConfirming(false);
    }
  }

  async function handleReport(e: React.FormEvent) {
    e.preventDefault();
    setReportSubmitting(true);
    try {
      await dealApi.report(id, {
        actual_workers: Number(reportForm.actual_workers),
        actual_start_date: reportForm.actual_start_date,
        actual_end_date: reportForm.actual_end_date,
      });
      setReportSuccess(true);
    } catch { /* silent */ }
    finally { setReportSubmitting(false); }
  }

  function formatDate(iso: string | undefined) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('he-IL');
  }

  function senderLabel(role: string) {
    return role === 'contractor' ? 'קבלן' : role === 'corporation' ? 'תאגיד' : 'מערכת';
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="animate-spin h-6 w-6 me-2" />טוען עסקה...
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
        {error || 'העסקה לא נמצאה'}
      </div>
    );
  }

  const showReport     = ['active', 'reporting'].includes(deal.status);
  const showConfirm    = deal.status === 'accepted';
  const showWorkers    = ['accepted', 'active', 'reporting', 'completed'].includes(deal.status);
  const statusInfo     = STATUS_EXPLANATION[deal.status];
  const corpName       = corp?.company_name_he || corp?.company_name || '';

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">עסקה #{id.slice(0, 8)}</h1>
            <StatusBadge status={deal.status} />
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span>נוצרה: {formatDate(deal.created_at)}</span>
            {corpName && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                {corpName}
              </span>
            )}
            {deal.workers_count && (
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {deal.workers_count} עובדים
              </span>
            )}
            {deal.agreed_price && (
              <span className="font-medium text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full">
                ₪{Number(deal.agreed_price).toLocaleString('he-IL')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Status banner */}
      {statusInfo && (
        <div className={`flex items-center gap-2.5 border rounded-xl px-4 py-3 text-sm font-medium ${statusInfo.color}`}>
          {statusInfo.icon}
          {statusInfo.text}
        </div>
      )}

      {/* ── Standard contract document (shown once attached) ── */}
      {deal.standard_contract_url && (
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
          <FileText className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-800 mb-0.5">
              חוזה התקשרות סטנדרטי — צורף על ידי התאגיד
            </p>
            <p className="text-xs text-blue-600">
              {deal.standard_contract_doc_name || 'חוזה התקשרות'}
            </p>
          </div>
          <a
            href={deal.standard_contract_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 border border-blue-300 rounded-lg px-3 py-1.5 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            הורד
          </a>
        </div>
      )}

      {/* ── ACCEPTED: Corporation contact + workers + confirm button ── */}
      {showConfirm && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-emerald-800">
              <HandshakeIcon className="h-5 w-5" />
              אישור התקשרות
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Corporation contact */}
            {corp && (
              <div className="bg-white rounded-xl border border-emerald-100 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  פרטי יצירת קשר — תאגיד
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                    <span className="font-medium">{corpName}</span>
                  </div>
                  {corp.contact_name && (
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <UserCheck className="h-4 w-4 text-slate-400 shrink-0" />
                      <span>{corp.contact_name}</span>
                    </div>
                  )}
                  {corp.contact_phone && (
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                      <a href={`tel:${corp.contact_phone}`} className="text-brand-600 hover:underline font-medium">
                        {corp.contact_phone}
                      </a>
                    </div>
                  )}
                  {corp.contact_email && (
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Mail className="h-4 w-4 text-slate-400 shrink-0" />
                      <a href={`mailto:${corp.contact_email}`} className="text-brand-600 hover:underline">
                        {corp.contact_email}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Assigned workers preview */}
            {workers.length > 0 && (
              <div className="bg-white rounded-xl border border-emerald-100 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  עובדים משובצים ({workers.length})
                </p>
                <div className="space-y-2">
                  {workers.map((w) => {
                    const expCode  = w.experience_range ?? '';
                    const expLabel = EXP_LABELS[expCode] ?? (w.experience_years ? `${w.experience_years} שנים` : '—');
                    return (
                      <div key={w.id} className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0 text-xs font-bold text-brand-700">
                          {w.first_name?.[0]}{w.last_name?.[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900">{w.first_name} {w.last_name}</p>
                          <p className="text-xs text-slate-500">{w.profession_type} · {expLabel} · ויזה עד {formatDate(w.visa_valid_until)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Confirm button */}
            {confirmError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {confirmError}
              </div>
            )}
            <Button
              onClick={handleConfirm}
              disabled={confirming}
              className="bg-emerald-600 hover:bg-emerald-700 text-white w-full sm:w-auto"
            >
              {confirming
                ? <><Loader2 className="h-4 w-4 animate-spin me-2" />מאשר...</>
                : <><CheckCircle2 className="h-4 w-4 me-2" />אשר התקשרות</>
              }
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Workers panel (post-acceptance, non-confirm states) */}
        {!showConfirm && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-brand-600" />
                עובדים משובצים
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!showWorkers ? (
                <p className="text-slate-400 text-sm text-center py-4">
                  שמות העובדים יוצגו לאחר אישור התאגיד
                </p>
              ) : workers.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-4">אין עובדים משובצים</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-100">
                      <th className="pb-2 font-medium text-start">שם</th>
                      <th className="pb-2 font-medium text-start">מקצוע</th>
                      <th className="pb-2 font-medium text-start">ניסיון</th>
                      <th className="pb-2 font-medium text-start">ויזה עד</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workers.map((w) => {
                      const expCode  = w.experience_range ?? '';
                      const expLabel = EXP_LABELS[expCode] ?? (w.experience_years ? `${w.experience_years} שנים` : '—');
                      return (
                        <tr key={w.id} className="border-b border-slate-50 last:border-0">
                          <td className="py-2 font-medium">{w.first_name} {w.last_name}</td>
                          <td className="py-2 text-slate-600">{w.profession_type}</td>
                          <td className="py-2 text-slate-500 text-xs">{expLabel}</td>
                          <td className="py-2 text-slate-600">{formatDate(w.visa_valid_until)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        )}

        {/* Messages panel */}
        <Card className={`flex flex-col ${showConfirm ? 'lg:col-span-2' : ''}`} style={{ minHeight: 360 }}>
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-base">הודעות</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 p-0">
            <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 320 }}>
              {messages.length === 0 ? (
                <p className="text-slate-400 text-sm text-center pt-4">אין הודעות עדיין</p>
              ) : (
                messages.map((msg) => {
                  const isSystem = msg.content_type === 'system' || msg.sender_role === 'admin';
                  const isContractor = msg.sender_role === 'contractor';
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col gap-0.5 ${isContractor ? 'items-end' : 'items-start'}`}
                    >
                      <div className={`flex items-center gap-2 text-xs text-slate-400 ${isContractor ? 'flex-row-reverse' : ''}`}>
                        <span className="font-medium text-slate-600">{senderLabel(msg.sender_role)}</span>
                        <span>{formatDate(msg.created_at)}</span>
                      </div>
                      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-line
                        ${isSystem
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs w-full max-w-full'
                          : isContractor
                            ? 'bg-brand-600 text-white'
                            : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-3 border-t border-slate-100 flex gap-2">
              <Input
                placeholder="כתוב הודעה..."
                value={msgInput}
                onChange={(e) => setMsgInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                className="flex-1"
              />
              <Button size="sm" onClick={handleSend} disabled={sending || !msgInput.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                <span className="sr-only">שלח</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Report section */}
      {showReport && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-brand-600" />
              הגשת דוח ביצוע
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reportSuccess ? (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-700 text-sm font-medium">
                ✓ הדוח הוגש בהצלחה
              </div>
            ) : (
              <form onSubmit={handleReport} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input label="מספר עובדים בפועל" type="number" min={1}
                  value={reportForm.actual_workers}
                  onChange={(e) => setReportForm((f) => ({ ...f, actual_workers: e.target.value }))} required />
                <Input label="תאריך התחלה בפועל" type="date"
                  value={reportForm.actual_start_date}
                  onChange={(e) => setReportForm((f) => ({ ...f, actual_start_date: e.target.value }))} required />
                <Input label="תאריך סיום בפועל" type="date"
                  value={reportForm.actual_end_date}
                  onChange={(e) => setReportForm((f) => ({ ...f, actual_end_date: e.target.value }))} required />
                <div className="sm:col-span-3">
                  <Button type="submit" disabled={reportSubmitting}>
                    {reportSubmitting ? <><Loader2 className="h-4 w-4 animate-spin me-2" />שולח...</> : 'הגש דוח'}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
