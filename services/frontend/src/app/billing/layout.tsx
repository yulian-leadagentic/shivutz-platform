'use client';

// Pivot/v2 — /billing sits at the app root (not under /contractor or
// /corporation), but users still want the role sidebar so they can
// navigate back. Pick the sidebar dynamically from the JWT's
// entity_type. Falls back to no chrome for edge cases (admin, no entity
// yet, mid-invite) — the page's own back-button still works.

import { useAuth } from '@/lib/AuthContext';
import Sidebar from '@/components/layout/Sidebar';
import CorporationSidebar from '@/components/layout/CorporationSidebar';
import TopBar from '@/components/layout/TopBar';

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  const { entityType } = useAuth();
  const SidebarEl = entityType === 'corporation' ? <CorporationSidebar /> : <Sidebar />;

  if (!entityType) {
    return <main className="min-h-screen bg-slate-50">{children}</main>;
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <div className="hidden lg:block">{SidebarEl}</div>
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar mobileNav={SidebarEl} />
        {/* overflow-auto dropped for QA-4 — body scrolls so TopBar's
            sticky top-0 actually sticks. */}
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
