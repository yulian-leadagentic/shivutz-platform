import CorporationSidebar from '@/components/layout/CorporationSidebar';
import TopBar from '@/components/layout/TopBar';
import RoleGuard from '@/components/layout/RoleGuard';
import { FreeLaunchBanner } from '@/components/shared/FreeLaunchBanner';

export default function CorporationLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard expect="corporation">
      <div className="flex min-h-screen bg-slate-50">
        <div className="hidden lg:block">
          <CorporationSidebar />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <TopBar mobileNav={<CorporationSidebar />} />
          <main className="flex-1 p-4 sm:p-6 overflow-auto">
            <FreeLaunchBanner />
            {children}
          </main>
        </div>
      </div>
    </RoleGuard>
  );
}
