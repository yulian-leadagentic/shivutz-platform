import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';

export default function ContractorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar — in RTL appears on the right (start side) */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
