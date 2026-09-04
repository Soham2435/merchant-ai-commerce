"use client";

import Link from "next/link";
import { useState } from "react";
import { RazorpayCheckout } from "@/app/dashboard/orders/razorpay-checkout";

export function BuyerShell({ signedIn, products }) {
  const [intent, setIntent] = useState("");
  const [recommendations, setRecommendations] = useState([]);
  const [selected, setSelected] = useState({});
  const [stage, setStage] = useState("idle");
  const [message, setMessage] = useState("");
  const [order, setOrder] = useState(null);

  async function recommend(event) {
    event.preventDefault();
    setStage("thinking");
    setMessage("");
    try {
      const response = await fetch("/api/buyer/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: intent }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "Recommendations are unavailable.");
      setRecommendations(body.recommendations);
      setSelected(Object.fromEntries(body.recommendations.map((item) => [item.product_id, item.quantity])));
      setStage("recommendations");
    } catch (error) { setStage("idle"); setMessage(error.message); }
  }

  async function propose() {
    const items = Object.entries(selected).filter(([, quantity]) => quantity > 0).map(([product_id, quantity]) => ({ product_id, quantity: Number(quantity) }));
    if (!items.length) { setMessage("Select at least one item before continuing."); return; }
    setStage("proposing"); setMessage("");
    try {
      const response = await fetch("/api/buyer/propose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? "The purchase could not be prepared.");
      setOrder(body.order); setStage("authorized");
    } catch (error) { setStage("recommendations"); setMessage(error.message); }
  }

  if (!signedIn) return <div className="mx-auto flex min-h-screen max-w-xl items-center px-6"><div className="w-full rounded-3xl border bg-[var(--surface)] p-8"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Buyer side</p><h1 className="mt-3 text-3xl font-semibold">Sign in to try the buyer demo</h1><p className="mt-3 text-sm leading-6 text-[var(--muted)]">The buyer uses your existing merchant session and catalog.</p><Link href="/login" className="mt-6 inline-block rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white">Sign in</Link></div></div>;

  return <div className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
    <header className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Buyer side</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">What are you looking for?</h1></div><Link href="/dashboard" className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]">Merchant workspace</Link></header>
    <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_0.9fr]">
      <section className="rounded-3xl border bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(23,33,31,0.06)] sm:p-8">
        <form onSubmit={recommend}><label htmlFor="intent" className="text-sm font-semibold">Describe your need</label><textarea id="intent" value={intent} onChange={(event) => setIntent(event.target.value)} required maxLength={1000} rows={5} placeholder="For example: I need a thoughtful desk setup under a modest budget" className="mt-3 w-full resize-none rounded-2xl border bg-[var(--surface-muted)] p-4 text-sm outline-none focus:border-[var(--accent)]" /><button disabled={stage === "thinking" || stage === "proposing"} className="mt-4 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{stage === "thinking" ? "Thinking..." : "Find a good match"}</button></form>
        {message ? <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</p> : null}
        {recommendations.length ? <div className="mt-10"><div className="flex items-end justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">AI shortlist</p><h2 className="mt-1 text-xl font-semibold">Review the recommendation</h2></div><span className="text-xs text-[var(--muted)]">You stay in control</span></div><div className="mt-5 space-y-3">{recommendations.map((item) => <article key={item.product_id} className="rounded-2xl border p-4"><div className="flex gap-4"><div className="min-w-0 flex-1"><h3 className="font-semibold">{item.name}</h3><p className="mt-1 text-sm leading-5 text-[var(--muted)]">{item.reason}</p><p className="mt-2 text-sm font-medium">{formatMoney(item.price_minor, item.currency)} each</p></div><input aria-label={`Quantity for ${item.name}`} type="number" min="0" max="1000" value={selected[item.product_id] ?? 0} onChange={(event) => setSelected({ ...selected, [item.product_id]: event.target.value })} className="h-10 w-20 rounded-lg border px-2 text-center text-sm" /></div></article>)}</div><button type="button" onClick={propose} disabled={stage === "proposing"} className="mt-5 w-full rounded-xl border-2 border-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-dark)] disabled:opacity-50">{stage === "proposing" ? "Checking purchase..." : "Review purchase"}</button></div> : null}
      </section>
      <aside className="rounded-3xl border border-[var(--accent)] bg-[var(--accent-dark)] p-6 text-white sm:p-8"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#a9e1cc]">Bounded commerce</p><h2 className="mt-4 text-2xl font-semibold">A clear handoff from intent to payment.</h2><div className="mt-8 space-y-5 text-sm leading-6 text-[#d9eee6]"><p>AI suggests from the active merchant catalog. It never sets prices or creates a payment.</p><p>Every total is recalculated on the server, checked against the merchant limit, and shown before authorization.</p><p>Razorpay opens only after you explicitly authorize the confirmed purchase.</p></div>{order ? <div className="mt-8 border-t border-white/20 pt-6"><p className="text-xs uppercase tracking-[0.14em] text-[#a9e1cc]">Confirmed order</p><p className="mt-2 text-2xl font-semibold">{formatMoney(order.total_minor, order.currency)}</p><p className="mt-1 text-sm text-[#d9eee6]">Order is pending payment.</p><RazorpayCheckout orderId={order.id} amountMinor={order.total_minor} currency={order.currency} /></div> : null}</aside>
    </div>
  </div>;
}

function formatMoney(minor, currency) { return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100); }