import type { AudienceRole, CtaIntent } from './types';

// Resolves an abstract CTA intent ("post a requirement") into the
// concrete button label + href for the audience currently looking at
// the feed. Anonymous visitors always route through /login or
// /register/<role> so the CTA is honest about the auth step.

export interface ResolvedCta {
  label: string;
  href: string;
  /** If true, the view hides the CTA entirely for this role (e.g. a
   *  corporation user being shown "post requirement"). */
  hidden?: boolean;
}

type Resolver = (role: AudienceRole) => ResolvedCta | null;

// Landing hash — jumps to (and scrolls to) the search hero section
// so the CTA feels responsive even when the user is already on `/`.
// Bare `/` used to make the popup CTA a no-op click when the visitor
// was already on the landing page (browser routes same-path
// navigation to nothing visible). See QA-2.
const LANDING_SEARCH = '/?focus=search#search-hero';

const RESOLVERS: Record<CtaIntent, Resolver> = {
  check_match: (role) => {
    if (role === 'contractor')   return { label: 'חפש עובדים', href: LANDING_SEARCH };
    if (role === 'corporation')  return { label: 'המודעות שלי', href: '/corporation/ads' };
    return { label: 'חפש עובדים', href: LANDING_SEARCH };
  },
  see_requirements: (role) => {
    if (role === 'contractor')   return { label: 'בקשות ייבוא', href: '/contractor/tenders' };
    if (role === 'corporation')  return { label: 'בקשות ייבוא', href: '/corporation/tenders' };
    return { label: 'הירשם וצפה', href: '/register/contractor' };
  },
  see_housing: () => ({ label: 'ראה מגורים', href: '/?category=housing' }),
  post_requirement: (role) => {
    // Contractors post a "worker request" via the tender flow now
    // (post-pivot: /contractor/tenders/new is the request builder).
    if (role === 'contractor')   return { label: 'פרסם בקשה', href: '/contractor/tenders/new' };
    if (role === 'corporation')  return { label: '', href: '', hidden: true };
    return { label: 'הירשם וצפה', href: '/register/contractor' };
  },
  see_services: () => ({ label: 'ראה שירותים', href: '/marketplace' }),
  post_availability: (role) => {
    if (role === 'corporation')  return { label: 'פרסם זמינות', href: '/corporation/workers/new' };
    // Contractor users get no "post availability" CTA — not their flow.
    if (role === 'contractor')   return { label: '', href: '', hidden: true };
    return { label: 'הירשם', href: '/register/corporation' };
  },
};

export function resolveCta(intent: CtaIntent, role: AudienceRole): ResolvedCta {
  const r = RESOLVERS[intent];
  return r ? (r(role) ?? { label: '', href: '', hidden: true })
           : { label: '', href: '', hidden: true };
}
