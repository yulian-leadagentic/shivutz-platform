'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import ListingDetailPanel from '@/components/marketplace/ListingDetailPanel';
import { SponsorProvider } from '@/features/advertising/MarketplaceSponsors';

// R32 S5.1 · the body of this page now lives in
// components/marketplace/ListingDetailPanel so the home page can open
// the same listing without a navigation. What stays here is the page
// chrome: the route, its header bar, and the SponsorProvider the two
// listing slots dedupe against (R30 §12b — without it an advertiser
// who bought both listing_rail and listing_inline would appear twice
// on one page).
//
// R32 S6.3 · the route is kept as a redirect target. D2 sends
// /marketplace/[id] to /?type=services&listing=[id], so in normal use
// nobody lands here — but a bookmark, an old email link or a crawler
// still resolves, and this page still renders the listing.

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  return (
    <SponsorProvider>
      <div className="min-h-screen bg-slate-50">
        {/* Header bar */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
            <button
              onClick={() => router.back()}
              aria-label="חזרה"
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <Link href="/?type=services" className="text-sm text-slate-500 hover:text-brand-800 transition-colors">
              שירותים נלווים
            </Link>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-8">
          <ListingDetailPanel listingId={id} />
        </main>
      </div>
    </SponsorProvider>
  );
}
