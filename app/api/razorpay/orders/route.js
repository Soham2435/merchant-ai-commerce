import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(message, status) {
  return Response.json(
    {
      success: false,
      message,
    },
    { status }
  );
}

function isValidUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

async function retrieveRazorpayOrder(orderId, keyId, keySecret) {
  const authorization = Buffer.from(`${keyId}:${keySecret}`).toString(
    "base64"
  );

  let response;

  try {
    response = await fetch(
      `https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`,
      {
        headers: {
          Authorization: `Basic ${authorization}`,
        },
        cache: "no-store",
      }
    );
  } catch (error) {
    console.error("Razorpay order retrieval failed", {
      event: "razorpay_order_retrieval",
      razorpayOrderId: orderId,
      result: "error",
      reason: error?.name ?? "network_error",
    });
    return { error: "Razorpay could not be reached." };
  }

  let body;

  try {
    body = await response.json();
  } catch {
    return { error: "Razorpay returned an invalid response." };
  }

  if (!response.ok || !body?.id) {
    console.error("Razorpay order retrieval rejected", {
      event: "razorpay_order_retrieval",
      razorpayOrderId: orderId,
      result: "rejected",
      status: response.status,
      code: body?.error?.code ?? "unknown",
    });
    return { error: "Razorpay order could not be verified." };
  }

  return { order: body };
}

function matchesSupabaseOrder(razorpayOrder, order, amountMinor) {
  return (
    razorpayOrder.id === order.razorpay_order_id &&
    razorpayOrder.amount === amountMinor &&
    razorpayOrder.currency === order.currency &&
    razorpayOrder.receipt === order.id
  );
}

function verifiedOrderResponse(order, amountMinor, keyId, reused) {
  return Response.json({
    success: true,
    reused,
    key_id: keyId,
    order: {
      id: order.id,
      razorpay_order_id: order.razorpay_order_id,
      amount: amountMinor,
      currency: order.currency,
    },
  });
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
    Object.keys(body).some((key) => key !== "order_id")
  ) {
    return jsonError("Only order_id is accepted.", 400);
  }

  const orderId =
    typeof body.order_id === "string" ? body.order_id.trim() : "";

  if (!isValidUuid(orderId)) {
    return jsonError("A valid order_id is required.", 400);
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("merchant_members")
    .select("merchant_id")
    .eq("user_id", user.id);

  if (membershipError) {
    console.error("Razorpay order membership lookup failed", {
      code: membershipError.code ?? "unknown",
      status: membershipError.status ?? "unknown",
    });

    return jsonError("We could not verify your merchant workspace.", 500);
  }

  if (!memberships || memberships.length !== 1) {
    return jsonError(
      "Razorpay checkout currently requires exactly one merchant workspace.",
      403
    );
  }

  const merchantId = memberships[0].merchant_id;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, merchant_id, status, total_minor, currency, razorpay_order_id"
    )
    .eq("id", orderId)
    .eq("merchant_id", merchantId)
    .maybeSingle();

  if (orderError) {
    console.error("Razorpay order lookup failed", {
      code: orderError.code ?? "unknown",
      status: orderError.status ?? "unknown",
    });

    return jsonError("We could not load the order.", 500);
  }

  if (!order) {
    return jsonError("Order not found.", 404);
  }

  if (order.status !== "pending") {
    return jsonError(
      `This order cannot be paid because its status is ${order.status}.`,
      409
    );
  }

  const amountMinor = Number(order.total_minor);

  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return jsonError("The order has an invalid payment amount.", 409);
  }

  if (
    typeof order.currency !== "string" ||
    !/^[A-Z]{3}$/.test(order.currency)
  ) {
    return jsonError("The order has an invalid payment currency.", 409);
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    console.error("Razorpay credentials are not configured.");
    return jsonError("Razorpay is not configured on the server.", 500);
  }

  if (order.razorpay_order_id) {
    const retrieved = await retrieveRazorpayOrder(
      order.razorpay_order_id,
      keyId,
      keySecret
    );

    if (
      retrieved.error ||
      !matchesSupabaseOrder(retrieved.order, order, amountMinor)
    ) {
      console.error("Persisted Razorpay order failed validation", {
        event: "razorpay_order_reconciliation",
        supabaseOrderId: order.id,
        merchantId,
        razorpayOrderId: order.razorpay_order_id,
        result: "rejected",
        reason: retrieved.error ?? "order_details_mismatch",
      });
      return jsonError(
        "The stored Razorpay order does not match this pending order. No payment has been recorded.",
        409
      );
    }

    return verifiedOrderResponse(order, amountMinor, keyId, true);
  }

  const authorization = Buffer.from(`${keyId}:${keySecret}`).toString(
    "base64"
  );

  let razorpayResponse;

  try {
    razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountMinor,
        currency: order.currency,
        receipt: order.id,
      }),
      cache: "no-store",
    });
  } catch (error) {
    console.error("Razorpay order request failed", {
      name: error?.name ?? "unknown",
    });

    return jsonError(
      "Razorpay could not be reached. Your Supabase order remains pending and can be retried.",
      502
    );
  }

  let razorpayBody;

  try {
    razorpayBody = await razorpayResponse.json();
  } catch {
    return jsonError(
      "Razorpay returned an invalid response. Your order remains pending.",
      502
    );
  }

  if (!razorpayResponse.ok) {
    console.error("Razorpay order creation rejected", {
      status: razorpayResponse.status,
      code: razorpayBody?.error?.code ?? "unknown",
    });

    return jsonError(
      "Razorpay rejected the payment order. Your Supabase order remains pending and can be retried.",
      502
    );
  }

  if (
    typeof razorpayBody?.id !== "string" ||
    razorpayBody.amount !== amountMinor ||
    razorpayBody.currency !== order.currency ||
    razorpayBody.receipt !== order.id
  ) {
    console.error("Razorpay order response failed validation", {
      hasId: typeof razorpayBody?.id === "string",
      amountMatches: razorpayBody?.amount === amountMinor,
      currencyMatches: razorpayBody?.currency === order.currency,
      receiptMatches: razorpayBody?.receipt === order.id,
    });

    return jsonError(
      "Razorpay returned an unexpected payment order. Your order remains pending.",
      502
    );
  }

  const { data: updatedOrder, error: updateError } = await supabase
    .from("orders")
    .update({
      razorpay_order_id: razorpayBody.id,
    })
    .eq("id", order.id)
    .eq("merchant_id", merchantId)
    .eq("status", "pending")
    .is("razorpay_order_id", null)
    .select("id, razorpay_order_id, total_minor, currency")
    .maybeSingle();

  if (updateError) {
    console.error("Razorpay order persistence failed", {
      code: updateError.code ?? "unknown",
      status: updateError.status ?? "unknown",
    });

    return jsonError(
      "The Razorpay order was created but could not be safely linked to the merchant order. No payment has been marked as successful.",
      500
    );
  }

  if (!updatedOrder) {
    const { data: currentOrder, error: currentOrderError } = await supabase
      .from("orders")
      .select("id, razorpay_order_id, total_minor, currency, status")
      .eq("id", order.id)
      .eq("merchant_id", merchantId)
      .maybeSingle();

    if (currentOrderError || !currentOrder) {
      return jsonError(
        "The payment order could not be reconciled safely. Please retry.",
        409
      );
    }

    if (
      currentOrder.status === "pending" &&
      currentOrder.razorpay_order_id
    ) {
      const currentAmountMinor = Number(currentOrder.total_minor);
      const retrieved = await retrieveRazorpayOrder(
        currentOrder.razorpay_order_id,
        keyId,
        keySecret
      );

      if (
        !retrieved.error &&
        Number.isSafeInteger(currentAmountMinor) &&
        matchesSupabaseOrder(
          retrieved.order,
          {
            ...currentOrder,
            razorpay_order_id: currentOrder.razorpay_order_id,
          },
          currentAmountMinor
        )
      ) {
        return verifiedOrderResponse(
          currentOrder,
          currentAmountMinor,
          keyId,
          true
        );
      }

      return jsonError(
        "The stored Razorpay order could not be verified safely. Please retry.",
        409
      );
    }

    return jsonError(
      "The payment order could not be linked safely. Please retry.",
      409
    );
  }

  return verifiedOrderResponse(
    updatedOrder,
    Number(updatedOrder.total_minor),
    keyId,
    false
  );
}