import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(message, status, code) {
  return Response.json(
    { success: false, ...(code ? { code } : {}), message },
    { status }
  );
}

export async function POST(request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return errorResponse("Authentication is required.", 401);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "order_id")
  ) {
    return errorResponse("Only order_id is accepted.", 400);
  }

  const orderId =
    typeof body.order_id === "string" ? body.order_id.trim() : "";

  if (!UUID_PATTERN.test(orderId)) {
    return errorResponse("A valid order_id is required.", 400);
  }

  let rows;
  let rpcError;

  try {
    ({ data: rows, error: rpcError } = await supabase.rpc(
      "approve_buyer_order",
      { p_order_id: orderId }
    ));
  } catch (error) {
    console.error("Approve buyer order RPC call failed", {
      orderId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return errorResponse(
      "The order could not be approved. No approval was recorded.",
      500
    );
  }

  if (rpcError) {
    const errorMsg = rpcError.message ?? "";

    if (/authentication is required/i.test(errorMsg)) {
      return errorResponse("Authentication is required.", 401);
    }
    if (/order not found/i.test(errorMsg)) {
      return errorResponse("Order not found.", 404);
    }
    if (/unauthorized/i.test(errorMsg)) {
      return errorResponse(
        "You are not authorized to approve this purchase.",
        403
      );
    }
    if (/only pending orders can be approved/i.test(errorMsg)) {
      return errorResponse(
        "Only pending orders can be approved.",
        409,
        "order_not_pending"
      );
    }
    if (/buyer spending authorization/i.test(errorMsg)) {
      return errorResponse(
        "This purchase exceeds your authorized buyer spending limit. Adjust your spending limit or create a smaller order.",
        422,
        "buyer_spending_limit_exceeded"
      );
    }
    if (/merchant transaction limit/i.test(errorMsg)) {
      return errorResponse(
        "This purchase exceeds the merchant transaction limit.",
        422,
        "merchant_transaction_limit_exceeded"
      );
    }

    console.error("Approve buyer order RPC returned error", {
      orderId,
      message: errorMsg,
      code: rpcError.code ?? "unknown",
    });

    return errorResponse(
      "The order could not be approved. Please try again.",
      500
    );
  }

  const approvedOrder = Array.isArray(rows) ? rows[0] : rows;

  if (!approvedOrder) {
    return errorResponse("Approved order details were not returned.", 500);
  }

  return Response.json({
    success: true,
    order: {
      id: approvedOrder.order_id,
      status: approvedOrder.status,
      approved_at: approvedOrder.approved_at,
      total_minor: Number(approvedOrder.total_minor),
      currency: approvedOrder.currency,
    },
  });
}
