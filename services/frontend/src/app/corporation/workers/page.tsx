'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search, Plus, AlertTriangle } from 'lucide-react';
import { workerApi } from '@/lib/api';
import type { Worker } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  available:   { label: 'זמין',       color: 'bg-green-100 text-green-700' },
  assigned:    { label: 'משובץ',      color: 'bg-blue-100 text-blue-700' },
  on_leave:    { label: 'בחופשה',     color: 'bg-amber-100 text-amber-700' },
  deactivated: { label: 'לא פעיל',   color: 'bg-slate-100 text-slate-500' },
};

function visaStatus(until?: string): { label: string; urgent: boolean } {
  if (!until) return { label: '—', urgent: false };
  const days = (new Date(until).getTime() - Date.now()) / 86_400_000;
  if (days < 0)  return { label: 'פגה', urgent: true };
  if (days <= 30) return { label: `${Math.round(days)} ימים`, urgent: true };
  return { label: new Date(until).toLocaleDateString('he-IL'), urgent: false };
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'assigned' | 'deactivated'>('all');

  useEffect(() => {
    workerApi.list()
      .then(setWorkers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = workers.filter((w) => {
    const matchStatus = statusFilter === 'all' || w.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      `${w.first_name} ${w.last_name}`.toLowerCase().includes(q) ||
      w.profession_type.toLowerCase().includes(q) ||
      w.origin_country.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const expiringSoon = workers.filter((w) => {
    const days = (new Date(w.visa_valid_until).getTime() - Date.now()) / 86_400_000;
    return days >= 0 && days <= 30;
  });

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-900">ניהול עובדים</h2>
        <Button asChild>
          <Link href="/corporation/workers/new">
            <Plus className="h-4 w-4" />
            הוסף עובד
          </Link>
        </Button>
      </div>

      {/* Expiring visa warning */}
      {expiringSoon.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">{expiringSoon.length} עובדים</span> עם ויזה הפוגת תוך 30 יום.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'available', 'assigned', 'deactivated'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === f
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {f === 'all' ? 'הכל' : STATUS_LABELS[f]?.label ?? f}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="חפש לפי שם, מקצוע, מדינה..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full ps-9 pe-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">
            {loading ? '...' : `${filtered.length} עובדים`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-8">לא נמצאו עובדים</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="px-4 py-3 text-start font-medium">שם</th>
                    <th className="px-4 py-3 text-start font-medium">מקצוע</th>
                    <th className="px-4 py-3 text-start font-medium">ניסיון</th>
                    <th className="px-4 py-3 text-start font-medium">מדינה</th>
                    <th className="px-4 py-3 text-start font-medium">ויזה</th>
                    <th className="px-4 py-3 text-start font-medium">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((w) => {
                    const vr = visaStatus(w.visa_valid_until);
                    const sr = STATUS_LABELS[w.status] ?? { label: w.status, color: 'bg-slate-100 text-slate-600' };
                    return (
                      <tr key={w.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {w.first_name} {w.last_name}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{w.profession_type}</td>
                        <td className="px-4 py-3 text-slate-600">{w.experience_years} שנ׳</td>
                        <td className="px-4 py-3 text-slate-600">{w.origin_country}</td>
                        <td className={`px-4 py-3 text-xs font-medium ${vr.urgent ? 'text-red-600' : 'text-slate-600'}`}>
                          {vr.urgent && <AlertTriangle className="inline h-3 w-3 me-1" />}
                          {vr.label}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sr.color}`}>
                            {sr.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
