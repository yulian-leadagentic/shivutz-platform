'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Store } from 'lucide-react';
import ListingCard from '@/components/marketplace/ListingCard';
import { marketplaceApi } from '@/lib/api';
import type { MarketplaceListing } from '@/types';

// Static placeholder listings shown while the real data loads (or if the API fails)
const PLACEHOLDERS: MarketplaceListing[] = [
  {
    id: 'p1',
    corporation_id: 'corp1',
    corporation_name: 'עמל כוח אדם בע"מ',
    is_corporation_verified: true,
    category: 'housing',
    title: 'דירה מרוהטת ל-6 עובדים — חדרה, קרוב למרכז',
    city: 'חדרה',
    region: 'center',
    price: 1800,
    price_unit: 'per_month',
    capacity: 6,
    is_furnished: true,
    status: 'active',
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'p2',
    corporation_id: 'corp2',
    corporation_name: 'גלובל ורקרס ישראל',
    is_corporation_verified: true,
    category: 'equipment',
    title: 'פיגומים וכלי עבודה — השכרה לפרויקטים',
    city: 'תל אביב',
    region: 'center',
    price: 2500,
    price_unit: 'per_month',
    status: 'active',
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'p3',
    corporation_id: 'corp3',
    corporation_name: 'מזרח-מערב השמה',
    is_corporation_verified: false,
    category: 'services',
    title: 'שירותי לוגיסטיקה והסעות לעובדים — אזור הדרום',
    city: 'באר שבע',
    region: 'south',
    price_unit: 'negotiable',
    status: 'active',
    created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export default function MarketplacePreview() {
  const [listings, setListings] = useState<MarketplaceListing[]>(PLACEHOLDERS);

  useEffect(() => {
    // Best-effort — show real listings if API is reachable, else keep placeholders
    marketplaceApi
      .list({ })
      .then((data) => {
        if (data.length > 0) setListings(data.slice(0, 3));
      })
      .catch(() => {/* keep placeholders */});
  }, []);

  return (
    <section className="bg-white py-24">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-xl bg-brand-100 flex items-center justify-center">
                <Store className="h-4 w-4 text-brand-600" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
                שוק תאגידים
              </p>
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900">
              מה זמין עכשיו
            </h2>
            <p className="text-slate-500 mt-2">
              תאגידים מורשים מפרסמים דיור, ציוד ושירותים — פתוח לעיון חופשי
            </p>
          </div>
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors group"
          >
            לכל המודעות
            <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {/* Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>

        {/* CTA strip */}
        <div className="mt-12 text-center bg-gradient-to-r from-brand-50 via-indigo-50 to-violet-50 rounded-3xl border border-brand-100 py-8 px-6">
          <p className="text-lg font-bold text-slate-900 mb-2">
            גם אתם רוצים לפרסם? — הצטרפו בחינם
          </p>
          <p className="text-sm text-slate-500 mb-5">
            תאגידים מנויים מפרסמים ללא עלות נוספת. צרו חשבון ופרסמו תוך דקות.
          </p>
          <Link
            href="/register/corporation"
            className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm px-6 py-2.5 rounded-xl shadow-lg shadow-brand-600/20 transition-all hover:-translate-y-0.5"
          >
            הצטרף כתאגיד
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
