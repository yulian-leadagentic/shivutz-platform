import { Badge, type BadgeProps } from '@/components/ui/badge';

type BadgeVariant = BadgeProps['variant'];

interface StatusConfig {
  label: string;
  variant: BadgeVariant;
}

// Default labels — written from the contractor / admin / neutral
// point of view. The corporation page passes perspective="corporation"
// to override the entries that read as third-person from the corp's
// own screen (e.g. "תאגיד הגיב" makes sense to a contractor reading
// "the other side responded" — not to a corp reading about itself).
const STATUS_MAP: Record<string, StatusConfig> = {
  // Job request statuses
  open:               { label: 'פתוח',           variant: 'default' },
  draft:              { label: 'טיוטה',          variant: 'secondary' },
  matched:            { label: 'מותאם',          variant: 'purple' },
  in_negotiation:     { label: 'במשא ומתן',      variant: 'warning' },
  fulfilled:          { label: 'הושלם',          variant: 'success' },
  cancelled:          { label: 'בוטל',           variant: 'destructive' },

  // Deal / proposal statuses
  proposed:           { label: 'הוצע',           variant: 'default' },
  corp_committed:     { label: 'תאגיד הגיב',     variant: 'warning' },
  counter_proposed:   { label: 'הצעה נגדית',     variant: 'warning' },
  accepted:           { label: 'אושר',           variant: 'success' },
  active:             { label: 'פעיל',           variant: 'success' },
  reporting:          { label: 'בדיווח',         variant: 'warning' },
  completed:          { label: 'הסתיים',         variant: 'success' },
  closed:             { label: 'סגור',           variant: 'success' },
  disputed:           { label: 'במחלוקת',        variant: 'destructive' },
  rejected:           { label: 'נדחה',           variant: 'destructive' },
  cancelled_by_corp:  { label: 'בוטל ע״י תאגיד', variant: 'destructive' },
  cancelled_by_contractor: { label: 'לא נסגרה',  variant: 'secondary' },
  expired:            { label: 'פג תוקף',        variant: 'destructive' },

  // Org approval statuses
  pending:            { label: 'ממתין לאישור',   variant: 'warning' },
  approved:           { label: 'מאושר',          variant: 'success' },
};

// Corp-screen overrides. Only override statuses that read awkwardly
// when the corp is looking at its own deal; everything else falls
// through to STATUS_MAP.
const CORPORATION_OVERRIDES: Record<string, StatusConfig> = {
  // Corp has already committed workers — from the corp's own POV
  // the deal is now sitting on the contractor's desk for approval.
  corp_committed:    { label: 'ממתין לאישור קבלן', variant: 'warning' },
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
