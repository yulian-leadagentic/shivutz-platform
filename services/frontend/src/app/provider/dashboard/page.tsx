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
import { Wrench, Plus, Loader2, ExternalLink } from 'lucide-react';

import { apiFetch } from '@/lib/api/client';
import { marketplaceApi } from '@/lib/api/marketplace';
import type { MarketplaceListing } from '@/types';
import { TrustBadge } from '@/components/ads/TrustBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface ProviderMe {
  id:                string;
  name:              string;
  business_number:   string | null;
  // R5 §2b · trade the provider self-selected at signup. Passed to
  // the listing-creation form as ?category=<code> so it's the
  // default without a second pick.
  primary_category:  string | null;
  contact_name:      string;
  contact_phone:     string;
  email:             string | null;
  city:              string | null;
  region:            string | null;
  website:           string | null;
  description:       string | null;
  logo_url:          string | null;
  status:            'pending' | 'active' | 'suspended';
  verified_at:       string | null;
  created_at:        string;
}

export default function ProviderDashboardPage() {
  const [me,       setMe]       = useState<ProviderMe | null>(null);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [meResp, listingsResp] = await Promise.all([
          apiFetch<ProviderMe>('/organizations/providers/me'),
          marketplaceApi.list({ mine: true }),
        ]);
        setMe(meResp);
        setListings(listingsResp);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'שגיאה בטעינה');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error || !me) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <p className="text-rose-700 font-medium">שגיאה בטעינה</p>
          <p className="text-sm text-slate-500 mt-1">{error || 'לא נמצאה חשבון ספק'}</p>
          <Link href="/" className="mt-4 inline-block text-brand-600 underline">חזרה לדף הבית</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <header className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Wrench className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{me.name}</h1>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                <TrustBadge
                  entity="service_provider"
                  level={me.verified_at ? 'verified' : 'registered'}
                />
                {me.city && <span>· {me.city}</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/marketplace">
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4" />
                שוק המודעות
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

        {/* Listings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">המודעות שלי</CardTitle>
            <CardDescription>מודעות שפרסמת בשוק. חינם עד סוף 2026.</CardDescription>
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
                {listings.map((l) => (
                  <Link
                    key={l.id}
                    href={`/marketplace/${l.id}`}
                    className="block rounded-xl border border-slate-200 bg-white p-3 hover:border-emerald-400 hover:shadow-sm transition"
                  >
                    <p className="font-semibold text-slate-900 line-clamp-1">{l.title}</p>
                    {l.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{l.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                      {l.city && <span>{l.city}</span>}
                      {l.status !== 'active' && (
                        <span className="text-amber-700">· {l.status}</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
