import { createClient } from "@/lib/supabase/server";
import { writeAgentAudit } from "@/lib/agent-audit";
import { GoogleGenAI } from "@google/genai";


export const runtime = "nodejs";

function errorResponse(message, status, code) {
  return Response.json(
    { success: false, ...(code ? { code } : {}), message },
    { status }
  );
}

// Gemini is responsible ONLY for identifying the best primary product(s).
// Cross-sell recommendations are determined exclusively from merchant-approved
// growth rules stored in the database. Gemini must never return cross_sell.
const recommendationSchema = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          product_id: { type: "string" },
          quantity: { type: "integer" },
          reason: { type: "string" },
          recommendation_type: {
            type: "string",
            enum: ["primary"],
            description: "Must always be 'primary'. Never return cross_sell.",
          },
        },
        required: ["product_id", "quantity", "reason", "recommendation_type"],
      },
    },
  },
  required: ["recommendations"],
};




export async function POST(request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return errorResponse("Authentication is required.", 401);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const buyerText =
    typeof body?.text === "string" ? body.text.trim() : "";

  if (!buyerText || buyerText.length > 1000) {
    return errorResponse(
      "Tell us what you are looking for in 1,000 characters or less.",
      400
    );
  }

  // Derive the buyer's merchant context from the authenticated
  // user's real merchant membership. Never trust merchant_id
  // supplied by the browser.
  const { data: membership, error: membershipError } = await supabase
    .from("merchant_members")
    .select("merchant_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return errorResponse(
      "We could not determine your merchant context.",
      500
    );
  }

  if (!membership?.merchant_id) {
    return errorResponse(
      "No merchant is available for this buyer account.",
      403,
      "merchant_context_missing"
    );
  }

  const merchantId = membership.merchant_id;

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select(
      "id, name, description, price_minor, currency, merchant_id"
    )
    .eq("merchant_id", merchantId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (productsError) {
    return errorResponse(
      "We could not load the active catalog.",
      500
    );
  }

  if (!products?.length) {
    return errorResponse(
      "There are no active products available from this merchant right now.",
      409,
      "catalog_empty"
    );
  }

  // Load merchant-approved growth rules. Cross-sell recommendations are
  // driven exclusively by these rules — never by Gemini.
  const { data: growthRules, error: growthRulesError } = await supabase
    .from("merchant_growth_rules")
    .select("id, trigger_product_id, recommended_product_id, rule_type, reason")
    .eq("merchant_id", merchantId)
    .eq("active", true)
    .eq("rule_type", "cross_sell");

  if (growthRulesError) {
    return errorResponse(
      "We could not load the merchant's approved growth rules.",
      500
    );
  }

  // Map keyed by trigger_product_id for O(1) lookups.
  const growthRulesByTrigger = new Map(
    (growthRules ?? []).map((rule) => [rule.trigger_product_id, rule])
  );

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return errorResponse(
      "GEMINI_API_KEY is not configured on the server.",
      500
    );
  }

  const catalog = products.map((product) => ({
  id: product.id,
  name: product.name,
  description: product.description,
  price_minor: Number(product.price_minor),
  currency: product.currency,
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
              text: `Buyer request: ${buyerText}

Catalog JSON:
${JSON.stringify(catalog)}`,
            },
          ],
        },
      ],
      config: {
        systemInstruction:
          "Recommend only products in the supplied catalog. Return primary recommendations only — the best direct match(es) to the buyer's intent. Never return cross_sell in recommendation_type. Do not invent complementary products. Do not suggest add-ons or accessories. Do not calculate a payable total. Do not make payment, authorization, spending-limit, or transaction decisions. Reasons must be grounded in the buyer's stated intent. Do not claim 'frequently bought together' or invent purchase history, reviews, ratings, discounts, or specifications. Do not invent products, prices, availability, IDs, or specifications.",
        responseMimeType: "application/json",
        responseSchema: recommendationSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? "{}");

    const productsById = new Map(
      products.map((product) => [product.id, product])
    );

    const seenProductIds = new Set();
    const usedGrowthRuleIds = [];

    // Process primary recommendations from Gemini, then append any
    // merchant-approved cross-sell recommendations derived from growth rules.
    const recommendations = Array.isArray(
      parsed.recommendations
    )
      ? parsed.recommendations.flatMap((item) => {
          const product = productsById.get(item?.product_id);
          const quantity = item?.quantity;

          if (
            !product ||
            product.merchant_id !== merchantId ||
            !Number.isSafeInteger(quantity) ||
            quantity < 1 ||
            quantity > 1000 ||
            seenProductIds.has(product.id)
          ) {
            return [];
          }

          seenProductIds.add(product.id);

          // Gemini must only return primary. Force it regardless.
          const result = [
            {
              product_id: product.id,
              name: product.name,
              description: product.description,
              price_minor: Number(product.price_minor),
              currency: product.currency,
              quantity,
              reason:
                typeof item.reason === "string" &&
                item.reason.trim()
                  ? item.reason.trim()
                  : "Matches your request.",
              recommendation_type: "primary",
            },
          ];

          // Look up a merchant-approved growth rule for this primary product.
          const rule = growthRulesByTrigger.get(product.id);
          if (rule) {
            const crossProduct = productsById.get(rule.recommended_product_id);
            if (crossProduct && !seenProductIds.has(crossProduct.id)) {
              seenProductIds.add(crossProduct.id);
              usedGrowthRuleIds.push(rule.id);
              result.push({
                product_id: crossProduct.id,
                name: crossProduct.name,
                description: crossProduct.description,
                price_minor: Number(crossProduct.price_minor),
                currency: crossProduct.currency,
                quantity: 1,
                // Reason comes exclusively from the merchant-approved rule.
                reason: rule.reason,
                recommendation_type: "cross_sell",
              });
            }
          }

          return result;
        })
      : [];

    // Safety fallback: if any recommendations exist but none were classified as primary,
    // ensure the first recommendation is treated as primary so the flow never breaks.
    if (
      recommendations.length > 0 &&
      !recommendations.some((rec) => rec.recommendation_type === "primary")
    ) {
      recommendations[0].recommendation_type = "primary";
    }

    const hasCrossSell = recommendations.some(
      (rec) => rec.recommendation_type === "cross_sell"
    );

    await writeAgentAudit({
      merchantId,
      eventType: "ai_recommendation",
      actor: "ai_buyer",
      payload: {
        buyer_text: buyerText,
        recommendation_count: recommendations.length,
        recommendation_product_ids: recommendations.map((r) => r.product_id),
        recommendation_types: recommendations.map((r) => r.recommendation_type),
        has_cross_sell: hasCrossSell,
        approved_growth_rule_ids: usedGrowthRuleIds,
        merchant_ids: [merchantId],
      },
      result: "success",
    });

    return Response.json({
      success: true,
      recommendations,
    });
  } catch (error) {
    console.error("AI Recommendation Error:", error);
    await writeAgentAudit({
      merchantId,
      eventType: "ai_recommendation",
      actor: "ai_buyer",
      payload: { buyer_text: buyerText },
      result: "error",
    });
    const isRateLimited =
      error?.status === 429 ||
      (typeof error?.message === "string" &&
        (error.message.includes("429") || error.message.includes("RESOURCE_EXHAUSTED")));
    if (isRateLimited) {
      return errorResponse(
        "AI recommendation temporarily unavailable. Please try again in a moment.",
        429,
        "ai_rate_limited"
      );
    }
    return errorResponse("An unexpected error occurred.", 500);
  }
}