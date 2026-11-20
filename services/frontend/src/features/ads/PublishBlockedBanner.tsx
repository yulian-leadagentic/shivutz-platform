'use client';

import Link from 'next/link';
import { AlertTriangle, CreditCard } from 'lucide-react';
import { ApiError } from '@/lib/api/client';

export type PublishBlock =
  | { kind: 'ad_limit'; limit: number | null }
  | { kind: 'subscription' };

export function publishBlockOf(e: unknown): PublishBlock | null {
  if (!(e instanceof ApiError)) return null;
  const details = e.cause?.details as { code?: string } | undefined;
  const code = details?.code || e.cause?.error || e.cause?.code;
  if (code === 'tier_active_ad_limit') {
    return { kind: 'ad_limit', limit: typeof e.cause.limit === 'number' ? e.cause.limit : null };
  }
  if (code === 'subscription_required') return { kind: 'subscription' };
  return null;
}

function copyFor(block: PublishBlock) {
  if (block.kind === 'subscription') {
    return {
      title: 'המנוי שלך אינו פעיל',
      body:  'כדי לפרסם מודעות יש לחדש את המנוי. אחרי החידוש אפשר לפרסם את המודעה הזו.',
      cta:   'לחידוש המנוי',
    };
  }
  return {
    title: 'הגעת למכסת המודעות הפעילות במסלול שלך',
    body:  block.limit
      ? `במסלול שלך אפשר עד ${block.limit} מודעות פעילות. שדרג את המנוי כדי לפרסם את המודעה הזו. השדרוג חל מיד.`
      : 'שדרג את המנוי כדי לפרסם את המודעה הזו. השדרוג חל מיד.',
    cta:   'שדרג מנוי',
  };
}

export function PublishBlockedBanner({ block }: { block: PublishBlock }) {
  const copy = copyFor(block);
  return (
    <div role="alert" className="flex flex-col sm:flex-row sm:items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3 flex-1">
        <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" aria-hidden />
        <div>
          <h3 className="font-semibold text-amber-900">{copy.title}</h3>
          <p className="text-sm text-amber-800 mt-0.5">{copy.body}</p>
        </div>
      </div>
      <Link
        href="/billing"
        className="shrink-0 self-start inline-flex items-center gap-1.5 bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold px-3 py-2 rounded-lg"
      >
        <CreditCard className="w-4 h-4" aria-hidden /> {copy.cta}
      </Link>
    </div>
  );
}
