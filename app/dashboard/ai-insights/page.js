import { createClient } from "@/lib/supabase/server";
import { SectionPage } from "@/components/dashboard/section-page";

export default async function AIInsightsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <SectionPage eyebrow="AI Activity" title="AI Activity" description="Review bounded buyer actions." emptyTitle="Sign in required" emptyDescription="Sign in to view activity." label="Authentication" />;
  const { data: memberships } = await supabase.from("merchant_members").select("merchant_id").eq("user_id", user.id);
  const merchantId = memberships?.length === 1 ? memberships[0].merchant_id : null;
  const { data: events } = merchantId ? await supabase.from("agent_audit_events").select("id, event_type, result, payload, created_at").eq("merchant_id", merchantId).order("created_at", { ascending: false }).limit(50) : { data: [] };
  return <div className="space-y-8"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">AI Activity</p><h1 className="mt-2 text-3xl font-semibold">Agent audit trail</h1><p className="mt-2 text-sm text-[var(--muted)]">A readable record of recommendations, limits, orders, and payment outcomes.</p></div>{events?.length ? <section className="divide-y overflow-hidden rounded-2xl border bg-[var(--surface)]">{events.map((event) => <article key={event.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="font-semibold capitalize text-[var(--foreground)]">{event.event_type.replaceAll("_", " ")}</p><p className="mt-1 text-sm text-[var(--muted)]">{formatEventContext(event)}</p></div><div className="text-left sm:text-right"><p className="text-sm font-medium capitalize">{event.result ?? "recorded"}</p><time className="text-xs text-[var(--muted)]">{new Date(event.created_at).toLocaleString("en-IN")}</time></div></article>)}</section> : <SectionPage eyebrow="AI Activity" title="AI Activity" description="Review bounded buyer actions." emptyTitle="No activity yet" emptyDescription="Buyer recommendations and purchase decisions will appear here." label="No events" />}</div>;
}

function formatEventContext(event) {
  const payload = event.payload ?? {};
  if (payload.buyer_text) return `Intent: ${payload.buyer_text}`;
  if (payload.limit_minor) return `${formatAmount(payload.total_minor, payload.currency)} exceeds ${formatAmount(payload.limit_minor, payload.currency)}`;
  if (payload.reason) return `${payload.reason.replaceAll("_", " ")} • ${formatAmount(payload.total_minor, payload.currency)}`;
  if (payload.order_id) return `Order ${payload.order_id} • ${formatAmount(payload.total_minor, payload.currency)}`;
  if (payload.total_minor) return `Amount ${formatAmount(payload.total_minor, payload.currency)}`;
  return "Recorded by the buyer agent.";
}

function formatAmount(minor, currency) {
  if (!Number.isSafeInteger(Number(minor)) || typeof currency !== "string") return "Amount recorded";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number(minor) / 100);
}
