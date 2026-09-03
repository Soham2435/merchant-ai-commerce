"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_CATEGORY_LENGTH = 80;
const MAX_SKU_LENGTH = 80;


function getText(formData, field) {
  const value = formData.get(field);

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function parsePriceMinor(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    return null;
  }

  const [whole, decimal = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));

  if (!Number.isSafeInteger(minor)) {
    return null;
  }

  return minor;
}

export async function createProduct(_previousState, formData) {
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
        "Product creation currently requires exactly one merchant workspace.",
      fieldErrors: {},
    };
  }

  const merchantId = memberships[0].merchant_id;

  const { data: merchant, error: merchantError } = await supabase
    .from("merchants")
    .select("currency")
    .eq("id", merchantId)
    .single();

  if (merchantError || !merchant?.currency) {
    return {
      success: false,
      message: "We could not verify the merchant currency.",
      fieldErrors: {},
    };
  }

  const name = getText(formData, "name");
  const price = getText(formData, "price");
  const description = getText(formData, "description");
  const category = getText(formData, "category");
  const sku = getText(formData, "sku");
  const isActive = formData.get("is_active") === "on";

  const fieldErrors = {};

  if (!name) {
    fieldErrors.name = "Product name is required.";
  } else if (name.length > MAX_NAME_LENGTH) {
    fieldErrors.name = `Product name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  const priceMinor = parsePriceMinor(price);

  if (priceMinor === null) {
    fieldErrors.price = "Enter a valid price with up to two decimal places.";
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    fieldErrors.description = `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
  }

  if (category.length > MAX_CATEGORY_LENGTH) {
    fieldErrors.category = `Category must be ${MAX_CATEGORY_LENGTH} characters or fewer.`;
  }

  if (sku.length > MAX_SKU_LENGTH) {
    fieldErrors.sku = `SKU must be ${MAX_SKU_LENGTH} characters or fewer.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      message: "Please correct the highlighted fields.",
      fieldErrors,
    };
  }

  const { error: insertError } = await supabase.from("products").insert({
    merchant_id: merchantId,
    currency: merchant.currency,
    name,
    description: description || null,
    category: category || null,
    price_minor: priceMinor,
    is_active: isActive,
    sku: sku || null,
  });

  if (insertError) {
    return {
      success: false,
      message: "We could not create the product. Please try again.",
      fieldErrors: {},
    };
  }

  revalidatePath("/dashboard/products");

  return {
    success: true,
    message: "Product created successfully.",
    fieldErrors: {},
  };
}
