import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import RoleGuard from '@/components/layout/RoleGuard';
import { KablanVerifyBanner } from '@/components/contractor/KablanVerifyBanner';
import { FreeLaunchBanner } from '@/components/shared/FreeLaunchBanner';

export default function ContractorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard expect="contractor">
      <div className="flex min-h-screen bg-slate-50">
        {/* Desktop sidebar — hidden below lg; the hamburger in TopBar exposes
            the same component inside a slide-over drawer for mobile. */}
        <div className="hidden lg:block">
          <Sidebar />
        </div>

        {/* Main content area */}
        <div className="flex flex-col flex-1 min-w-0">
          <TopBar mobileNav={<Sidebar />} />
          <main className="flex-1 p-4 sm:p-6 overflow-auto">
            <FreeLaunchBanner />
            {/* Sits above every contractor screen — nudges users who
                haven't passed the kablan match yet, and surfaces the
                "pending admin review" state for mismatched submissions.
                Self-hides once kablan_verified_at is set. */}
            <KablanVerifyBanner />
            {children}
          </main>
        </div>
      </div>
    </RoleGuard>
  );
}
