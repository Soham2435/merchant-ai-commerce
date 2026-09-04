import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { writeAgentAudit } from "@/lib/agent-audit";

export const runtime = "nodejs";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(message, status) { return Response.json({ success: false, message }, { status }); }

function getIdempotencyKey(items) {
  const canonicalItems = [...items]
    .sort((left, right) => left.product_id.localeCompare(right.product_id))
    .map((item) => `${item.product_id}:${item.quantity}`)
    .join(",");
  return createHash("sha256").update(canonicalItems).digest("hex");
}

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse("Authentication is required.", 401);

  let body;
  try { body = await request.json(); } catch { return errorResponse("Request body must be valid JSON.", 400); }
  const requestedItems = body?.items;
  if (!Array.isArray(requestedItems) || requestedItems.length === 0 || requestedItems.length > 100) {
    return errorResponse("Choose between 1 and 100 products.", 400);
  }

  const productIds = new Set();
  for (const item of requestedItems) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !UUID_PATTERN.test(item.product_id) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000 || productIds.has(item.product_id.toLowerCase())) {
      return errorResponse("Each product must have a unique ID and a quantity from 1 to 1,000.", 400);
    }
    productIds.add(item.product_id.toLowerCase());
  }

  const { data: memberships, error: membershipError } = await supabase.from("merchant_members").select("merchant_id").eq("user_id", user.id);
  if (membershipError) return errorResponse("We could not verify your merchant workspace.", 500);
  if (!memberships || memberships.length !== 1) return errorResponse("One merchant workspace is required.", 403);
  const merchantId = memberships[0].merchant_id;

  const { data: products, error: productsError } = await supabase.from("products").select("id, name, price_minor, currency, is_active").eq("merchant_id", merchantId).in("id", [...productIds]);
  if (productsError) return errorResponse("We could not validate the selected products.", 500);
  const productsById = new Map((products ?? []).map((product) => [product.id.toLowerCase(), product]));
  if (productsById.size !== productIds.size || [...productIds].some((id) => !productsById.get(id)?.is_active)) return errorResponse("One or more selected products are no longer active.", 409);

  const items = requestedItems.map((item) => ({ product_id: item.product_id.toLowerCase(), quantity: item.quantity }));
  const currencies = new Set([...productsById.values()].map((product) => product.currency));
  if (currencies.size !== 1) return errorResponse("Selected products must use one currency.", 409);
  const totalMinor = items.reduce((total, item) => total + Number(productsById.get(item.product_id).price_minor) * item.quantity, 0);
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) return errorResponse("The proposed total is outside the supported amount range.", 409);

  const { data: merchant, error: merchantError } = await supabase.from("merchants").select("transaction_limit_minor, currency").eq("id", merchantId).single();
  if (merchantError || !merchant) return errorResponse("We could not load the merchant purchase limit.", 500);
  if (merchant.transaction_limit_minor !== null && totalMinor > Number(merchant.transaction_limit_minor)) {
    try { await writeAgentAudit({ merchantId, eventType: "limit_exceeded", payload: { total_minor: totalMinor, limit_minor: Number(merchant.transaction_limit_minor), currency: merchant.currency ?? [...currencies][0], items }, result: "blocked" }); } catch { return errorResponse("The purchase limit could not be recorded. No order was created.", 500); }
    return Response.json({ success: false, blocked: true, message: `This purchase is ${formatMoney(totalMinor, merchant.currency ?? [...currencies][0])}, above the merchant limit of ${formatMoney(Number(merchant.transaction_limit_minor), merchant.currency ?? [...currencies][0])}. Reduce the quantities or choose fewer items, then propose it again.`, total_minor: totalMinor, limit_minor: Number(merchant.transaction_limit_minor), currency: merchant.currency ?? [...currencies][0] }, { status: 422 });
  }

  try {
    await writeAgentAudit({ merchantId, eventType: "purchase_proposed", payload: { total_minor: totalMinor, currency: [...currencies][0], items }, result: "within_limit" });
  } catch {
    return errorResponse("The purchase could not be audited. No order was created.", 500);
  }

  let orderRows;
  let rpcError;
  try { ({ data: orderRows, error: rpcError } = await supabase.rpc("create_pending_order", { p_merchant_id: merchantId, p_idempotency_key: getIdempotencyKey(items), p_items: items })); } catch { return errorResponse("The order could not be prepared. No payment order was created.", 500); }
  if (rpcError) return errorResponse("The order could not be prepared. No payment order was created.", 409);
  const order = Array.isArray(orderRows) ? orderRows[0] : orderRows;
  try {
    await writeAgentAudit({ merchantId, eventType: "order_created", payload: { order_id: order.order_id, total_minor: Number(order.total_minor), currency: order.currency, items }, result: "pending" });
  } catch { return errorResponse("The order was created but could not be audited. Contact the merchant before paying.", 500); }
  return Response.json({ success: true, order: { id: order.order_id, subtotal_minor: Number(order.subtotal_minor), total_minor: Number(order.total_minor), currency: order.currency } });
}

function formatMoney(minor, currency) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}