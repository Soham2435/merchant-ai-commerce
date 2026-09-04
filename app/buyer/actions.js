"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_AMOUNT_MINOR = Number.MAX_SAFE_INTEGER;

function result(success, message, authorization = null) {
  return { success, message, authorization };
}

function parseAmountMinor(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    return null;
  }

  const [whole, decimal = ""] = value.trim().split(".");
  const minorText = `${whole}${decimal.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
  const amountMinor = Number(minorText);

  return /^\d+$/.test(minorText) && Number.isSafeInteger(amountMinor) && amountMinor > 0 && amountMinor <= MAX_AMOUNT_MINOR
    ? amountMinor
    : null;
}

export async function provisionBuyerSpendingAuthorization(_previousState, formData) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return result(false, "Sign in before establishing an AI spending limit.");
  }

  const requestedCurrency = formData.get("currency");
  if (requestedCurrency !== "INR") {
    return result(false, "Only INR buyer spending authorization is supported.");
  }

  const amountMinor = parseAmountMinor(formData.get("amount"));
  if (amountMinor === null) {
    return result(false, "Enter a positive INR amount with up to two decimal places.");
  }

  const { error: authorizationError } = await supabaseAdmin
    .from("buyer_spending_authorizations")
    .upsert(
      {
        user_id: user.id,
        max_amount_minor: amountMinor,
        currency: "INR",
      },
      { onConflict: "user_id" }
    );

  if (authorizationError) {
    console.error("Buyer spending authorization provisioning failed", {
      code: authorizationError.code ?? "unknown",
      status: authorizationError.status ?? "unknown",
    });
    return result(false, "We could not establish your AI spending limit. Please try again.");
  }

  revalidatePath("/buyer");
  return result(true, "AI spending limit established.", {
    max_amount_minor: amountMinor,
    currency: "INR",
  });
}