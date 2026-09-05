"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Products", href: "/dashboard/products" },
  { label: "Orders", href: "/dashboard/orders" },
  { label: "Customers", href: "/dashboard/customers" },
  { label: "AI Activity", href: "/dashboard/ai-insights" },
  { label: "Settings", href: "/dashboard/settings" },
];

function isActive(pathname, href) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

export function Navigation({ mobile = false }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className={mobile ? "flex gap-2 overflow-x-auto pb-1" : "space-y-1"}>
      {navigation.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={mobile
              ? `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"}`
              : `block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]" : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-[var(--surface)] px-5 py-6 lg:block">
      <Link href="/dashboard" className="flex items-center gap-3 px-2 text-sm font-semibold text-[var(--accent-dark)]">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-lg text-white">M</span>
        Merchant AI
      </Link>
      <div className="mt-12">
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Workspace</p>
        <Navigation />
      </div>
    </aside>
  );
}

export function MobileNavigation() {
  return (
    <div className="border-b bg-[var(--surface)] px-4 py-3 lg:hidden">
      <Navigation mobile />
    </div>
  );
}
