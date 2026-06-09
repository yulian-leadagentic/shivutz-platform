import { Badge, type BadgeProps } from '@/components/ui/badge';

type BadgeVariant = BadgeProps['variant'];

interface StatusConfig {
  label: string;
  variant: BadgeVariant;
}

// QA-R5: SINGLE SOURCE OF TRUTH for deal/proposal/org status
// labels + colours. The cross-app palette is:
//
//   BLUE   (sky)    → ממתינות לתאגיד          (proposed)
//   YELLOW          → ממתינות לאישורך         (corp_committed)
//   ORANGE          → התקשרות אושרה           (approved+running)
//   GREEN  (success)→ נסגרה                  (closed / completed)
//   RED  (destructive) → לא נסגרה            (cancelled / rejected)
//   PURPLE (navy)   → במחלוקת                 (disputed)
//
// All three deal-status surfaces (admin dashboard, /admin/deals,
// /admin/deals/[id], /contractor/deals, /corporation/deals,
// OrgSummaryHeader) MUST go through StatusBadge so the language and
// colour story stays consistent. Pre-tonight every page had a
// hand-rolled mini-map and they had drifted into 3 different Hebrew
// labels for the same status ("הצעה נשלחה" vs "הצעה נכנסה" vs
// "הוצע") and 3 different colour stories (sky vs slate vs primary).

// Default labels — written from the contractor / admin / neutral
// point of view. The corporation page passes perspective="corporation"
// to override entries that read awkwardly from the corp's own screen.
const STATUS_MAP: Record<string, StatusConfig> = {
  // ── Job request statuses ─────────────────────────────────────
  open:               { label: 'פתוח',           variant: 'sky' },
  draft:              { label: 'טיוטה',          variant: 'secondary' },
  matched:            { label: 'מותאם',          variant: 'purple' },
  in_negotiation:     { label: 'במשא ומתן',      variant: 'yellow' },
  fulfilled:          { label: 'הושלם',          variant: 'success' },
  cancelled:          { label: 'בוטל',           variant: 'destructive' },

  // ── Deal / proposal statuses ────────────────────────────────
  // BLUE — request sent to corp, no commitment yet.
  proposed:           { label: 'ממתין לאישור התאגיד', variant: 'sky' },
  counter_proposed:   { label: 'הצעה נגדית',         variant: 'sky' },

  // YELLOW — corp committed workers, contractor must act.
  corp_committed:     { label: 'ממתין לאישורך',      variant: 'yellow' },

  // ORANGE — contractor approved; engagement is running off-platform.
  // The four backend statuses below are the same UX bucket from the
  // user's perspective and product asked for the consolidated label
  // "התקשרות אושרה" instead of the historical mix.
  approved:           { label: 'התקשרות אושרה',      variant: 'orange' },
  accepted:           { label: 'התקשרות אושרה',      variant: 'orange' },
  active:             { label: 'התקשרות אושרה',      variant: 'orange' },
  reporting:          { label: 'התקשרות אושרה',      variant: 'orange' },

  // GREEN — work delivered, contractor confirmed close.
  completed:          { label: 'נסגרה',             variant: 'success' },
  closed:             { label: 'נסגרה',             variant: 'success' },

  // RED — terminated states.
  disputed:           { label: 'במחלוקת',           variant: 'purple' },
  rejected:           { label: 'לא נסגרה',          variant: 'destructive' },
  cancelled_by_corp:  { label: 'בוטל ע״י תאגיד',    variant: 'destructive' },
  cancelled_by_contractor: { label: 'לא נסגרה',     variant: 'destructive' },
  expired:            { label: 'פג תוקף',           variant: 'destructive' },

  // ── Org approval statuses ───────────────────────────────────
  pending:            { label: 'ממתין לאישור',      variant: 'yellow' },
  approved_org:       { label: 'מאושר',             variant: 'success' }, // namespaced — 'approved' alone is deal-side
};

// Corp-screen overrides. Only override statuses that read awkwardly
// when the corp is looking at its own deal; everything else falls
// through to STATUS_MAP.
const CORPORATION_OVERRIDES: Record<string, StatusConfig> = {
  // Corp has already committed workers — from the corp's own POV
  // the deal is now sitting on the contractor's desk for approval.
  corp_committed:    { label: 'ממתין לאישור קבלן', variant: 'yellow' },
  // Corp cancelled their own deal — "by the corp" is impersonal.
  cancelled_by_corp: { label: 'בוטלה על ידך',       variant: 'destructive' },
};

type Perspective = 'contractor' | 'corporation' | 'admin';

interface StatusBadgeProps {
  status: string;
  className?: string;
  /** Whose screen is rendering this. Switches labels that are
   *  written in third-person to a first-person variant on the
   *  matching side. Defaults to the neutral / contractor labels. */
  perspective?: Perspective;
}

export default function StatusBadge({ status, className, perspective }: StatusBadgeProps) {
  const override = perspective === 'corporation' ? CORPORATION_OVERRIDES[status] : undefined;
  const config = override ?? STATUS_MAP[status] ?? { label: status, variant: 'secondary' as BadgeVariant };
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}

/** Public helper for surfaces that can't use the JSX badge (e.g.
 *  hand-built classes on table cells). Returns the resolved label +
 *  variant so callers stay in sync with the canonical map. */
export function resolveStatus(
  status: string,
  perspective?: Perspective,
): StatusConfig {
  const override = perspective === 'corporation' ? CORPORATION_OVERRIDES[status] : undefined;
  return override ?? STATUS_MAP[status] ?? { label: status, variant: 'secondary' };
}
