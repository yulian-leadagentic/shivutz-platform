'use client';

// G5 — TopBar bell menu. Cheap unread poll every 60s + a small
// dropdown that lists the 8 most recent inbox rows. Full history
// lives at /notifications (future). Silent on 401 / network error
// so an offline user sees no red UI, just a plain bell.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Check, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';

interface InboxRow {
  id: string;
  event_key: string;
  title_he: string;
  body_he: string;
  target_href: string | null;
  channels_sent: string | null;
  read_at: string | null;
  created_at: string;
}

const POLL_MS = 60_000;

function relTime(iso: string): string {
  const s = iso.includes(' ') && !iso.includes('T') ? iso.replace(' ', 'T') : iso;
  const z = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z';
  const diffMin = Math.floor((Date.now() - new Date(z).getTime()) / 60_000);
  if (diffMin < 1)  return 'עכשיו';
  if (diffMin < 60) return `לפני ${diffMin} דק׳`;
  if (diffMin < 60 * 24) return `לפני ${Math.floor(diffMin / 60)} שע׳`;
  return `לפני ${Math.floor(diffMin / 60 / 24)} ימים`;
}

export function NotificationBell() {
  const [unread, setUnread]   = useState(0);
  const [open, setOpen]       = useState(false);
  const [rows, setRows]       = useState<InboxRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarking] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const pollUnread = useCallback(async () => {
    try {
      const r = await apiFetch<{ unread: number }>('/notifications/unread-count');
      setUnread(r?.unread ?? 0);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    pollUnread();
    const t = setInterval(pollUnread, POLL_MS);
    return () => clearInterval(t);
  }, [pollUnread]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch<InboxRow[]>('/notifications/inbox')
      .then((data) => { setRows(Array.isArray(data) ? data : []); })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function markOne(id: string) {
    // Optimistic — the API round-trip is silent to the user.
    setRows((r) => r ? r.map((x) => x.id === id ? { ...x, read_at: new Date().toISOString() } : x) : r);
    setUnread((n) => Math.max(0, n - 1));
    try { await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }); }
    catch { /* the next poll will reconcile */ }
  }

  async function markAll() {
    if (markingAll) return;
    setMarking(true);
    try {
      await apiFetch('/notifications/mark-all-read', { method: 'POST' });
      setRows((r) => r ? r.map((x) => x.read_at ? x : { ...x, read_at: new Date().toISOString() }) : r);
      setUnread(0);
    } catch { /* silent */ }
    finally { setMarking(false); }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex items-center justify-center h-9 w-9 rounded-lg hover:bg-slate-100 transition-colors"
        aria-label={unread > 0 ? `התראות (${unread} חדשות)` : 'התראות'}
      >
        <Bell className="h-5 w-5 text-slate-600" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -end-0.5 min-w-[18px] h-[18px] rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center px-1">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 mt-2 w-80 max-h-[70vh] overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-xl z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 sticky top-0 bg-white">
            <span className="text-sm font-bold text-slate-900">התראות</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                disabled={markingAll}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-900 disabled:opacity-50"
              >
                {markingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                סמן הכל כנקרא
              </button>
            )}
          </div>

          {loading ? (
            <div className="py-8 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : !rows || rows.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">אין התראות</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((n) => {
                const unread = !n.read_at;
                const inner = (
                  <>
                    <p className={`text-sm ${unread ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>
                      {n.title_he}
                    </p>
                    {n.body_he && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body_he}</p>
                    )}
                    <p className="text-[11px] text-slate-400 mt-1">{relTime(n.created_at)}</p>
                  </>
                );
                return (
                  <li key={n.id} className={`px-3 py-2.5 hover:bg-slate-50 ${unread ? 'bg-brand-50/30' : ''}`}>
                    {n.target_href ? (
                      <Link
                        href={n.target_href}
                        onClick={() => { if (unread) markOne(n.id); setOpen(false); }}
                        className="block"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { if (unread) markOne(n.id); }}
                        className="block w-full text-start"
                      >
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
