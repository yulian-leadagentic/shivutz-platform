import CorporationSidebar from '@/components/layout/CorporationSidebar';
import TopBar from '@/components/layout/TopBar';

export default function CorporationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <CorporationSidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
