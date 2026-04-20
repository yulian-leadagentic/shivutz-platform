'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Search, Loader2, Home, Wrench, Briefcase, MoreHorizontal,
  Building2, Filter, X,
} from 'lucide-react';
import { marketplaceApi, enumApi } from '@/lib/api';
import type { MarketplaceListing } from '@/types';
import ListingCard from '@/components/marketplace/ListingCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const CATEGORIES = [
  { value: '', label: 'הכל', icon: Filter },
  { value: 'housing', label: 'דיור', icon: Home },
  { value: 'equipment', label: 'ציוד', icon: Wrench },
  { value: 'services', label: 'שירותים', icon: Briefcase },
  { value: 'other', label: 'אחר', icon: MoreHorizontal },
];

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse">
      <div className="h-1.5 bg-slate-200" />
      <div className="p-4 space-y-3">
        <div className="h-5 bg-slate-200 rounded-full w-24" />
        <div className="h-4 bg-slate-200 rounded w-full" />
        <div className="h-4 bg-slate-200 rounded w-3/4" />
        <div className="h-6 bg-slate-200 rounded w-1/3" />
        <div className="h-px bg-slate-100" />
        <div className="h-3 bg-slate-200 rounded w-1/2" />
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading]   = useState(true);
  const [regions, setRegions]   = useState<{ code: string; name_he: string }[]>([]);

  const [category, setCategory] = useState('');
  const [region, setRegion]     = useState('');
  const [search, setSearch]     = useState('');
  const [searchInput, setSearchInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await marketplaceApi.list({
        category: category || undefined,
        region:   region   || undefined,
        search:   search   || undefined,
      });
      setListings(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [category, region, search]);

  useEffect(() => {
    load();
    enumApi.regions().then(setRegions).catch(() => {});
  }, [load]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  function clearFilters() {
    setCategory('');
    setRegion('');
    setSearch('');
    setSearchInput('');
  }

  const hasFilters = category || region || search;

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      {/* Top nav bar */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="text-2xl font-bold text-brand-600 shrink-0">שיבוץ</Link>
          <form onSubmit={handleSearch} className="flex-1 max-w-md flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <Input
                placeholder="חפש מודעות..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="ps-9 h-9"
              />
            </div>
            <Button type="submit" size="sm" className="h-9">חיפוש</Button>
          </form>
          <div className="hidden sm:flex items-center gap-3">
            <Link href="/login" className="text-sm text-slate-600 hover:text-slate-900">כניסה</Link>
            <Link href="/register/corporation">
              <Button size="sm">פרסם מודעה</Button>
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">שוק לעובדים זרים</h1>
          <p className="text-slate-500 mt-1 text-sm">דיור, ציוד ושירותים לתאגידי כוח אדם וקבלנים</p>
        </div>

        {/* Category filter tabs */}
        <div className="flex flex-wrap gap-2 mb-5">
          {CATEGORIES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setCategory(value)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                category === value
                  ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300 hover:text-brand-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}

          {/* Region select */}
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="px-4 py-2 rounded-full text-sm font-medium border border-slate-200 bg-white text-slate-600 focus:outline-none focus:border-brand-300 h-[38px]"
          >
            <option value="">כל האזורים</option>
            {regions.map((r) => (
              <option key={r.code} value={r.code}>{r.name_he}</option>
            ))}
          </select>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              נקה פילטרים
            </button>
          )}
        </div>

        {/* Results count */}
        {!loading && (
          <p className="text-sm text-slate-500 mb-4">
            {listings.length === 0 ? 'לא נמצאו מודעות' : `${listings.length} מודעות`}
          </p>
        )}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-20">
            <Building2 className="h-16 w-16 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-600 font-medium">לא נמצאו מודעות</p>
            <p className="text-slate-400 text-sm mt-1">נסה לשנות את הפילטרים</p>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-4 text-sm text-brand-600 underline">נקה פילטרים</button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </div>

      {/* Post CTA banner */}
      <div className="bg-brand-600 mt-16">
        <div className="max-w-4xl mx-auto px-6 py-10 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">יש לך דירה לתאגיד?</h2>
          <p className="text-brand-200 mb-6">תאגידים רשומים מפרסמים ללא עלות</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/register/corporation">
              <Button className="bg-white text-brand-700 hover:bg-brand-50 font-semibold">
                הירשם כתאגיד
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" className="border-white text-white hover:bg-brand-700">
                כניסה לחשבון קיים
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
