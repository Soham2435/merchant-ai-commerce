import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function writeAgentAudit({
  merchantId,
  eventType,
  actor = "ai_buyer",
  payload = {},
  result,
}) {
  const { error } = await supabaseAdmin.from("agent_audit_events").insert({
    merchant_id: merchantId,
    event_type: eventType,
    actor,
    payload,
    result,
  });

  if (error) {
    console.error("Agent audit write failed", {
      eventType,
      merchantId,
      code: error.code ?? "unknown",
    });
    throw new Error("Audit logging is unavailable.");
  }
}