'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Send, FileText, Users } from 'lucide-react';
import { dealApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import StatusBadge from '@/components/StatusBadge';
import type { Deal, Message, Worker } from '@/types';

interface ReportForm {
  actual_workers: string;
  actual_start_date: string;
  actual_end_date: string;
}

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [reportForm, setReportForm] = useState<ReportForm>({
    actual_workers: '',
    actual_start_date: '',
    actual_end_date: '',
  });
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadDeal() {
    try {
      const d = await dealApi.get(id);
      setDeal(d);
    } catch {
      setError('שגיאה בטעינת העסקה');
    }
  }

  async function loadMessages() {
    try {
      const msgs = await dealApi.messages(id);
      setMessages(msgs);
    } catch {
      // silent — messages panel shows empty
    }
  }

  async function loadWorkers() {
    try {
      const ws = await dealApi.workers(id);
      setWorkers(ws);
    } catch {
      // not implemented yet — graceful fallback
    }
  }

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([loadDeal(), loadMessages(), loadWorkers()]);
      setLoading(false);
    }
    init();

    // Poll messages every 30s
    pollRef.current = setInterval(loadMessages, 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
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
    } catch {
      // show inline error not needed — just don't clear input
    } finally {
      setSending(false);
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
    } catch {
      // show nothing — user can retry
    } finally {
      setReportSubmitting(false);
    }
  }

  function formatDate(iso: string | undefined) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('he-IL');
  }

  function senderLabel(role: string) {
    return role === 'contractor' ? 'קבלן' : role === 'corporation' ? 'תאגיד' : role;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="animate-spin h-6 w-6 me-2" />
        טוען עסקה...
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

  const showReport = ['active', 'reporting'].includes(deal.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">עסקה #{id.slice(0, 8)}</h1>
          <p className="text-sm text-slate-500 mt-1">נוצרה: {formatDate(deal.created_at)}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={deal.status} />
          {deal.agreed_price && (
            <span className="text-sm font-medium text-slate-700 bg-slate-100 px-3 py-1 rounded-full">
              ₪{Number(deal.agreed_price).toLocaleString('he-IL')}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Workers panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-brand-600" />
              עובדים משובצים
            </CardTitle>
          </CardHeader>
          <CardContent>
            {workers.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">
                אין עובדים משובצים עדיין
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-start border-b border-slate-100">
                    <th className="pb-2 font-medium text-start">שם</th>
                    <th className="pb-2 font-medium text-start">מקצוע</th>
                    <th className="pb-2 font-medium text-start">ויזה עד</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map((w) => (
                    <tr key={w.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2">
                        {w.first_name} {w.last_name}
                      </td>
                      <td className="py-2 text-slate-600">{w.profession_type}</td>
                      <td className="py-2 text-slate-600">{formatDate(w.visa_valid_until)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Messages panel */}
        <Card className="flex flex-col" style={{ minHeight: 360 }}>
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-base">הודעות</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 p-0">
            {/* Message list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 280 }}>
              {messages.length === 0 ? (
                <p className="text-slate-400 text-sm text-center pt-4">אין הודעות עדיין</p>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-medium text-slate-600">
                        {senderLabel(msg.sender_role)}
                      </span>
                      <span>{formatDate(msg.created_at)}</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-sm text-slate-800">
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input row */}
            <div className="p-3 border-t border-slate-100 flex gap-2">
              <Input
                placeholder="כתוב הודעה..."
                value={msgInput}
                onChange={(e) => setMsgInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={handleSend}
                disabled={sending || !msgInput.trim()}
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
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
                <Input
                  label="מספר עובדים בפועל"
                  type="number"
                  min={1}
                  value={reportForm.actual_workers}
                  onChange={(e) =>
                    setReportForm((f) => ({ ...f, actual_workers: e.target.value }))
                  }
                  required
                />
                <Input
                  label="תאריך התחלה בפועל"
                  type="date"
                  value={reportForm.actual_start_date}
                  onChange={(e) =>
                    setReportForm((f) => ({ ...f, actual_start_date: e.target.value }))
                  }
                  required
                />
                <Input
                  label="תאריך סיום בפועל"
                  type="date"
                  value={reportForm.actual_end_date}
                  onChange={(e) =>
                    setReportForm((f) => ({ ...f, actual_end_date: e.target.value }))
                  }
                  required
                />
                <div className="sm:col-span-3">
                  <Button type="submit" disabled={reportSubmitting}>
                    {reportSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        שולח...
                      </>
                    ) : (
                      'הגש דוח'
                    )}
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
