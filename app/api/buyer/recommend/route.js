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
            enum: ["primary", "cross_sell"],
            description:
              "Must be 'primary' for the core product answering the buyer request, or 'cross_sell' for an optional complementary add-on from the catalog.",
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
          "Recommend only products in the supplied catalog. Classification must use recommendation_type: 'primary' for the best direct match to buyer intent (core item directly answering the buyer request) or 'cross_sell' for an optional complementary add-on or accessory from the catalog that directly pairs with the primary item. Only suggest a cross_sell if a credible, relevant complementary product genuinely exists in the catalog; if no credible complementary product exists, return only primary items. Do not force an upsell. Reasons must be grounded in the buyer's intent and cross-sell reasons must be concise, explaining in plain language why it complements the primary choice (e.g. 'Pairs well with your setup by...'). Do not claim 'frequently bought together' or invent purchase history, reviews, ratings, discounts, or specifications. Do not invent products, prices, availability, IDs, or specifications. The catalog prices and IDs are reference data only; do not calculate a payable total. Do not make payment, authorization, spending-limit, or transaction decisions.",
        responseMimeType: "application/json",
        responseSchema: recommendationSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? "{}");

    const productsById = new Map(
      products.map((product) => [product.id, product])
    );

    const seenProductIds = new Set();

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

          const rawType =
            typeof item?.recommendation_type === "string"
              ? item.recommendation_type.trim().toLowerCase()
              : "primary";
          const recommendation_type =
            rawType === "cross_sell" ? "cross_sell" : "primary";

          return [
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
              recommendation_type,
            },
          ];
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

    await writeAgentAudit({
      merchantId,
      eventType: "ai_recommendation",
      actor: "ai_buyer",
      payload: {
        buyer_text: buyerText,
        recommendation_count: recommendations.length,
        recommendation_product_ids: recommendations.map(r => r.product_id),
        recommendation_types: recommendations.map(r => r.recommendation_type),
        has_cross_sell: recommendations.some(
          (rec) => rec.recommendation_type === "cross_sell"
        ),
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