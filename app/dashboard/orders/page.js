import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default async function OrdersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Operations"
          title="Orders"
          description="Review completed purchases from your AI commerce flow."
        />
        <EmptyState
          title="Sign in required"
          description="Sign in to review completed orders."
          label="Authentication"
        />
      </div>
    );
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("merchant_members")
    .select("merchant_id")
    .eq("user_id", user.id);

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  if (!memberships || memberships.length !== 1) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Operations"
          title="Orders"
          description="Review completed purchases from your AI commerce flow."
        />
        <EmptyState
          title="One merchant workspace is required"
          description="Your account must be connected to exactly one merchant workspace."
          label="Merchant setup"
        />
      </div>
    );
  }

  const merchantId = memberships[0].merchant_id;

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, total_minor, currency, status, created_at")
    .eq("merchant_id", merchantId)
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(20);

  if (ordersError) {
    throw new Error(ordersError.message);
  }

  const paidOrders = (orders ?? []).map((order) => ({
    id: order.id,
    totalMinor: Number(order.total_minor),
    currency: order.currency,
    status: order.status,
    createdAt: order.created_at,
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Operations"
        title="Orders"
        description="Review completed purchases from your AI commerce flow."
        action={
          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-dark)]">
            Server-authoritative totals
          </span>
        }
      />

      {paidOrders.length === 0 ? (
        <EmptyState
          title="No paid orders yet"
          description="Completed orders will appear here after payment is verified."
          label="0 paid orders"
        />
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-[var(--surface)]">
          <div className="border-b px-6 py-5">
            <p className="text-sm font-medium text-[var(--muted)]">
              {paidOrders.length} paid order{paidOrders.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="divide-y">
            {paidOrders.map((order) => (
              <article
                key={order.id}
                className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-[var(--foreground)]">{order.id}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {formatDate(order.createdAt)}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {formatMoney(order.totalMinor, order.currency)}
                  </p>
                  <p className="mt-1 text-xs font-medium capitalize text-[var(--accent-dark)]">
                    {order.status}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function formatMoney(minor, currency) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
