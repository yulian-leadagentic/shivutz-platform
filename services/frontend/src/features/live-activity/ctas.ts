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

const RESOLVERS: Record<CtaIntent, Resolver> = {
  check_match: (role) => {
    if (role === 'contractor')   return { label: 'בדוק התאמה', href: '/contractor/find' };
    if (role === 'corporation')  return { label: 'בדוק התאמה', href: '/corporation/workers' };
    return { label: 'בדוק התאמה', href: '/login?next=/contractor/find' };
  },
  see_requirements: (role) => {
    if (role === 'contractor')   return { label: 'ראה דרישות', href: '/contractor/deals' };
    if (role === 'corporation')  return { label: 'ראה דרישות', href: '/corporation/tenders' };
    return { label: 'הירשם וצפה', href: '/register/contractor' };
  },
  see_housing: () => ({ label: 'ראה מגורים', href: '/marketplace?cat=housing' }),
  post_requirement: (role) => {
    if (role === 'contractor')   return { label: 'פרסם דרישה', href: '/contractor/find' };
    // Corp users get no "post requirement" CTA — not their flow.
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
