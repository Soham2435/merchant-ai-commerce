import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { writeAgentAudit } from "@/lib/agent-audit";

export const runtime = "nodejs";

const recommendationSchema = {
  type: Type.OBJECT,
  properties: {
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          product_id: { type: Type.STRING },
          quantity: { type: Type.INTEGER },
          reason: { type: Type.STRING },
        },
        required: ["product_id", "quantity", "reason"],
      },
    },
  },
  required: ["recommendations"],
};

function errorResponse(message, status) {
  return Response.json({ success: false, message }, { status });
}

async function getMerchant(supabase, userId) {
  const { data, error } = await supabase
    .from("merchant_members")
    .select("merchant_id")
    .eq("user_id", userId);

  if (error) throw new Error("We could not verify your merchant workspace.");
  return data?.length === 1 ? data[0].merchant_id : null;
}

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return errorResponse("Authentication is required.", 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const buyerText = typeof body?.text === "string" ? body.text.trim() : "";
  if (!buyerText || buyerText.length > 1000) {
    return errorResponse("Tell us what you are looking for in 1,000 characters or less.", 400);
  }

  let merchantId;
  try {
    merchantId = await getMerchant(supabase, user.id);
  } catch (error) {
    return errorResponse(error.message, 500);
  }
  if (!merchantId) return errorResponse("One merchant workspace is required.", 403);

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, name, description, category, price_minor, currency")
    .eq("merchant_id", merchantId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (productsError) return errorResponse("We could not load the active catalog.", 500);
  if (!products?.length) return errorResponse("The merchant has no active products yet.", 409);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return errorResponse("GEMINI_API_KEY is not configured on the server.", 500);

  const catalog = products.map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    price_minor: Number(product.price_minor),
    currency: product.currency,
  }));

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [{
        role: "user",
        parts: [{ text: `Buyer request: ${buyerText}\n\nCatalog JSON:\n${JSON.stringify(catalog)}` }],
      }],
      config: {
        systemInstruction: "Recommend only products in the supplied catalog. Be concise. The catalog prices and IDs are reference data only; do not calculate a payable total.",
        responseMimeType: "application/json",
        responseSchema: recommendationSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? "{}");
    const productsById = new Map(products.map((product) => [product.id, product]));
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.flatMap((item) => {
          const product = productsById.get(item?.product_id);
          const quantity = item?.quantity;
          if (!product || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) return [];
          return [{ product_id: product.id, name: product.name, description: product.description, price_minor: Number(product.price_minor), currency: product.currency, quantity, reason: typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : "Matches your request." }];
        })
      : [];

    await writeAgentAudit({ merchantId, eventType: "ai_recommendation", payload: { buyer_text: buyerText, recommendation_count: recommendations.length }, result: "success" });
    return Response.json({ success: true, recommendations });
  } catch (error) {
    return errorResponse("The buyer assistant could not make a recommendation. Please try again.", 502);
  }
}