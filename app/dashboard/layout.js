import { MobileNavigation, Sidebar } from "@/components/dashboard/navigation";
import { TopBar } from "@/components/dashboard/top-bar";

export default function DashboardLayout({ children }) {
  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <TopBar />
        <MobileNavigation />
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
