import { Badge, type BadgeProps } from '@/components/ui/badge';

type BadgeVariant = BadgeProps['variant'];

interface StatusConfig {
  label: string;
  variant: BadgeVariant;
}

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

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_MAP[status] ?? { label: status, variant: 'secondary' as BadgeVariant };
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
