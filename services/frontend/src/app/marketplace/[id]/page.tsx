'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, ArrowRight, MapPin, Users, CheckCircle2,
  Phone, Calendar, Home, Wrench, Briefcase, MoreHorizontal,
  AlertCircle, Share2, Building2,
} from 'lucide-react';
import { marketplaceApi } from '@/lib/api';
import type { MarketplaceListing } from '@/types';
import { Button } from '@/components/ui/button';

const CATEGORY_HE: Record<string, string> = {
  housing: 'דיור', equipment: 'ציוד', services: 'שירותים', other: 'אחר',
};
const CATEGORY_ICONS: Record<string, React.ElementType> = {
  housing: Home, equipment: Wrench, services: Briefcase, other: MoreHorizontal,
};
const PRICE_UNIT_HE: Record<string, string> = {
  per_month: 'לחודש', per_night: 'ללילה', fixed: 'מחיר קבוע', negotiable: 'למשא ומתן',
};
const STATUS_HE: Record<string, { label: string; color: string }> = {
  active:  { label: 'זמין', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  rented:  { label: 'מושכר', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  sold:    { label: 'נמכר', color: 'text-slate-600 bg-slate-100 border-slate-200' },
  paused:  { label: 'מושהה', color: 'text-slate-500 bg-slate-50 border-slate-200' },
};

function daysAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (diff === 0) return 'היום';
  if (diff === 1) return 'אתמול';
  if (diff < 7)  return `לפני ${diff} ימים`;
  if (diff < 30) return `לפני ${Math.floor(diff / 7)} שבועות`;
  return `לפני ${Math.floor(diff / 30)} חודשים`;
}

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
  const [listing, setListing] = useState<MarketplaceListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    marketplaceApi.get(id).then(setListing).catch(() => setError('המודעה לא נמצאה')).finally(() => setLoading(false));
  }, [id]);

  function handleShare() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin me-2" />טוען מודעה...
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-slate-500">
        <AlertCircle className="h-10 w-10 text-slate-300" />
        <p className="text-lg font-medium">{error || 'המודעה לא נמצאה'}</p>
        <Link href="/marketplace">
          <Button variant="outline">חזור לשוק</Button>
        </Link>
      </div>
    );
  }

  const Icon = CATEGORY_ICONS[listing.category] ?? MoreHorizontal;
  const catHe = CATEGORY_HE[listing.category] ?? listing.category;
  const statusInfo = STATUS_HE[listing.status];
  const catColor = listing.category === 'housing' ? 'bg-brand-500' :
                   listing.category === 'equipment' ? 'bg-amber-500' :
                   listing.category === 'services'  ? 'bg-emerald-500' : 'bg-slate-400';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
            <ArrowRight className="h-4 w-4" />
          </button>
          <div className="h-4 w-px bg-slate-200" />
          <Link href="/marketplace" className="text-sm text-slate-500 hover:text-brand-600 transition-colors">
            שוק תאגידים
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-sm text-slate-700 truncate font-medium">{listing.title}</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-6">

          {/* Main content */}
          <div className="lg:col-span-2 space-y-5">
            {/* Category color bar */}
            <div className={`h-2 w-full ${catColor} rounded-full`} />

            {/* Title card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-6 space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                      listing.category === 'housing'   ? 'bg-brand-100 text-brand-700' :
                      listing.category === 'equipment' ? 'bg-amber-100 text-amber-700' :
                      listing.category === 'services'  ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                    }`}>
                      <Icon className="h-3 w-3" />
                      {catHe}
                    </span>
                    {statusInfo && (
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    )}
                    {listing.is_corporation_verified && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                        <CheckCircle2 className="h-3 w-3" />
                        תאגיד מאומת
                      </span>
                    )}
                  </div>
                  <h1 className="text-xl font-bold text-slate-900 leading-snug">{listing.title}</h1>
                </div>
                <button onClick={handleShare} className="shrink-0 p-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors text-slate-500 hover:text-slate-700" title="שתף">
                  <Share2 className="h-4 w-4" />
                </button>
              </div>
              {copied && <p className="text-xs text-emerald-600">הקישור הועתק ✓</p>}

              {/* Meta chips */}
              <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                {listing.city && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-slate-400" />
                    {listing.city}
                  </span>
                )}
                {listing.capacity && (
                  <span className="flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-slate-400" />
                    עד {listing.capacity} עובדים
                  </span>
                )}
                {listing.is_furnished && (
                  <span className="text-emerald-700 font-medium">מרוהטת</span>
                )}
                {listing.available_from && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 text-slate-400" />
                    זמין מ-{new Date(listing.available_from).toLocaleDateString('he-IL')}
                  </span>
                )}
              </div>

              {/* Price */}
              {(listing.price != null || listing.price_unit === 'negotiable') && (
                <div className="pt-2 border-t border-slate-100">
                  {listing.price != null ? (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-extrabold text-slate-900">
                        ₪{Number(listing.price).toLocaleString('he-IL')}
                      </span>
                      {listing.price_unit && listing.price_unit !== 'negotiable' && (
                        <span className="text-sm text-slate-500">{PRICE_UNIT_HE[listing.price_unit]}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-lg font-semibold text-slate-700">מחיר למשא ומתן</span>
                  )}
                </div>
              )}
            </div>

            {/* Description */}
            {listing.description && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-6">
                <h2 className="text-base font-bold text-slate-900 mb-3">תיאור</h2>
                <p className="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{listing.description}</p>
              </div>
            )}

            {/* Posted date */}
            <p className="text-xs text-slate-400 text-center">
              פורסם {daysAgo(listing.created_at)}
            </p>
          </div>

          {/* Sidebar — contact card */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-6 space-y-4 sticky top-20">
              {/* Corporation info */}
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <Building2 className="h-5 w-5 text-slate-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">פורסם על ידי</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {listing.corporation_name || 'תאגיד'}
                  </p>
                </div>
              </div>

              {(listing.contact_name || listing.contact_phone) && (
                <div className="border-t border-slate-100 pt-4 space-y-3">
                  {listing.contact_name && (
                    <div className="text-sm text-slate-700">
                      <span className="text-xs text-slate-400 block mb-0.5">איש קשר</span>
                      {listing.contact_name}
                    </div>
                  )}
                  {listing.contact_phone && (
                    <a
                      href={`tel:${listing.contact_phone}`}
                      className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
                    >
                      <Phone className="h-4 w-4" />
                      {listing.contact_phone}
                    </a>
                  )}
                </div>
              )}

              {!listing.contact_phone && (
                <div className="text-center text-xs text-slate-400 py-2">
                  פרטי קשר זמינים לחברים בפלטפורמה
                  <br />
                  <Link href="/login" className="text-brand-600 hover:text-brand-700 font-medium">
                    התחבר לצפייה
                  </Link>
                </div>
              )}

              <Link href="/marketplace" className="block text-center text-xs text-slate-400 hover:text-brand-600 transition-colors pt-1">
                ← חזור לכל המודעות
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
