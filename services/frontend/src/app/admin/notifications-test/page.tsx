'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, Play, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { adminApi } from '@/lib/adminApi';

type CatalogEvent = {
  event_type:   string;
  group:        string;
  channels:     string[];
  description:  string;
  payload:      Record<string, unknown>;
  override_keys: string[];
  notes?:       string;
};

type CatalogCron = { name: string; description: string };

type HistoryEntry = {
  ts:     number;
  kind:   'event' | 'cron';
  label:  string;
  ok:     boolean;
  detail: string;
};

const HISTORY_KEY = 'tagidai_notif_test_history_v1';

export default function NotificationTestPanel() {
  const [events, setEvents]       = useState<CatalogEvent[]>([]);
  const [crons, setCrons]         = useState<CatalogCron[]>([]);
  const [loading, setLoading]     = useState(true);
  const [catalogError, setCatErr] = useState<string | null>(null);

  const [selectedKey, setSelectedKey] = useState<string>('');
  const [payloadText, setPayloadText] = useState<string>('');
  const [overridePhone, setOverridePhone] = useState<string>('');
  const [overrideEmail, setOverrideEmail] = useState<string>('');
  const [firing, setFiring] = useState(false);
  // History persists across refreshes via localStorage so the admin
  // can leave the page and come back without losing what was fired.
  // Capped at 50 entries; older ones drop off the bottom.
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 50) : [];
    } catch {
      return [];
    }
  });

  // Mirror history to localStorage on every change. Wrapped in
  // try/catch because Safari's private mode can throw QuotaExceeded.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      /* private mode / quota — silent skip is fine for an admin tool */
    }
  }, [history]);

  useEffect(() => {
    adminApi.testNotifCatalog()
      .then(d => { setEvents(d.events); setCrons(d.crons); })
      .catch(err => setCatErr(err?.message || 'failed_to_load_catalog'))
      .finally(() => setLoading(false));
  }, []);

  const selected = useMemo(
    () => events.find(e => e.event_type === selectedKey) || null,
    [events, selectedKey],
  );

  // Re-seed payload textarea whenever the user picks a new event.
  useEffect(() => {
    if (!selected) { setPayloadText(''); return; }
    setPayloadText(JSON.stringify(selected.payload, null, 2));
  }, [selected]);

  const grouped = useMemo(() => {
    const map: Record<string, CatalogEvent[]> = {};
    for (const e of events) {
      (map[e.group] ||= []).push(e);
    }
    return map;
  }, [events]);

  async function fireEvent() {
    if (!selected) return;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(payloadText || '{}');
    } catch (err) {
      pushHistory({ ts: Date.now(), kind: 'event', label: selected.event_type, ok: false, detail: 'JSON לא תקין' });
      return;
    }
    setFiring(true);
    try {
      const res = await adminApi.fireTestEvent({
        event_type:     selected.event_type,
        payload:        parsed,
        override_phone: overridePhone || undefined,
        override_email: overrideEmail || undefined,
      });
      pushHistory({
        ts: Date.now(), kind: 'event', label: selected.event_type, ok: !!res.fired,
        detail: `נשלח בהצלחה — payload נשמר ב-history`,
      });
    } catch (err: unknown) {
      pushHistory({
        ts: Date.now(), kind: 'event', label: selected.event_type, ok: false,
        detail: err instanceof Error ? err.message : 'send_failed',
      });
    } finally {
      setFiring(false);
    }
  }

  async function fireCron(name: string) {
    try {
      const res = await adminApi.fireTestCron(name);
      pushHistory({
        ts: Date.now(), kind: 'cron', label: name, ok: !!res.ran,
        detail: 'הופעל. בדוק את הלוג של notification service.',
      });
    } catch (err: unknown) {
      pushHistory({
        ts: Date.now(), kind: 'cron', label: name, ok: false,
        detail: err instanceof Error ? err.message : 'cron_failed',
      });
    }
  }

  function pushHistory(entry: HistoryEntry) {
    setHistory(prev => [entry, ...prev].slice(0, 50));
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Bell className="h-6 w-6 text-brand-600" />
        <div>
          <h1 className="text-xl font-semibold text-slate-900">בדיקת הודעות</h1>
          <p className="text-sm text-slate-500">
            הפעלת אירועים מהמערכת עם פיילואד נבחר ויעדים מותאמים — בלי לפגוע במשתמשים אמיתיים.
          </p>
        </div>
      </header>

      {catalogError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 flex items-start gap-2">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600 mt-0.5" />
          <div>
            <div className="font-medium">לא הצלחנו לטעון את הקטלוג</div>
            <div className="text-xs mt-0.5">{catalogError}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">טוען קטלוג…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: event picker + payload editor */}
          <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-slate-800">אירוע מערכת</h2>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">בחר אירוע</label>
              <select
                value={selectedKey}
                onChange={e => setSelectedKey(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              >
                <option value="">— בחר —</option>
                {Object.entries(grouped).map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map(e => (
                      <option key={e.event_type} value={e.event_type}>
                        {e.event_type} ({e.channels.join(', ') || '—'})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {selected && (
              <>
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700 space-y-1.5">
                  <div className="font-medium text-slate-900">{selected.description}</div>
                  <div className="text-xs text-slate-500">
                    ערוצים: {selected.channels.length ? selected.channels.join(' · ') : 'ללא הודעה ישירה'}
                  </div>
                  {selected.notes && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-1.5">
                      ⓘ {selected.notes}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-600">החלף טלפון יעד</label>
                    <input
                      dir="ltr"
                      placeholder="+972500000000"
                      value={overridePhone}
                      onChange={e => setOverridePhone(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                    />
                    <span className="text-xs text-slate-400">
                      יחליף את כל שדות *phone* ב-{selected.override_keys.filter(k => k.toLowerCase().includes('phone')).length || 0} מפתחות
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-600">החלף אימייל יעד</label>
                    <input
                      dir="ltr"
                      placeholder="test@example.com"
                      value={overrideEmail}
                      onChange={e => setOverrideEmail(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                    />
                    <span className="text-xs text-slate-400">
                      יחליף את כל שדות *email* ב-{selected.override_keys.filter(k => k.toLowerCase().includes('email')).length || 0} מפתחות
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">payload (ערוך לפי הצורך)</label>
                  <textarea
                    dir="ltr"
                    value={payloadText}
                    onChange={e => setPayloadText(e.target.value)}
                    rows={14}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                  />
                </div>

                <button
                  onClick={fireEvent}
                  disabled={firing}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Play className="h-4 w-4" />
                  {firing ? 'שולח…' : 'הפעל אירוע'}
                </button>
              </>
            )}
          </section>

          {/* Right: crons + history */}
          <aside className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Clock className="h-5 w-5 text-slate-500" />
                Cron — הפעל עכשיו
              </h2>
              <ul className="space-y-2">
                {crons.map(c => (
                  <li key={c.name} className="border border-slate-200 rounded-xl px-3 py-2.5 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-700">{c.name}</span>
                      <button
                        onClick={() => fireCron(c.name)}
                        className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-900"
                      >
                        <Play className="h-3 w-3" />
                        run
                      </button>
                    </div>
                    <span className="text-xs text-slate-500 leading-snug">{c.description}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-slate-800">היסטוריה (50 אחרונים)</h2>
                {history.length > 0 && (
                  <button
                    onClick={() => setHistory([])}
                    className="text-xs text-slate-500 hover:text-rose-600 underline"
                  >
                    נקה
                  </button>
                )}
              </div>
              {history.length === 0 ? (
                <div className="text-sm text-slate-500">אין עדיין שליחות.</div>
              ) : (
                <ul className="space-y-2 max-h-96 overflow-auto">
                  {history.map((h, i) => (
                    <li key={`${h.ts}-${i}`} className={`border rounded-xl px-3 py-2 text-xs ${h.ok ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                      <div className="flex items-center gap-1.5 font-mono">
                        {h.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertCircle className="h-3.5 w-3.5 text-rose-600" />}
                        <span className="text-slate-800">{h.kind === 'cron' ? 'cron' : 'event'}: {h.label}</span>
                      </div>
                      <div className="text-slate-600 mt-0.5 leading-snug">{h.detail}</div>
                      <div className="text-slate-400 text-[10px] mt-0.5">{new Date(h.ts).toLocaleTimeString('he-IL')}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
