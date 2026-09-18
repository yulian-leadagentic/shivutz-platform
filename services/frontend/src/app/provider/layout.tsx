import RoleGuard from '@/components/layout/RoleGuard';

// R5 §1 · guard the whole /provider/* tree so contractor / corporation
// users cannot reach a provider-scoped page just by typing the URL.
// Kept intentionally chrome-free — the dashboard renders its own
// header, and /provider/marketplace/new inherits its own form chrome.
export default function ProviderLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard expect="provider">{children}</RoleGuard>;
}
