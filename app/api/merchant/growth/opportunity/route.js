import { createClient } from "@/lib/supabase/server";
import { writeAgentAudit } from "@/lib/agent-audit";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";

function errorResponse(message, status, code) {
  return Response.json({ success: false, ...(code ? { code } : {}), message }, { status });
}

// JSON schema for the Gemini response
const opportunitySchema = {
  type: "object",
  properties: {
    trigger_product_id: { type: "string" },
    recommended_product_id: { type: "string" },
    reason: { type: "string" },
    rule_type: { type: "string", enum: ["cross_sell"] },
  },
  required: ["trigger_product_id", "recommended_product_id", "reason", "rule_type"],
};

export async function POST(request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse("Authentication required.", 401, "unauthenticated");
  }

  // Resolve merchant membership
  const { data: membership, error: membershipError } = await supabase
    .from("merchant_members")
    .select("merchant_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return errorResponse("Failed to verify merchant membership.", 500, "internal_error");
  }
  if (!membership?.merchant_id) {
    return errorResponse("User is not a member of any merchant.", 403, "unauthorized");
  }
  const merchantId = membership.merchant_id;

  // Load active catalog for this merchant
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, name, description, price_minor, currency, merchant_id")
    .eq("merchant_id", merchantId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (productsError) {
    return errorResponse("Could not load product catalog.", 500, "internal_error");
  }
  if (!products || products.length < 2) {
    return errorResponse(
      "Insufficient catalog for generating a cross‑sell opportunity.",
      409,
      "insufficient_catalog"
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return errorResponse("GEMINI_API_KEY not configured.", 500, "internal_error");
  }

  const catalog = products.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price_minor: Number(p.price_minor),
    currency: p.currency,
  }));

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Generate ONE cross‑sell opportunity for the merchant's catalog. Choose two distinct active products that complement each other. Return ONLY JSON with fields: trigger_product_id, recommended_product_id, reason, rule_type (must be "cross_sell"). Use only the information in the catalog.\n\nCatalog JSON:\n${JSON.stringify(catalog)}`,
            },
          ],
        },
      ],
      config: {
        systemInstruction:
          "You are an AI that proposes a single cross‑sell opportunity based on a merchant's product catalog. Do not fabricate data, do not reference sales history, and ensure the output is valid JSON matching the provided schema.",
        responseMimeType: "application/json",
        responseSchema: opportunitySchema,
      },
    });

    const parsed = JSON.parse(response.text ?? "{}");

    // Validate AI output
    const { trigger_product_id, recommended_product_id, reason, rule_type } = parsed;
    if (
      typeof trigger_product_id !== "string" ||
      typeof recommended_product_id !== "string" ||
      typeof reason !== "string" ||
      typeof rule_type !== "string" ||
      rule_type !== "cross_sell" ||
      !reason.trim() ||
      trigger_product_id === recommended_product_id
    ) {
      throw new Error("invalid_ai_output");
    }
    const validIds = new Set(products.map((p) => p.id));
    if (!validIds.has(trigger_product_id) || !validIds.has(recommended_product_id)) {
      throw new Error("invalid_ai_output");
    }

    // Audit successful generation
    await writeAgentAudit({
      merchantId,
      eventType: "ai_growth_opportunity",
      actor: "ai_growth",
      payload: { trigger_product_id, recommended_product_id, rule_type, reason },
      result: "proposed",
    });

    return Response.json({
      success: true,
      opportunity: { trigger_product_id, recommended_product_id, reason, rule_type },
    });
  } catch (error) {
    console.error("Growth opportunity AI error:", error);
    // Audit failure
    await writeAgentAudit({
      merchantId,
      eventType: "ai_growth_opportunity",
      actor: "ai_growth",
      payload: {},
      result: "error",
    });
    if (error?.message?.includes("invalid_ai_output")) {
      return errorResponse("AI produced malformed output.", 500, "invalid_ai_output");
    }
    const isRateLimited =
      error?.status === 429 ||
      (typeof error?.message === "string" &&
        (error.message.includes("429") || error.message.includes("RESOURCE_EXHAUSTED")));
    if (isRateLimited) {
      return errorResponse(
        "AI service temporarily unavailable. Please try again later.",
        429,
        "ai_rate_limited"
      );
    }
    return errorResponse("An unexpected error occurred.", 500, "internal_error");
  }
}
