import { createClient } from "@/lib/supabase/server";
import { SectionPage } from "@/components/dashboard/section-page";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <SectionPage eyebrow="Workspace" title="Settings" description="Review the workspace commerce rule." emptyTitle="Sign in required" emptyDescription="Sign in to view workspace settings." label="Authentication" />;
  const { data: memberships } = await supabase.from("merchant_members").select("merchant_id").eq("user_id", user.id);
  const merchantId = memberships?.length === 1 ? memberships[0].merchant_id : null;
  const { data: merchant } = merchantId ? await supabase.from("merchants").select("name, currency, transaction_limit_minor").eq("id", merchantId).maybeSingle() : { data: null };
  if (!merchant) return <SectionPage eyebrow="Workspace" title="Settings" description="Review the workspace commerce rule." emptyTitle="Merchant workspace unavailable" emptyDescription="Connect one merchant workspace to view its rule." label="Merchant setup" />;
  return <div className="space-y-8"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">Workspace</p><h1 className="mt-2 text-3xl font-semibold">Settings</h1><p className="mt-2 text-sm text-[var(--muted)]">Review the rule applied before a buyer can pay.</p></div><section className="max-w-2xl rounded-2xl border bg-[var(--surface)] p-6"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Commerce rule</p><h2 className="mt-2 text-xl font-semibold">{merchant.name}</h2><dl className="mt-6 grid gap-4 sm:grid-cols-2"><div><dt className="text-sm text-[var(--muted)]">Maximum transaction</dt><dd className="mt-1 text-lg font-semibold">{merchant.transaction_limit_minor === null ? "No limit configured" : formatAmount(merchant.transaction_limit_minor, merchant.currency ?? "INR")}</dd></div><div><dt className="text-sm text-[var(--muted)]">Currency</dt><dd className="mt-1 text-lg font-semibold">{merchant.currency ?? "Catalog-defined"}</dd></div></dl><p className="mt-6 border-t pt-4 text-sm leading-6 text-[var(--muted)]">The buyer assistant can recommend products, but every purchase is recalculated and checked against this rule on the server before Razorpay opens.</p></section></div>;
}

function formatAmount(minor, currency) { return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(minor) / 100); }
