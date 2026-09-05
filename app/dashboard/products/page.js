import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateProductForm } from "./create-product-form";
import { ProductList } from "./product-list";

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

  const { data: merchants, error: merchantsError } = await supabase
    .from("merchants")
    .select("id, currency")
    .in("id", merchantIds);

  if (merchantsError) {
    throw new Error(merchantsError.message);
  }

  const currency = merchants?.[0]?.currency ?? "INR";

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select(
      "id, name, description, category, price_minor, currency, is_active, sku,created_at"
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

      <CreateProductForm currency={currency} />

      {products.length === 0 ? (
        <EmptyState
          title="Your product catalog is empty"
          description="No products have been added to this merchant workspace yet."
          label="0 products"
        />
      ) : <ProductList products={products} />}
    </div>
  );
}
