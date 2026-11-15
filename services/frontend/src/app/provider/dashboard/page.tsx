'use client';

// R5 §1 · P0 · service provider dashboard.
//
// A fresh provider who finished /register/provider or logged back in
// used to be routed by select-entity's binary switch into
// /contractor/dashboard, where RoleGuard bounced them with
// "אין לך חשבון קבלן" — the exact screen Yulian reported. This page
// is the real destination.
//
// Kept deliberately minimal: business name, trust-badge status, "my
// listings", and a "publish a new listing" button. No "coming soon"
// content — a provider who lands on an empty page never comes back.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Wrench, Plus, Loader2, ExternalLink, Layers } from 'lucide-react';

import { ApiError } from '@/lib/api/client';
import { marketplaceApi } from '@/lib/api/marketplace';
import type { MarketplaceListing } from '@/types';
import { TrustBadge } from '@/components/ads/TrustBadge';
import ProviderStats from '@/components/provider/ProviderStats';
import { useProviderMe } from '@/components/provider/ProviderShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

// The labels the corporation's own listings page uses.
const STATUS_HE: Record<MarketplaceListing['status'], string> = {
  active: 'פעיל',
  paused: 'מושהה',
  rented: 'מושכר',
  sold:   'נמכר',
};

export default function ProviderDashboardPage() {
  // R37 · the profile comes from the shell, which already fetched it
  // for the top bar. This page asks only for the listings.
  const { me, loading: meLoading, failed: meFailed } = useProviderMe();
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const loading = meLoading || listingsLoading;
  // R34 5a · pausing a listing frees its place in the plan; publishing
  // it again takes one, and the server refuses when the category has
  // no running plan or the plan is full (402, with the page that helps).
  const [switching,   setSwitching]   = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<{ id: string; text: string; fix: { href: string; label: string } | null } | null>(null);

  async function switchPublished(l: MarketplaceListing) {
    const next = l.status === 'active' ? 'paused' : 'active';
    setSwitching(l.id); setSwitchError(null);
    try {
      await marketplaceApi.update(l.id, { status: next });
      setListings((prev) => prev.map((x) => (x.id === l.id ? { ...x, status: next } : x)));
    } catch (err) {
      const refused = err instanceof ApiError && err.cause.status === 402;
      const details = refused
        ? (err.cause.details as { code?: string; buy_url?: string | null } | undefined)
        : undefined;
      setSwitchError({
        id:   l.id,
        text: err instanceof Error ? err.message : 'העדכון נכשל. נסו שוב.',
        // A full plan is fixed on the plan page, a missing one on the
        // page that adds a plan.
        fix: !refused ? null
          : details?.code === 'no_active_subscription'
            ? { href: details.buy_url || '/provider/marketplace/subscribe', label: 'הוספת מסלול בקטגוריה' }
            : { href: details?.buy_url || '/provider/billing', label: 'מנוי ותשלום' },
      });
    } finally {
      setSwitching(null);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setListings(await marketplaceApi.list({ mine: true }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'שגיאה בטעינה');
      } finally {
        setListingsLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error || meFailed || !me) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <p className="text-rose-700 font-medium">שגיאה בטעינה</p>
          <p className="text-sm text-slate-500 mt-1">{error || 'לא נמצאה חשבון ספק'}</p>
          <Link href="/" className="mt-4 inline-block text-brand-600 underline">חזרה לדף הבית</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <Wrench className="h-6 w-6" />
          </div>
          <div>
            {/* The business name is in the bar above; the page says what it is. */}
            <h1 className="text-2xl font-bold text-slate-900">לוח בקרה</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
              <TrustBadge
                entity="service_provider"
                level={me.verified_at ? 'verified' : 'registered'}
              />
              {me.city && <span>· {me.city}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/marketplace">
            <Button variant="outline" size="sm">
              <ExternalLink className="h-4 w-4" />
              שוק המודעות
            </Button>
          </Link>
          {/* R33 B.3 · a provider publishes only where it has a plan;
              this is where it adds one in another category. */}
          <Link href="/provider/marketplace/subscribe">
            <Button variant="outline" size="sm">
              <Layers className="h-4 w-4" />
              הוספת קטגוריה
            </Button>
          </Link>
          <Link href={me.primary_category ? `/provider/marketplace/new?category=${encodeURIComponent(me.primary_category)}` : '/provider/marketplace/new'}>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              פרסום מודעה
            </Button>
          </Link>
        </div>
      </header>

      <ProviderStats />

      {/* Listings */}
      <Card id="my-listings">
        <CardHeader>
          <CardTitle className="text-lg">המודעות שלי</CardTitle>
          <CardDescription>מודעות שפרסמת בשוק. חינם לתקופת ניסיון.</CardDescription>
        </CardHeader>
        <CardContent>
          {listings.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">
              <p>עדיין לא פרסמת מודעה.</p>
              <Link
                href={me.primary_category
                  ? `/provider/marketplace/new?category=${encodeURIComponent(me.primary_category)}`
                  : '/provider/marketplace/new'}
                className="mt-3 inline-block text-emerald-700 font-semibold hover:underline"
              >
                פרסם את המודעה הראשונה →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {listings.map((l) => {
                const published = l.status === 'active';
                return (
                  <div
                    key={l.id}
                    className="flex flex-col rounded-xl border border-slate-200 bg-white p-3 transition hover:border-emerald-400 hover:shadow-sm"
                  >
                    <Link href={`/marketplace/${l.id}`} className="block min-w-0 focus-visible:rounded">
                      <p className="font-semibold text-slate-900 line-clamp-1">{l.title}</p>
                      {l.description && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{l.description}</p>
                      )}
                    </Link>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                      <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${
                            published ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                          }`}
                        >
                          {STATUS_HE[l.status] ?? l.status}
                        </span>
                        {l.city && <span className="truncate">{l.city}</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => void switchPublished(l)}
                        disabled={switching === l.id}
                        className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:rounded-lg disabled:opacity-60"
                      >
                        {switching === l.id && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
                        {published ? 'השהיה' : 'פרסום מחדש'}
                      </button>
                    </div>
                    {switchError?.id === l.id && (
                      <p role="alert" className="mt-1 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-800">
                        {switchError.text}
                        {switchError.fix && (
                          <>
                            {' '}
                            <Link href={switchError.fix.href} className="font-semibold underline underline-offset-2">
                              {switchError.fix.label}
                            </Link>
                          </>
                        )}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
