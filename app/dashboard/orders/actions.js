"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const MAX_PRODUCTS = 100;
const MAX_QUANTITY = 1000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_FORM_FIELDS = new Set(["items", "idempotency_key"]);
const EXPECTED_RPC_ERRORS = [
  /authentication is required/i,
  /merchant membership is required/i,
  /items must be a JSON array/i,
  /at least one item is required/i,
  /too many order items/i,
  /each item must contain/i,
  /quantity must be between/i,
  /product is missing, inactive, or not part of the merchant/i,
  /all products must use the same currency/i,
  /idempotency_key is required/i,
  /idempotency_key is too long/i,
  /order line total exceeds the supported limit/i,
  /order total exceeds the supported limit/i,
];

function getText(formData, field) {
  const value = formData.get(field);

  return typeof value === "string" ? value.trim() : "";
}

function validateFormData(formData) {
  const fieldCounts = new Map();

  for (const [field] of formData.entries()) {
    if (field.startsWith("$ACTION_")) {
      continue;
    }

    if (!ALLOWED_FORM_FIELDS.has(field)) {
      return "Only items and idempotency_key are accepted.";
    }

    fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
  }

  if (fieldCounts.get("items") !== 1) {
    return "Exactly one items field is required.";
  }

  if (fieldCounts.get("idempotency_key") !== 1) {
    return "Exactly one idempotency_key field is required.";
  }

  return null;
}

function isExpectedRpcError(message) {
  return EXPECTED_RPC_ERRORS.some((pattern) => pattern.test(message));
}

function logUnexpectedRpcError(error) {
  console.error("createPendingOrder RPC failed", {
    code: error?.code ?? "unknown",
    status: error?.status ?? "unknown",
  });
}

function parseItems(value) {
  if (!value) {
    return { error: "At least one product is required." };
  }

  let items;

  try {
    items = JSON.parse(value);
  } catch {
    return { error: "Products must be valid order items." };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { error: "At least one product is required." };
  }

  if (items.length > MAX_PRODUCTS) {
    return {
      error: `An order can contain at most ${MAX_PRODUCTS} distinct products.`,
    };
  }

  const productIds = new Set();
  const validatedItems = [];

  for (const item of items) {
    if (
      item === null ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).length !== 2 ||
      !Object.hasOwn(item, "product_id") ||
      !Object.hasOwn(item, "quantity")
    ) {
      return { error: "Each order item must contain only product_id and quantity." };
    }

    if (
      typeof item.product_id !== "string" ||
      !UUID_PATTERN.test(item.product_id)
    ) {
      return { error: "Each product ID must be a valid UUID." };
    }

    if (
      typeof item.quantity !== "number" ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > MAX_QUANTITY
    ) {
      return {
        error: `Each quantity must be a positive integer of ${MAX_QUANTITY} or less.`,
      };
    }

    const productId = item.product_id.toLowerCase();

    if (productIds.has(productId)) {
      return { error: "Duplicate product IDs are not allowed." };
    }

    productIds.add(productId);
    validatedItems.push({
      product_id: productId,
      quantity: item.quantity,
    });
  }

  return { items: validatedItems };
}

export async function createPendingOrder(_previousState, formData) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      success: false,
      message: "Your session has expired. Please sign in again.",
      fieldErrors: {},
    };
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("merchant_members")
    .select("merchant_id")
    .eq("user_id", user.id);

  if (membershipError) {
    return {
      success: false,
      message: "We could not verify your merchant workspace.",
      fieldErrors: {},
    };
  }

  if (!memberships || memberships.length !== 1) {
    return {
      success: false,
      message:
        "Order creation currently requires exactly one merchant workspace.",
      fieldErrors: {},
    };
  }

  const formDataError = validateFormData(formData);

  if (formDataError) {
    return {
      success: false,
      message: formDataError,
      fieldErrors: {},
    };
  }

  const idempotencyKey = getText(formData, "idempotency_key");
  const fieldErrors = {};

  if (!idempotencyKey) {
    fieldErrors.idempotency_key = "An idempotency key is required.";
  } else if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    fieldErrors.idempotency_key = `The idempotency key must be ${MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer.`;
  }

  const parsedItems = parseItems(getText(formData, "items"));

  if (parsedItems.error) {
    fieldErrors.items = parsedItems.error;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      message: "Please correct the order details.",
      fieldErrors,
    };
  }

  let order;
  let orderError;

  try {
    ({ data: order, error: orderError } = await supabase.rpc(
      "create_pending_order",
      {
        p_merchant_id: memberships[0].merchant_id,
        p_idempotency_key: idempotencyKey,
        p_items: parsedItems.items,
      }
    ));
  } catch (error) {
    logUnexpectedRpcError(error);
    return {
      success: false,
      message: "We couldn't create the order. Please try again.",
      fieldErrors: {},
    };
  }

  if (orderError) {
    if (!isExpectedRpcError(orderError.message ?? "")) {
      logUnexpectedRpcError(orderError);
      return {
        success: false,
        message: "We couldn't create the order. Please try again.",
        fieldErrors: {},
      };
    }

    return {
      success: false,
      message: orderError.message,
      fieldErrors: {},
    };
  }

  const createdOrder = Array.isArray(order) ? order[0] : order;

  revalidatePath("/dashboard/orders");

  return {
    success: true,
    message: "Order created successfully.",
    fieldErrors: {},
    order: createdOrder,
  };
}