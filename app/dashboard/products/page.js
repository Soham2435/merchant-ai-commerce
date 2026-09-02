import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export default async function ProductsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Catalog"
          title="Products"
          description="Keep your catalog organized and ready for your customers."
        />
        <EmptyState
          title="Sign in required"
          description="Sign in to view your product catalog."
          label="Authentication"
        />
      </div>
    );
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("merchant_members")
    .select("merchant_id, role")
    .eq("user_id", user.id)
    .limit(10);

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  const merchantIds =
    memberships?.map((membership) => membership.merchant_id) ?? [];

  if (merchantIds.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Catalog"
          title="Products"
          description="Keep your catalog organized and ready for your customers."
        />
        <EmptyState
          title="No merchant workspace found"
          description="Your account is not connected to a merchant workspace yet."
          label="Merchant setup"
        />
      </div>
    );
  }

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select(
      "id, name, description, category, price_minor, currency, is_active, sku, created_at"
    )
    .in("merchant_id", merchantIds)
    .order("created_at", { ascending: false });

  if (productsError) {
    throw new Error(productsError.message);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Catalog"
        title="Products"
        description="Keep your catalog organized and ready for your customers."
      />

      {products.length === 0 ? (
        <EmptyState
          title="Your product catalog is empty"
          description="No products have been added to this merchant workspace yet."
          label="0 products"
        />
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-[var(--surface)]">
          <div className="border-b px-6 py-5">
            <p className="text-sm font-medium text-[var(--muted)]">
              {products.length} product{products.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="divide-y">
            {products.map((product) => (
              <article
                key={product.id}
                className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <h2 className="font-semibold text-[var(--foreground)]">
                    {product.name}
                  </h2>

                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                    {product.sku ? <span>SKU: {product.sku}</span> : null}
                    {product.category ? <span>{product.category}</span> : null}
                    <span>{product.is_active ? "Active" : "Inactive"}</span>
                  </div>
                </div>

                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {product.currency}{" "}
                  {(product.price_minor / 100).toFixed(2)}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
