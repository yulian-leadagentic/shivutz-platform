import RoleGuard from '@/components/layout/RoleGuard';
import ProviderShell from '@/components/provider/ProviderShell';

// R5 §1 · guard the whole /provider/* tree so contractor / corporation
// users cannot reach a provider-scoped page just by typing the URL.
// R34 §4a · the shell goes inside the guard, so a visitor the guard
// turns away sees its card and not a provider top bar around it.
export default function ProviderLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard expect="provider">
      <ProviderShell>{children}</ProviderShell>
    </RoleGuard>
  );
}
