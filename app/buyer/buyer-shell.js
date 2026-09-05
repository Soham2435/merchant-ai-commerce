"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RazorpayCheckout } from "@/app/dashboard/orders/razorpay-checkout";
import { provisionBuyerSpendingAuthorization } from "./actions";

export function BuyerShell({
  signedIn,
  merchantContext,
  authorization,
  pendingOrders = [],
}) {
  const supabase = createClient();
  const router = useRouter();
  const checkoutRef = useRef(null);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/buyer");
    router.refresh();
  }

  const [intent, setIntent] = useState("");
  const [recommendations, setRecommendations] = useState([]);
  const [selected, setSelected] = useState({});
  const [stage, setStage] = useState("idle");
  const [message, setMessage] = useState("");
  const [order, setOrder] = useState(pendingOrders[0] ?? null);
  const [proposedItems, setProposedItems] = useState([]);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [pendingCheckoutDismissed, setPendingCheckoutDismissed] =
    useState(false);

  const [
    authorizationState,
    establishAuthorization,
    authorizationPending,
  ] = useActionState(provisionBuyerSpendingAuthorization, {
    success: false,
    message: "",
    authorization: null,
  });

  const activeAuthorization =
    authorizationState.authorization ?? authorization;

  function updateQuantity(productId, nextQuantity) {
    const qty = Math.max(0, Math.min(1000, Number(nextQuantity) || 0));
    setSelected((prev) => {
      const updated = { ...prev };
      if (qty === 0) {
        delete updated[productId];
      } else {
        updated[productId] = qty;
      }
      return updated;
    });
  }

  function toggleBundleItem(productId, defaultQuantity = 1) {
    setSelected((prev) => {
      const updated = { ...prev };
      if (updated[productId] && Number(updated[productId]) > 0) {
        delete updated[productId];
      } else {
        updated[productId] = defaultQuantity;
      }
      return updated;
    });
  }

  async function recommend(event) {
    event.preventDefault();

    setStage("thinking");
    setMessage("");

    try {
      const response = await fetch("/api/buyer/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: intent,
        }),
      });

      const body = await response.json();

      if (!response.ok || !body.success) {
        throw new Error(
          body.message ?? "Recommendations are unavailable."
        );
      }

      setRecommendations(body.recommendations);
      const initialSelected = {};
      const topPrimary = (body.recommendations ?? []).find(
        (item) => item.recommendation_type !== "cross_sell"
      );
      if (topPrimary) {
        initialSelected[topPrimary.product_id] = 1;
      }
      setSelected(initialSelected);
      setStage("recommendations");
    } catch (error) {
      setStage("idle");
      setMessage(
        error instanceof Error
          ? error.message
          : "Recommendations are unavailable."
      );
    }
  }

  async function propose() {
    setOrder(null);
    setApprovalError("");
    setPendingCheckoutDismissed(false);

    const items = Object.entries(selected)
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([product_id, quantity]) => ({
        product_id,
        quantity: Number(quantity),
      }));

    if (!items.length) {
      setMessage("Select at least one item before continuing.");
      return;
    }

    setStage("proposing");
    setMessage("");

    try {
      const response = await fetch("/api/buyer/propose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items,
        }),
      });

      const body = await response.json();

      if (!response.ok || !body.success) {
        throw new Error(
          body.message ?? "The purchase could not be prepared."
        );
      }

      const itemsWithDetails = items.map((it) => {
        const rec = recommendations.find(
          (r) => r.product_id === it.product_id
        );

        return {
          ...it,
          name: rec?.name ?? "Product",
          price_minor: rec?.price_minor ?? 0,
          currency: rec?.currency ?? body.order.currency,
          recommendation_type: rec?.recommendation_type ?? "primary",
        };
      });

      setProposedItems(itemsWithDetails);
      setOrder(body.order);
      setStage("proposed");
    } catch (error) {
      setStage("recommendations");
      setMessage(
        error instanceof Error
          ? error.message
          : "The purchase could not be prepared."
      );
    }
  }

  async function approveOrder() {
    if (!order?.id || approving) {
      return;
    }

    setApproving(true);
    setApprovalError("");

    try {
      const response = await fetch("/api/buyer/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order_id: order.id,
        }),
      });

      const body = await response.json();

      if (!response.ok || !body.success) {
        throw new Error(
          body.message ?? "Purchase approval failed."
        );
      }

      setOrder((prev) => ({
        ...prev,
        ...body.order,
      }));

      setStage("approved");
    } catch (error) {
      setApprovalError(
        error instanceof Error
          ? error.message
          : "Purchase approval failed."
      );
    } finally {
      setApproving(false);
    }
  }

  function continuePendingCheckout() {
  const pendingOrder = pendingOrders.find(
    (candidate) => candidate.status === "pending"
  );

  if (!pendingOrder?.id) {
    return;
  }

    setOrder(pendingOrder);
    setStage("approved");
    setMessage("");
    setApprovalError("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });

    setTimeout(() => {
      checkoutRef.current?.startPayment();
    }, 0);
  }

  function handlePaymentSuccess(paidOrder) {
    setOrder((prev) => ({
      ...prev,
      ...(paidOrder ?? {}),
      status: "paid",
    }));

    setPendingCheckoutDismissed(true);
    setStage("paid");
    setMessage("");
    setApprovalError("");
  }

  if (!signedIn) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl items-center px-6">
        <div className="w-full rounded-3xl border bg-[var(--surface)] p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            Buyer side
          </p>

          <h1 className="mt-3 text-3xl font-semibold">
            Sign in to try the buyer demo
          </h1>

          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Sign in with your buyer account to use the AI commerce assistant.
          </p>

          <Link
            href="/buyer/login"
            className="mt-6 inline-block rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const resumablePendingOrder = pendingOrders.find(
    (candidate) => candidate.status === "pending"
  );

  const hasPendingCheckout =
    Boolean(resumablePendingOrder) &&
    !pendingCheckoutDismissed &&
    order?.status !== "paid";

  const primaryRecommendations = recommendations.filter(
    (item) => item.recommendation_type !== "cross_sell"
  );
  const crossSellRecommendations = recommendations.filter(
    (item) => item.recommendation_type === "cross_sell"
  );
  const effectivePrimary =
    primaryRecommendations.length > 0
      ? primaryRecommendations
      : recommendations;
  const effectiveCrossSell =
    primaryRecommendations.length > 0 ? crossSellRecommendations : [];

  const selectedCount = Object.values(selected).reduce(
    (sum, qty) => sum + (Number(qty) > 0 ? 1 : 0),
    0
  );

  const selectedTotalMinor = recommendations.reduce((sum, rec) => {
    const qty = Number(selected[rec.product_id] || 0);
    return sum + (qty > 0 ? rec.price_minor * qty : 0);
  }, 0);

  const hasCrossSellSelected = effectiveCrossSell.some(
    (cs) => Number(selected[cs.product_id] || 0) > 0
  );

  const authorizationLimitMinor = activeAuthorization
    ? Number(activeAuthorization.max_amount_minor)
    : null;

  const isOverSpendingLimit =
    authorizationLimitMinor !== null &&
    selectedTotalMinor > authorizationLimitMinor;

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            Buyer side
          </p>

          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">
            What are you looking for?
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            Merchant workspace
          </Link>

          <button
            type="button"
            onClick={signOut}
            className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-[var(--surface-muted)]"
          >
            Sign out
          </button>
        </div>
      </header>

      {hasPendingCheckout ? (
        <section className="mt-8 rounded-2xl border border-[var(--accent)] bg-[var(--surface)] p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
                Pending checkout
              </p>

              <h2 className="mt-2 text-xl font-semibold">
                You have a purchase ready to continue
              </h2>

              <p className="mt-1 text-sm text-[var(--muted)]">
                Your approved purchase is saved securely. You can continue
                payment without creating another order.
              </p>
            </div>

            <button
              type="button"
              onClick={continuePendingCheckout}
              className="shrink-0 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Continue checkout
            </button>
          </div>

          <div className="mt-5 rounded-xl bg-[var(--surface-muted)] p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--muted)]">
                  Approved purchase
                </p>

                <p className="mt-1 text-sm font-semibold">
                  Approval confirmed
                </p>
              </div>

              <p className="text-lg font-semibold">
                {formatMoney(
  resumablePendingOrder.total_minor,
  resumablePendingOrder.currency
)}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-8 rounded-2xl border bg-[var(--surface)] p-5 sm:flex sm:items-end sm:justify-between sm:gap-6 sm:p-6">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            AI spending limit
          </p>

          <h2 className="mt-2 text-xl font-semibold">
            Choose what the AI agent may spend
          </h2>

          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            The AI agent cannot purchase above this authorized amount. You can
            set or increase your own delegation at any time.
          </p>

          {activeAuthorization ? (
            <p className="mt-3 text-sm font-medium text-[var(--accent-dark)]">
              Current authorization:{" "}
              {formatMoney(
                activeAuthorization.max_amount_minor,
                activeAuthorization.currency
              )}
            </p>
          ) : null}
        </div>

        <form
          action={establishAuthorization}
          className="mt-5 flex flex-wrap items-end gap-3 sm:mt-0"
        >
          <input type="hidden" name="currency" value="INR" />

          <div>
            <label
              htmlFor="buyer-authorization-amount"
              className="mb-2 block text-xs font-medium text-[var(--foreground)]"
            >
              Maximum amount (INR)
            </label>

            <input
              id="buyer-authorization-amount"
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={
                activeAuthorization?.currency === "INR"
                  ? (activeAuthorization.max_amount_minor / 100).toFixed(2)
                  : ""
              }
              className="h-11 w-44 rounded-xl border bg-white px-3 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>

          <button
            type="submit"
            disabled={authorizationPending}
            className="h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {authorizationPending ? "Saving..." : "Set spending limit"}
          </button>
        </form>

        {authorizationState.message ? (
          <p
            className={`mt-3 w-full text-sm sm:col-span-2 ${
              authorizationState.success
                ? "text-[var(--accent-dark)]"
                : "text-red-700"
            }`}
            role="status"
          >
            {authorizationState.message}
          </p>
        ) : null}
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_0.9fr]">
        <section className="rounded-3xl border bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(23,33,31,0.06)] sm:p-8">
          <form onSubmit={recommend}>
            <label htmlFor="intent" className="text-sm font-semibold">
              Describe your need
            </label>

            <textarea
              id="intent"
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              required
              maxLength={1000}
              rows={5}
              placeholder="For example: I need a thoughtful desk setup under a modest budget"
              className="mt-3 w-full resize-none rounded-2xl border bg-[var(--surface-muted)] p-4 text-sm outline-none focus:border-[var(--accent)]"
            />

            <button
              disabled={
                stage === "thinking" || stage === "proposing"
              }
              className="mt-4 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {stage === "thinking"
                ? "Thinking..."
                : "Find a good match"}
            </button>
          </form>

          {message ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {message}
            </p>
          ) : null}

          {recommendations.length ? (
            <div className="mt-10 space-y-6">
              <div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
                      AI shortlist
                    </p>
                    <h2 className="mt-1 text-xl font-semibold">
                      Primary recommendations
                    </h2>
                  </div>
                  <span className="text-xs text-[var(--muted)]">
                    Direct match for your request
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {effectivePrimary.map((item) => {
                    const currentQty = Number(selected[item.product_id] ?? 0);
                    return (
                      <article
                        key={item.product_id}
                        className={`rounded-2xl border p-4 transition-all ${
                          currentQty > 0
                            ? "border-[var(--accent)]/40 bg-[var(--surface)] shadow-sm"
                            : "border-black/10 bg-[var(--surface-muted)]/40 opacity-75"
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-dark)]">
                                Primary match
                              </span>
                              <h3 className="font-semibold text-[var(--foreground)]">
                                {item.name}
                              </h3>
                            </div>

                            <p className="mt-1.5 text-sm leading-5 text-[var(--muted)]">
                              {item.reason}
                            </p>

                            <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
                              {formatMoney(item.price_minor, item.currency)}
                              <span className="text-xs font-normal text-[var(--muted)]">
                                {" "}each
                              </span>
                            </p>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-center">
                            <label
                              htmlFor={`qty-${item.product_id}`}
                              className="text-xs text-[var(--muted)]"
                            >
                              Qty:
                            </label>
                            <div className="flex items-center rounded-lg border bg-white">
                              <button
                                type="button"
                                aria-label={`Decrease quantity for ${item.name}`}
                                onClick={() =>
                                  updateQuantity(
                                    item.product_id,
                                    Math.max(0, currentQty - 1)
                                  )
                                }
                                className="h-9 w-8 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]"
                              >
                                −
                              </button>
                              <input
                                id={`qty-${item.product_id}`}
                                aria-label={`Quantity for ${item.name}`}
                                type="number"
                                min="0"
                                max="1000"
                                value={currentQty}
                                onChange={(event) =>
                                  updateQuantity(
                                    item.product_id,
                                    event.target.value
                                  )
                                }
                                className="h-9 w-12 border-x text-center text-sm outline-none"
                              />
                              <button
                                type="button"
                                aria-label={`Increase quantity for ${item.name}`}
                                onClick={() =>
                                  updateQuantity(
                                    item.product_id,
                                    currentQty + 1
                                  )
                                }
                                className="h-9 w-8 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              {effectiveCrossSell.length ? (
                <div className="rounded-2xl border border-emerald-300/70 bg-emerald-50/40 p-4 sm:p-5">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
                        Complementary add-on
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-emerald-950">
                        Recommended add-ons
                      </h3>
                    </div>
                    <span className="rounded-full bg-emerald-200/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      AI upsell recommendation
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-emerald-800/80">
                    Pairing suggested by the assistant to increase value for your setup.
                  </p>

                  <div className="mt-4 space-y-3">
                    {effectiveCrossSell.map((item) => {
                      const inBundle = Number(selected[item.product_id] ?? 0) > 0;
                      return (
                        <article
                          key={item.product_id}
                          className="rounded-xl border border-emerald-200/80 bg-white p-4 shadow-sm"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                                  Add-on
                                </span>
                                <h4 className="font-semibold text-gray-900">
                                  {item.name}
                                </h4>
                              </div>

                              <p className="mt-1.5 text-xs leading-5 text-gray-700">
                                <span className="font-medium text-emerald-900">
                                  Why add this:
                                </span>{" "}
                                {item.reason}
                              </p>

                              <p className="mt-2 text-sm font-semibold text-gray-900">
                                {formatMoney(item.price_minor, item.currency)}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 self-end sm:self-center">
                              {inBundle ? (
                                <button
                                  type="button"
                                  onClick={() => toggleBundleItem(item.product_id)}
                                  className="rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-800"
                                >
                                  ✓ In bundle (Remove)
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => toggleBundleItem(item.product_id, 1)}
                                  className="rounded-xl border border-emerald-700 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                                >
                                  + Add to bundle
                                </button>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border bg-[var(--surface-muted)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
                      Selection summary
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-[var(--foreground)]">
                      {selectedCount === 0
                        ? "No items selected"
                        : `${selectedCount} item${selectedCount > 1 ? "s" : ""}${
                            hasCrossSellSelected
                              ? " • Includes recommended add-on"
                              : ""
                          }`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-[var(--muted)]">Estimated total</p>
                    <p className="text-lg font-semibold text-[var(--foreground)]">
                      {formatMoney(
                        selectedTotalMinor,
                        recommendations[0]?.currency ?? "INR"
                      )}
                    </p>
                  </div>
                </div>

                {activeAuthorization ? (
                  <div className="mt-3 flex items-center justify-between border-t border-black/5 pt-2 text-xs">
                    <span className="text-[var(--muted)]">
                      AI spending limit:
                    </span>
                    <span
                      className={`font-medium ${
                        isOverSpendingLimit
                          ? "font-semibold text-red-700"
                          : "text-[var(--accent-dark)]"
                      }`}
                    >
                      {isOverSpendingLimit
                        ? `Exceeds limit of ${formatMoney(
                            activeAuthorization.max_amount_minor,
                            activeAuthorization.currency
                          )}`
                        : `Within limit (${formatMoney(
                            activeAuthorization.max_amount_minor,
                            activeAuthorization.currency
                          )})`}
                    </span>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={propose}
                disabled={stage === "proposing" || selectedCount === 0}
                className="mt-2 w-full rounded-xl border-2 border-[var(--accent)] bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-95 disabled:opacity-50"
              >
                {stage === "proposing"
                  ? "Checking purchase..."
                  : hasCrossSellSelected
                  ? "Review bundle purchase"
                  : "Review purchase"}
              </button>
            </div>
          ) : null}
        </section>

        <aside className="rounded-3xl border border-[var(--accent)] bg-[var(--accent-dark)] p-6 text-white sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#a9e1cc]">
            Bounded commerce
          </p>

          <h2 className="mt-4 text-2xl font-semibold">
            A clear handoff from intent to payment.
          </h2>

          <div className="mt-8 space-y-5 text-sm leading-6 text-[#d9eee6]">
            <p>
              AI suggests from the active merchant catalog. It never sets
              prices or creates a payment.
            </p>

            <p>
              Every total is recalculated on the server and checked against
              your AI spending authorization before authorization.
            </p>

            <p>
              Razorpay opens only after you explicitly authorize the confirmed
              purchase.
            </p>
          </div>

          {order ? (
            order.approved_at ? (
              <div className="mt-8 border-t border-white/20 pt-6">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#a9e1cc]">
                    Purchase approved
                  </p>

                  <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-[#a9e1cc]">
                    {order.status === "paid"
                      ? "Payment complete"
                      : "Payment ready"}
                  </span>
                </div>

                <p className="mt-2 text-2xl font-semibold">
                  {formatMoney(order.total_minor, order.currency)}
                </p>

                <p className="mt-1 text-sm text-[#d9eee6]">
                  {order.status === "paid"
                    ? "Order is paid successfully."
                    : "Purchase approved. Proceed to Razorpay to complete payment."}
                </p>

                {order.status !== "paid" ? (
                  <RazorpayCheckout
                    ref={checkoutRef}
                    orderId={order.id}
                    amountMinor={order.total_minor}
                    currency={order.currency}
                    onPaymentSuccess={handlePaymentSuccess}
                  />
                ) : null}
              </div>
            ) : (
              <div className="mt-8 border-t border-white/20 pt-6">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#a9e1cc]">
                    Proposal Review
                  </p>

                  <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[10px] font-semibold text-amber-200">
                    Approval required
                  </span>
                </div>

                <p className="mt-2 text-sm text-[#d9eee6]">
                  Review and explicitly approve this specific purchase before
                  payment opens.
                </p>

                {proposedItems.length ? (
                  <ul className="mt-4 space-y-2 rounded-xl bg-white/10 p-3 text-xs">
                    {proposedItems.map((item) => (
                      <li
                        key={item.product_id}
                        className="flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className="truncate font-medium text-white flex items-center gap-1.5">
                            {item.name} × {item.quantity}
                          </span>
                          {item.recommendation_type === "cross_sell" ? (
                            <span className="inline-block mt-0.5 rounded bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#a9e1cc]">
                              Bundled add-on
                            </span>
                          ) : null}
                        </div>

                        <span className="shrink-0 text-[#d9eee6]">
                          {formatMoney(
                            item.price_minor * item.quantity,
                            item.currency
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-4 flex items-baseline justify-between border-t border-white/15 pt-3">
                  <span className="text-xs text-[#d9eee6]">
                    Total payable:
                  </span>

                  <span className="text-xl font-semibold text-white">
                    {formatMoney(
                      order.total_minor,
                      order.currency
                    )}
                  </span>
                </div>

                {activeAuthorization ? (
                  <p className="mt-1 text-[11px] text-[#a9e1cc]">
                    Your active AI spending limit:{" "}
                    {formatMoney(
                      activeAuthorization.max_amount_minor,
                      activeAuthorization.currency
                    )}
                  </p>
                ) : null}

                {approvalError ? (
                  <p
                    role="alert"
                    className="mt-3 rounded-xl border border-red-400/40 bg-red-950/80 p-2.5 text-xs text-red-200"
                  >
                    {approvalError}
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={approveOrder}
                  disabled={approving}
                  className="mt-5 w-full rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[var(--accent-dark)] shadow-sm transition-opacity hover:opacity-95 disabled:opacity-50"
                >
                  {approving
                    ? "Approving purchase..."
                    : "Approve this purchase"}
                </button>
              </div>
            )
          ) : (
            <div className="mt-8 border-t border-white/20 pt-6">
              <p className="text-sm font-medium text-white">
                No purchase is confirmed yet.
              </p>

              <p className="mt-1 text-sm leading-6 text-[#d9eee6]">
                Review a server-approved proposal before opening payment.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function formatMoney(minor, currency) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}