import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";

const metrics = [
  { label: "Gross sales", value: "$24,680", detail: "+12.4% from last month", tone: "positive" },
  { label: "Orders", value: "384", detail: "+8.1% from last month", tone: "positive" },
  { label: "Customers", value: "1,248", detail: "+5.6% from last month", tone: "positive" },
  { label: "Conversion rate", value: "3.8%", detail: "Across your storefront" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="A clear view of the activity shaping your store."
        action={<span className="text-xs font-medium text-[var(--muted)]">Demo workspace</span>}
      />
      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => <StatCard key={metric.label} {...metric} />)}
      </section>
      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border bg-[var(--surface)] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-[var(--foreground)]">Recent activity</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Your latest commerce events will appear here.</p>
            </div>
            <span className="text-xs font-medium text-[var(--muted)]">Last 30 days</span>
          </div>
          <div className="mt-8 border-t border-dashed pt-8 text-sm text-[var(--muted)]">No activity loaded yet.</div>
        </div>
        <EmptyState
          title="Insights are getting ready"
          description="Once your store data is connected, this space will surface useful patterns and opportunities."
          label="AI Insights"
        />
      </section>
    </div>
  );
}
