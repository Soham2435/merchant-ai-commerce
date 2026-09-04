import { createClient } from "@/lib/supabase/server";
import { BuyerShell } from "./buyer-shell";

export default async function BuyerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <BuyerShell signedIn={false} products={[]} />;
  }

  const { data: memberships } = await supabase
    .from("merchant_members")
    .select("merchant_id")
    .eq("user_id", user.id);
  const merchantId = memberships?.length === 1 ? memberships[0].merchant_id : null;
  const { data: authorization } = await supabase
    .from("buyer_spending_authorizations")
    .select("max_amount_minor, currency")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: products } = merchantId
    ? await supabase.from("products").select("id, name, description, category, price_minor, currency").eq("merchant_id", merchantId).eq("is_active", true).order("name")
    : { data: [] };

  return <BuyerShell
    signedIn={Boolean(user)}
    products={products ?? []}
    authorization={authorization ? {
      max_amount_minor: Number(authorization.max_amount_minor),
      currency: authorization.currency,
    } : null}
  />;
}