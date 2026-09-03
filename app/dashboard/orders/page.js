import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { OrderConstructor, RecentPendingOrders } from "./order-constructor";

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
          description="Build a pending order from your active catalog."
        />
        <EmptyState
          title="Sign in required"
          description="Sign in to create and review orders."
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
          description="Build a pending order from your active catalog."
        />
        <EmptyState
          title="One merchant workspace is required"
          description="Order construction currently supports exactly one merchant workspace per account."
          label="Merchant setup"
        />
      </div>
    );
  }

  const merchantId = memberships[0].merchant_id;

  const [productsResult, ordersResult] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, price_minor, currency")
      .eq("merchant_id", merchantId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("orders")
      .select("id, total_minor, currency, status, created_at")
      .eq("merchant_id", merchantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (productsResult.error) {
    throw new Error(productsResult.error.message);
  }

  if (ordersResult.error) {
    throw new Error(ordersResult.error.message);
  }

  const products = (productsResult.data ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    priceMinor: Number(product.price_minor),
    currency: product.currency,
  }));

  const recentOrders = (ordersResult.data ?? []).map((order) => ({
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
        description="Build a pending order from your active catalog."
        action={
          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-dark)]">
            Server-authoritative totals
          </span>
        }
      />

      {products.length === 0 ? (
        <div className="space-y-6">
          <EmptyState
            title="No active products yet"
            description="Add an active product to your catalog before constructing an order."
            label="Catalog empty"
          />
          <RecentPendingOrders recentOrders={recentOrders} />
        </div>
      ) : (
        <OrderConstructor products={products} recentOrders={recentOrders} />
      )}
    </div>
  );
}
