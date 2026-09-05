import { createClient } from "@/lib/supabase/server";
import { BuyerShell } from "./buyer-shell";

export default async function BuyerPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <BuyerShell signedIn={false} />;
  }

  const { data: membership } = await supabase
    .from("merchant_members")
    .select("merchant_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership?.merchant_id) {
    return <BuyerShell signedIn={true} merchantContext={null} />;
  }

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id, name, transaction_limit_minor, currency")
    .eq("id", membership.merchant_id)
    .maybeSingle();

  const { data: authorization } = await supabase
    .from("buyer_spending_authorizations")
    .select("max_amount_minor, currency")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: buyerOrders, error: buyerOrdersError } = await supabase
    .from("orders")
    .select(
      "id, merchant_id, status, total_minor, currency, razorpay_order_id, razorpay_payment_id, approved_at, created_at"
    )
    .eq("buyer_user_id", user.id)
    .in("status", ["pending", "paid"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (buyerOrdersError) {
    console.error("Buyer orders lookup failed", {
      code: buyerOrdersError.code ?? "unknown",
      status: buyerOrdersError.status ?? "unknown",
      message: buyerOrdersError.message ?? "unknown",
    });
  }

  return (
    <BuyerShell
      signedIn={true}
      merchantContext={
        merchant
          ? {
              id: merchant.id,
              name: merchant.name,
              transaction_limit_minor:
                merchant.transaction_limit_minor === null
                  ? null
                  : Number(merchant.transaction_limit_minor),
              currency: merchant.currency,
            }
          : null
      }
      authorization={
        authorization
          ? {
              max_amount_minor: Number(authorization.max_amount_minor),
              currency: authorization.currency,
            }
          : null
      }
      pendingOrders={(buyerOrders ?? []).map((buyerOrder) => ({
        ...buyerOrder,
        total_minor: Number(buyerOrder.total_minor),
      }))}
    />
  );
}