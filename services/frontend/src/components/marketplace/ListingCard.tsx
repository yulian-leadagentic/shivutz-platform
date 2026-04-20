import Link from 'next/link';
import { MapPin, Users, CheckCircle2, Home, Wrench, Briefcase, MoreHorizontal } from 'lucide-react';
import type { MarketplaceListing } from '@/types';

const CATEGORY_ICONS = {
  housing:   Home,
  equipment: Wrench,
  services:  Briefcase,
  other:     MoreHorizontal,
};
const CATEGORY_HE = {
  housing: 'דיור', equipment: 'ציוד', services: 'שירותים', other: 'אחר',
};
const PRICE_UNIT_HE: Record<string, string> = {
  per_month: 'לחודש', per_night: 'ללילה', fixed: 'מחיר קבוע', negotiable: 'למשא ומתן',
};

function daysAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (diff === 0) return 'היום';
  if (diff === 1) return 'אתמול';
  if (diff < 7)  return `לפני ${diff} ימים`;
  if (diff < 30) return `לפני ${Math.floor(diff / 7)} שבועות`;
  return `לפני ${Math.floor(diff / 30)} חודשים`;
}

export default function ListingCard({ listing }: { listing: MarketplaceListing }) {
  const Icon = CATEGORY_ICONS[listing.category] ?? MoreHorizontal;
  const catHe = CATEGORY_HE[listing.category] ?? listing.category;

  return (
    <Link
      href={`/marketplace/${listing.id}`}
      className="group block bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden"
    >
      {/* Color header bar by category */}
      <div className={`h-1.5 w-full ${
        listing.category === 'housing'   ? 'bg-brand-500' :
        listing.category === 'equipment' ? 'bg-amber-500' :
        listing.category === 'services'  ? 'bg-emerald-500' : 'bg-slate-400'
      }`} />

      <div className="p-4 space-y-3">
        {/* Category + age */}
        <div className="flex items-center justify-between">
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
            listing.category === 'housing'   ? 'bg-brand-100 text-brand-700' :
            listing.category === 'equipment' ? 'bg-amber-100 text-amber-700' :
            listing.category === 'services'  ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
          }`}>
            <Icon className="h-3 w-3" />
            {catHe}
          </span>
          <span className="text-[11px] text-slate-400">{daysAgo(listing.created_at)}</span>
        </div>

        {/* Title */}
        <h3 className="font-bold text-slate-900 text-sm leading-snug group-hover:text-brand-700 transition-colors line-clamp-2">
          {listing.title}
        </h3>

        {/* Location + capacity */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {listing.city && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3 shrink-0" />
              {listing.city}
            </span>
          )}
          {listing.capacity && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3 shrink-0" />
              עד {listing.capacity} עובדים
            </span>
          )}
          {listing.is_furnished && (
            <span className="text-emerald-600 font-medium">מרוהטת</span>
          )}
        </div>

        {/* Price */}
        {listing.price != null && (
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-slate-900">
              ₪{Number(listing.price).toLocaleString('he-IL')}
            </span>
            {listing.price_unit && (
              <span className="text-xs text-slate-500">{PRICE_UNIT_HE[listing.price_unit] ?? listing.price_unit}</span>
            )}
          </div>
        )}
        {listing.price_unit === 'negotiable' && !listing.price && (
          <span className="text-sm font-medium text-slate-600">מחיר למשא ומתן</span>
        )}

        {/* Corporation footer */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500 truncate">{listing.corporation_name}</span>
          {listing.is_corporation_verified && (
            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="h-2.5 w-2.5" />
              מאומת
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
