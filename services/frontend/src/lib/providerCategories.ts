// R33 B · which categories a service provider can hold a plan in, and
// which plans it can pick. One place, because three screens ask: the
// sign-up page, the "add a category" page and the listing form.
//
// The server is the authority (services/user-org/app/services/
// provider_plans.py holds the same two rules and enforces them). This
// file only keeps the screens from offering what the server refuses.

import type { CatalogCategory, CatalogTier } from '@/lib/api/marketplaceSubscriptions';

// Housing is published by corporations and rides their licence. Worker
// ads are not marketplace listings. A provider can publish in neither,
// so a plan there would buy nothing.
const PROVIDER_BLOCKED_CATEGORIES = ['housing', 'worker'];

export function isProviderCategory(code: string): boolean {
  return !PROVIDER_BLOCKED_CATEGORIES.includes(code);
}

/** The plans a provider may pick in a category: the catalog already
 *  holds only active ones, and a price of 0 marks an admin override
 *  that no picker offers. Kept in the catalog's order, which is the
 *  order the admin gave them. */
export function paidTiers(category: Pick<CatalogCategory, 'tiers'>): CatalogTier[] {
  return (category.tiers ?? [])
    .filter((t) => Number(t.price_nis) > 0)
    .map((t) => ({ ...t, price_nis: Number(t.price_nis) }));
}
