import { createClient } from "@/lib/supabase/server";
import { writeAgentAudit } from "@/lib/agent-audit";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_REASONS = new Set([
  "checkout_cancelled",
  "payment_failed",
  "checkout_unavailable",
  "checkout_error",
]);

function errorResponse(message, status) {
  return Response.json({ success: false, message }, { status });
}

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return errorResponse("Authentication is required.", 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!UUID_PATTERN.test(orderId) || !ALLOWED_REASONS.has(reason)) {
    return errorResponse("A valid order_id and checkout failure reason are required.", 400);
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("merchant_members")
    .select("merchant_id")
    .eq("user_id", user.id);
  if (membershipError) return errorResponse("We could not verify your merchant workspace.", 500);
  if (!memberships || memberships.length !== 1) return errorResponse("One merchant workspace is required.", 403);

  const merchantId = memberships[0].merchant_id;
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, total_minor, currency, razorpay_order_id")
    .eq("id", orderId)
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (orderError) return errorResponse("We could not load the order.", 500);
  if (!order) return errorResponse("Order not found.", 404);
  if (order.status !== "pending") return errorResponse("Checkout failure can only be recorded for a pending order.", 409);

  try {
    await writeAgentAudit({
      merchantId,
      eventType: "checkout_failed",
      actor: "buyer_checkout",
      payload: {
        order_id: order.id,
        total_minor: Number(order.total_minor),
        currency: order.currency,
        razorpay_order_id: order.razorpay_order_id,
        reason,
        order_status: order.status,
      },
      result: "not_verified",
    });
  } catch {
    return errorResponse("The checkout failure could not be recorded.", 500);
  }

  return Response.json({ success: true });
}