'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Plus, Pencil, Trash2, PauseCircle, PlayCircle,
  Home, AlertTriangle,
} from 'lucide-react';
import { marketplaceApi } from '@/lib/api';
import type { MarketplaceListing } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  active:  { label: 'פעיל',      cls: 'bg-emerald-100 text-emerald-700' },
  rented:  { label: 'מושכר',     cls: 'bg-blue-100 text-blue-700' },
  sold:    { label: 'נמכר',      cls: 'bg-slate-100 text-slate-600' },
  paused:  { label: 'מושהה',     cls: 'bg-amber-100 text-amber-700' },
};

const CATEGORY_HE: Record<string, string> = {
  housing: 'דיור', equipment: 'ציוד', services: 'שירותים', other: 'אחר',
};

function fmtDate(s?: string) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('he-IL');
}

export default function CorporationMarketplacePage() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await marketplaceApi.list({ mine: true });
      setListings(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleTogglePause(l: MarketplaceListing) {
    setActionId(l.id);
    try {
      const newStatus = l.status === 'active' ? 'paused' : 'active';
      await marketplaceApi.update(l.id, { status: newStatus });
      setListings((prev) => prev.map((p) => p.id === l.id ? { ...p, status: newStatus } : p));
    } catch { /* silent */ }
    finally { setActionId(null); }
  }

  async function handleDelete(id: string) {
    if (!confirm('למחוק את המודעה?')) return;
    setActionId(id);
    try {
      await marketplaceApi.remove(id);
      setListings((prev) => prev.filter((p) => p.id !== id));
    } catch { /* silent */ }
    finally { setActionId(null); }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">המודעות שלי</h1>
          <p className="text-sm text-slate-500 mt-1">ניהול פרסומים בשוק — דיור, ציוד ושירותים</p>
        </div>
        <Link href="/corporation/marketplace/new">
          <Button><Plus className="h-4 w-4 me-2" />פרסם מודעה חדשה</Button>
        </Link>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Home className="h-4 w-4 text-brand-600" />
            מודעות ({listings.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="animate-spin h-5 w-5 me-2" />טוען...
            </div>
          ) : listings.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <Home className="h-12 w-12 text-slate-200 mx-auto" />
              <p className="text-slate-600 font-medium">אין מודעות פעילות</p>
              <Link href="/corporation/marketplace/new">
                <Button size="sm"><Plus className="h-3.5 w-3.5 me-1" />פרסם מודעה ראשונה</Button>
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-xs text-slate-500 font-medium">
                  <th className="text-start px-5 py-3">כותרת</th>
                  <th className="text-start px-5 py-3">קטגוריה</th>
                  <th className="text-start px-5 py-3">עיר</th>
                  <th className="text-start px-5 py-3">תאריך</th>
                  <th className="text-start px-5 py-3">סטטוס</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {listings.map((l) => {
                  const st = STATUS_LABELS[l.status] ?? { label: l.status, cls: 'bg-slate-100 text-slate-600' };
                  return (
                    <tr key={l.id} className="hover:bg-slate-50/50">
                      <td className="px-5 py-3 font-medium text-slate-900 max-w-xs truncate">{l.title}</td>
                      <td className="px-5 py-3 text-slate-500">{CATEGORY_HE[l.category] ?? l.category}</td>
                      <td className="px-5 py-3 text-slate-500">{l.city || '—'}</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">{fmtDate(l.created_at)}</td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <Link href={`/corporation/marketplace/${l.id}/edit`}>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                              <Pencil className="h-3.5 w-3.5 text-slate-400" />
                            </Button>
                          </Link>
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => handleTogglePause(l)}
                            disabled={actionId === l.id}
                            className="h-7 w-7 p-0"
                          >
                            {l.status === 'active'
                              ? <PauseCircle className="h-3.5 w-3.5 text-amber-500" />
                              : <PlayCircle className="h-3.5 w-3.5 text-emerald-500" />}
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => handleDelete(l.id)}
                            disabled={actionId === l.id}
                            className="h-7 w-7 p-0"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
