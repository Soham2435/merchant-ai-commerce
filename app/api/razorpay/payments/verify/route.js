import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { writeAgentAudit } from "@/lib/agent-audit";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAZORPAY_ORDER_PATTERN = /^order_[A-Za-z0-9]+$/;
const RAZORPAY_PAYMENT_PATTERN = /^pay_[A-Za-z0-9]+$/;
const RAZORPAY_SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;
const VERIFICATION_FIELDS = new Set([
  "order_id",
  "razorpay_payment_id",
  "razorpay_order_id",
  "razorpay_signature",
]);

function jsonError(message, status) {
  return Response.json(
    {
      success: false,
      message,
    },
    { status }
  );
}

function isValid(value, pattern) {
  return typeof value === "string" && pattern.test(value);
}

function logPaymentEvent({
  event,
  supabaseOrderId,
  merchantId,
  razorpayOrderId,
  razorpayPaymentId,
  result,
  reason,
}) {
  console.info("Razorpay payment verification", {
    event,
    supabaseOrderId,
    merchantId,
    razorpayOrderId,
    ...(razorpayPaymentId ? { razorpayPaymentId } : {}),
    result,
    ...(reason ? { reason } : {}),
  });
}

async function auditPaymentFailure(merchantId, order, razorpayPaymentId, reason) {
  try {
    await writeAgentAudit({
      merchantId,
      eventType: "payment_failed",
      payload: {
        ...(order?.id ? { order_id: order.id } : {}),
        ...(order?.total_minor ? { total_minor: Number(order.total_minor) } : {}),
        ...(order?.currency ? { currency: order.currency } : {}),
        ...(order?.razorpay_order_id ? { razorpay_order_id: order.razorpay_order_id } : {}),
        ...(razorpayPaymentId ? { razorpay_payment_id: razorpayPaymentId } : {}),
        reason,
      },
      result: "rejected",
    });
  } catch {
    console.error("Payment failure audit unavailable", { merchantId, reason });
  }
}

async function paymentSuccess(order, merchantId) {
  try {
    await writeAgentAudit({
      merchantId,
      eventType: "payment_verified",
      payload: {
        order_id: order.id,
        total_minor: Number(order.total_minor),
        currency: order.currency,
        razorpay_order_id: order.razorpay_order_id,
        razorpay_payment_id: order.razorpay_payment_id,
      },
      result: "paid",
    });
  } catch {
    return jsonError(
      "Payment was verified, but the payment activity could not be recorded. Please retry verification.",
      409
    );
  }

  return Response.json({
    success: true,
    message: "Payment verified successfully.",
    order: {
      id: order.id,
      status: order.status,
      total_minor: Number(order.total_minor),
      currency: order.currency,
      razorpay_order_id: order.razorpay_order_id,
      razorpay_payment_id: order.razorpay_payment_id,
    },
  });
}

async function retrievePayment(paymentId, keyId, keySecret) {
  const authorization = Buffer.from(`${keyId}:${keySecret}`).toString(
    "base64"
  );

  let response;

  try {
    response = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Authorization: `Basic ${authorization}`,
        },
        cache: "no-store",
      }
    );
  } catch (error) {
    return { error: error?.name ?? "network_error" };
  }

  let body;

  try {
    body = await response.json();
  } catch {
    return { error: "invalid_response" };
  }

  if (!response.ok || !body?.id) {
    return {
      error: body?.error?.code ?? `http_${response.status}`,
    };
  }

  return { payment: body };
}

export async function POST(request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonError("Authentication is required.", 401);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !VERIFICATION_FIELDS.has(key)) ||
    Object.keys(body).length !== VERIFICATION_FIELDS.size
  ) {
    return jsonError(
      "Only order_id, razorpay_payment_id, razorpay_order_id, and razorpay_signature are accepted.",
      400
    );
  }

  const orderId = body.order_id;
  const razorpayPaymentId = body.razorpay_payment_id;
  const razorpayOrderId = body.razorpay_order_id;
  const razorpaySignature = body.razorpay_signature;

  if (!isValid(orderId, UUID_PATTERN)) {
    return jsonError("A valid order_id is required.", 400);
  }

  if (!isValid(razorpayPaymentId, RAZORPAY_PAYMENT_PATTERN)) {
    return jsonError("A valid Razorpay payment ID is required.", 400);
  }

  if (!isValid(razorpayOrderId, RAZORPAY_ORDER_PATTERN)) {
    return jsonError("A valid Razorpay order ID is required.", 400);
  }

  if (!isValid(razorpaySignature, RAZORPAY_SIGNATURE_PATTERN)) {
    return jsonError("Payment verification failed.", 400);
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("merchant_members")
    .select("merchant_id")
    .eq("user_id", user.id);

  if (membershipError) {
    console.error("Razorpay payment membership lookup failed", {
      event: "razorpay_payment_verification",
      result: "error",
      reason: membershipError.code ?? "membership_lookup_failed",
    });
    return jsonError("We could not verify your merchant workspace.", 500);
  }

  if (!memberships || memberships.length !== 1) {
    return jsonError(
      "Razorpay payment verification requires exactly one merchant workspace.",
      403
    );
  }

  const merchantId = memberships[0].merchant_id;
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, merchant_id, status, total_minor, currency, razorpay_order_id, razorpay_payment_id"
    )
    .eq("id", orderId)
    .eq("merchant_id", merchantId)
    .maybeSingle();

  if (orderError) {
    console.error("Razorpay payment order lookup failed", {
      event: "razorpay_payment_verification",
      supabaseOrderId: orderId,
      merchantId,
      result: "error",
      reason: orderError.code ?? "order_lookup_failed",
    });
    return jsonError("We could not load the order.", 500);
  }

  if (!order) {
    return jsonError("Order not found.", 404);
  }

  if (order.razorpay_order_id !== razorpayOrderId) {
    logPaymentEvent({
      event: "razorpay_payment_verification",
      supabaseOrderId: order.id,
      merchantId,
      razorpayOrderId,
      razorpayPaymentId,
      result: "rejected",
      reason: "razorpay_order_id_mismatch",
    });
    await auditPaymentFailure(merchantId, order, razorpayPaymentId, "razorpay_order_id_mismatch");
    return jsonError("Payment verification failed.", 400);
  }

  if (order.status === "paid") {
    if (order.razorpay_payment_id === razorpayPaymentId) {
      return paymentSuccess(order, merchantId);
    }

    return jsonError("This order has already been paid.", 409);
  }

  if (order.status !== "pending") {
    return jsonError(
      `This order cannot be paid because its status is ${order.status}.`,
      409
    );
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    console.error("Razorpay credentials are not configured.");
    return jsonError("Razorpay is not configured on the server.", 500);
  }

  const expectedSignature = createHmac("sha256", keySecret)
    .update(`${order.razorpay_order_id}|${razorpayPaymentId}`)
    .digest("hex");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "hex");
  const receivedSignatureBuffer = Buffer.from(razorpaySignature, "hex");

  if (
    expectedSignatureBuffer.length !== receivedSignatureBuffer.length ||
    !timingSafeEqual(expectedSignatureBuffer, receivedSignatureBuffer)
  ) {
    logPaymentEvent({
      event: "razorpay_payment_verification",
      supabaseOrderId: order.id,
      merchantId,
      razorpayOrderId: order.razorpay_order_id,
      razorpayPaymentId,
      result: "rejected",
      reason: "invalid_signature",
    });
    await auditPaymentFailure(merchantId, order, razorpayPaymentId, "invalid_signature");
    return jsonError(
      "Payment verification failed. No successful payment was recorded.",
      400
    );
  }

  const amountMinor = Number(order.total_minor);

  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return jsonError("The order has an invalid payment amount.", 409);
  }

  if (typeof order.currency !== "string" || !/^[A-Z]{3}$/.test(order.currency)) {
    return jsonError("The order has an invalid payment currency.", 409);
  }

  const retrieved = await retrievePayment(
    razorpayPaymentId,
    keyId,
    keySecret
  );

  if (retrieved.error) {
    logPaymentEvent({
      event: "razorpay_payment_verification",
      supabaseOrderId: order.id,
      merchantId,
      razorpayOrderId: order.razorpay_order_id,
      razorpayPaymentId,
      result: "rejected",
      reason: `payment_retrieval_${retrieved.error}`,
    });
    await auditPaymentFailure(merchantId, order, razorpayPaymentId, `payment_retrieval_${retrieved.error}`);
    return jsonError(
      "Razorpay payment could not be verified. No successful payment was recorded.",
      502
    );
  }

  const payment = retrieved.payment;

  if (
    payment.order_id !== order.razorpay_order_id ||
    payment.amount !== amountMinor ||
    payment.currency !== order.currency ||
    payment.status !== "captured"
  ) {
    logPaymentEvent({
      event: "razorpay_payment_verification",
      supabaseOrderId: order.id,
      merchantId,
      razorpayOrderId: order.razorpay_order_id,
      razorpayPaymentId,
      result: "rejected",
      reason: "payment_details_mismatch",
    });
    await auditPaymentFailure(merchantId, order, razorpayPaymentId, "payment_details_mismatch");
    return jsonError(
      "Razorpay payment details do not match this order. No successful payment was recorded.",
      409
    );
  }

  const { data: updatedOrder, error: updateError } = await supabase
    .from("orders")
    .update({
      status: "paid",
      razorpay_payment_id: razorpayPaymentId,
    })
    .eq("id", order.id)
    .eq("merchant_id", merchantId)
    .eq("status", "pending")
    .eq("razorpay_order_id", order.razorpay_order_id)
    .select(
      "id, status, total_minor, currency, razorpay_order_id, razorpay_payment_id"
    )
    .maybeSingle();

  if (updateError) {
    logPaymentEvent({
      event: "razorpay_payment_verification",
      supabaseOrderId: order.id,
      merchantId,
      razorpayOrderId: order.razorpay_order_id,
      razorpayPaymentId,
      result: "error",
      reason: updateError.code ?? "order_update_failed",
    });
    return jsonError(
      "Payment was verified but the order could not be updated safely. Please retry verification.",
      409
    );
  }

  if (updatedOrder) {
    logPaymentEvent({
      event: "razorpay_payment_verification",
      supabaseOrderId: order.id,
      merchantId,
      razorpayOrderId: order.razorpay_order_id,
      razorpayPaymentId,
      result: "paid",
    });
    return paymentSuccess(updatedOrder, merchantId);
  }

  const { data: reconciledOrder, error: reconcileError } = await supabase
    .from("orders")
    .select(
      "id, status, total_minor, currency, razorpay_order_id, razorpay_payment_id"
    )
    .eq("id", order.id)
    .eq("merchant_id", merchantId)
    .maybeSingle();

  if (
    !reconcileError &&
    reconciledOrder?.status === "paid" &&
    reconciledOrder.razorpay_payment_id === razorpayPaymentId
  ) {
    return paymentSuccess(reconciledOrder, merchantId);
  }

  logPaymentEvent({
    event: "razorpay_payment_verification",
    supabaseOrderId: order.id,
    merchantId,
    razorpayOrderId: order.razorpay_order_id,
    razorpayPaymentId,
    result: "error",
    reason: "payment_update_race_unresolved",
  });
  return jsonError(
    "Payment was verified but the order update could not be reconciled safely. Please retry verification.",
    409
  );
}
