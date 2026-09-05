"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RazorpayCheckout } from "@/app/dashboard/orders/razorpay-checkout";
import { provisionBuyerSpendingAuthorization } from "./actions";

const PROMPT_SUGGESTIONS = [
  "Running shoes for everyday training under ₹5000",
  "Build a running setup under ₹4,000",
  "Something suitable for my next race",
];

function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function BuyerShell({
  signedIn,
  merchantContext,
  authorization,
  pendingOrders = [],
  recentPaidOrders = [],
}) {
  const supabase = createClient();
  const router = useRouter();
  const checkoutRef = useRef(null);
  const transactionRailRef = useRef(null);

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
  const [order, setOrder] = useState(null);
  const [proposedItems, setProposedItems] = useState([]);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [pendingCheckoutDismissed, setPendingCheckoutDismissed] =
    useState(false);
  const [showLimitEditor, setShowLimitEditor] = useState(false);
  const [proposalSessionId, setProposalSessionId] = useState(() =>
    createSessionId()
  );

  function resetSession() {
    setOrder(null);
    setProposedItems([]);
    setSelected({});
    setRecommendations([]);
    setStage("idle");
    setMessage("");
    setApprovalError("");
    setIntent("");
    setProposalSessionId(createSessionId());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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

      // Check for structured error responses from the backend
      if (!response.ok || !body.success) {
        // Handle AI rate limiting specially
        if (body.code === "ai_rate_limited") {
          setMessage(
            "AI recommendation temporarily unavailable. Please try again in a moment."
          );
        } else {
          setMessage(body.message ?? "Recommendations are unavailable.");
        }
        setStage("idle");
        return;
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

    let currentSessionId = proposalSessionId;
    if (!currentSessionId) {
      currentSessionId = createSessionId();
      setProposalSessionId(currentSessionId);
    }

    try {
      const response = await fetch("/api/buyer/propose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items,
          proposal_session_id: currentSessionId,
        }),
      });

      const body = await response.json();

      if (!response.ok || !body.success) {
        if (body?.code === "order_not_pending") {
          setProposalSessionId(createSessionId());
        }
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

      setTimeout(() => {
        transactionRailRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 0);
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
        if (
          response.status === 409 ||
          body?.code === "order_not_pending" ||
          /only pending orders can be approved/i.test(body?.message ?? "")
        ) {
          setOrder(null);
          setStage("recommendations");
          setProposalSessionId(createSessionId());
          setMessage(
            "This purchase proposal is no longer active or has already been processed. A new session has been prepared — please review your proposal again."
          );
          return;
        }

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
    setProposalSessionId(createSessionId());
  }

  if (!signedIn) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl items-center px-6">
        <div className="w-full rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-8 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            Buyer side
          </p>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
            Sign in to try the buyer demo
          </h1>

          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Sign in with your buyer account to experience agentic commerce with explicit approval and spending limits.
          </p>

          <Link
            href="/buyer/login"
            className="mt-6 inline-block rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-95"
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

  const topPrimary = effectivePrimary[0];

  const selectedCount = Object.values(selected).reduce(
    (sum, qty) => sum + (Number(qty) > 0 ? 1 : 0),
    0
  );

  const totalQuantity = Object.values(selected).reduce(
    (sum, qty) => sum + Math.max(0, Number(qty) || 0),
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
    <div className={`mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8 sm:py-12${order && stage !== "paid" ? " pb-28 lg:pb-12" : ""}`}>
      {/* Top Console Navigation Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-[var(--accent)]" />
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              AI Commerce Console
            </p>
          </div>

          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl">
            Intelligent Buyer Console
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-xs font-semibold text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
          >
            Merchant workspace
          </Link>

          <span className="text-[var(--line)]">|</span>

          <button
            type="button"
            onClick={signOut}
            className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-1.5 text-xs font-semibold text-[var(--foreground)] shadow-2xs transition-colors hover:bg-[var(--surface-muted)]"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Spending Limit Status & Adjuster Strip */}
      <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-white px-5 py-3.5 shadow-2xs">
        <div className="flex items-center gap-3">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              Spending Authorization
            </p>
            <p className="text-sm font-bold text-[var(--foreground)]">
              {activeAuthorization
                ? `${formatMoney(activeAuthorization.max_amount_minor, activeAuthorization.currency)} limit enforced`
                : "No limit configured"}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowLimitEditor((prev) => !prev)}
          className="text-xs font-semibold text-[var(--accent)] transition-opacity hover:opacity-80"
        >
          {showLimitEditor ? "Close settings" : "Adjust spending limit"}
        </button>
      </section>

      {showLimitEditor ? (
        <div className="mt-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/60 p-5 shadow-2xs">
          <div className="max-w-xl">
            <h2 className="text-sm font-bold text-[var(--foreground)]">
              Configure Spending Authorization
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              The AI agent cannot execute or propose purchases above this amount. Limits are strictly verified by the server.
            </p>
          </div>

          <form
            action={establishAuthorization}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="currency" value="INR" />

            <div>
              <label
                htmlFor="buyer-authorization-amount"
                className="mb-1.5 block text-xs font-semibold text-[var(--foreground)]"
              >
                Maximum authorized amount (INR)
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
                className="h-10 w-44 rounded-xl border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]"
              />
            </div>

            <button
              type="submit"
              disabled={authorizationPending}
              className="h-10 rounded-xl bg-[var(--accent)] px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {authorizationPending ? "Updating..." : "Update limit"}
            </button>
          </form>

          {authorizationState.message ? (
            <p
              className={`mt-3 text-xs font-medium ${
                authorizationState.success
                  ? "text-emerald-800"
                  : "text-red-700"
              }`}
              role="status"
            >
              {authorizationState.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Resumable Pending Checkout Banner */}
      {hasPendingCheckout ? (
        <section className="mt-6 rounded-2xl border border-emerald-300 bg-emerald-50/50 p-5 shadow-xs">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-600" />
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
                  Approved Purchase Waiting
                </p>
              </div>

              <h2 className="mt-1 text-base font-bold text-[var(--foreground)]">
                You have an approved purchase ready for payment
              </h2>

              <p className="mt-1 text-xs text-[var(--muted)]">
                Your approved purchase is securely saved. You can complete payment without starting over.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-base font-bold text-[var(--foreground)]">
                {formatMoney(
                  resumablePendingOrder.total_minor,
                  resumablePendingOrder.currency
                )}
              </span>

              <button
                type="button"
                onClick={continuePendingCheckout}
                className="shrink-0 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-90"
              >
                Continue checkout
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* Main Console Grid */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        {/* LEFT COLUMN: Conversation & Product Recommendations (Hero) */}
        <section className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-xs sm:p-8">
          {/* Natural Language Intent Hero */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent-dark)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              AI SHOPPING AGENT
            </div>

            <h2 className="mt-3 text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl">
              Shop with an AI that respects your limits.
            </h2>

            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              Tell me what you're looking for. I'll find the best fit from the active merchant catalog, explain why, and ask before anything is purchased.
            </p>
          </div>

          {/* Input Form */}
          <form onSubmit={recommend} className="mt-6">
            <label htmlFor="intent" className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              Your Requirement
            </label>

            <textarea
              id="intent"
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              required
              maxLength={1000}
              rows={4}
              placeholder="Tell me what you need... e.g. I need running shoes for everyday training under ₹5000"
              className="mt-2.5 w-full resize-none rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/50 p-4 text-sm outline-none transition-colors focus:border-[var(--accent)] focus:bg-white"
            />

            {/* Subtle Example Prompts */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-[var(--muted)]">
                Try:
              </span>
              {PROMPT_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setIntent(suggestion)}
                  className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-muted)]"
                >
                  "{suggestion}"
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={stage === "thinking" || stage === "proposing"}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-xs transition-opacity hover:opacity-95 disabled:opacity-50"
            >
              {stage === "thinking" ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Analyzing catalog & limits...
                </>
              ) : (
                "Find best match"
              )}
            </button>
          </form>

          {message ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
            >
              {message}
            </p>
          ) : null}

          {/* Recommendations Decision Surface */}
          {recommendations.length ? (
            <div className="mt-10 space-y-6 border-t border-[var(--line)] pt-8">
              {/* AI Decision Banner & Explainability (Section 7 & 10) */}
              {topPrimary ? (
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/40 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-2 w-2 rounded-full bg-[var(--accent)]" />
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                        AI Shortlist
                      </p>
                    </div>
                    <span className="text-[11px] text-[var(--muted)]">
                      Top Match
                    </span>
                  </div>

                  <h3 className="mt-2 text-lg font-bold text-[var(--foreground)]">
                    "I'd go with {topPrimary.name}."
                  </h3>

                  <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                    {topPrimary.reason}
                  </p>

                  {/* Compact Explainability Strip (Section 10) */}
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3 text-[11px]">
                    <span className="text-[var(--muted)] font-medium">Why this pick:</span>
                    <span className="rounded-md bg-white border border-[var(--line)] px-2 py-0.5 text-[var(--foreground)] font-medium">
                      Daily Training Fit
                    </span>
                    <span className="rounded-md bg-white border border-[var(--line)] px-2 py-0.5 text-[var(--foreground)] font-medium">
                      {formatMoney(topPrimary.price_minor, topPrimary.currency)}
                    </span>
                    <span className="rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-emerald-800 font-medium">
                      ✓ Within spending authorization
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Primary Recommendations List (Section 8) */}
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Primary Recommendation
                  </h3>
                  <span className="text-[11px] text-[var(--muted)]">
                    Direct match
                  </span>
                </div>

                <div className="mt-3 space-y-3">
                  {effectivePrimary.map((item) => {
                    const currentQty = Number(selected[item.product_id] ?? 0);
                    return (
                      <article
                        key={item.product_id}
                        className={`rounded-2xl border p-5 transition-all ${
                          currentQty > 0
                            ? "border-[var(--accent)] bg-white shadow-xs"
                            : "border-[var(--line)] bg-[var(--surface-muted)]/30 opacity-75"
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--accent-dark)]">
                                Best Match
                              </span>
                              <h4 className="font-bold text-[var(--foreground)] text-base">
                                {item.name}
                              </h4>
                            </div>

                            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
                              {item.reason}
                            </p>

                            <div className="mt-3 flex items-baseline gap-1.5">
                              <span className="text-lg font-bold text-[var(--foreground)]">
                                {formatMoney(item.price_minor, item.currency)}
                              </span>
                              <span className="text-[11px] text-[var(--muted)]">
                                each
                              </span>
                            </div>
                          </div>

                          {/* Quantity Selector */}
                          <div className="flex items-center gap-2 self-end sm:self-center">
                            <label
                              htmlFor={`qty-${item.product_id}`}
                              className="text-[11px] font-medium text-[var(--muted)]"
                            >
                              Qty:
                            </label>
                            <div className="flex items-center rounded-xl border border-[var(--line)] bg-white shadow-2xs">
                              <button
                                type="button"
                                aria-label={`Decrease quantity for ${item.name}`}
                                onClick={() =>
                                  updateQuantity(
                                    item.product_id,
                                    Math.max(0, currentQty - 1)
                                  )
                                }
                                className="h-9 w-8 text-sm font-semibold text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
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
                                className="h-9 w-11 border-x border-[var(--line)] text-center text-xs font-semibold outline-none"
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
                                className="h-9 w-8 text-sm font-semibold text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
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

              {/* Cross-Sell Experience — AI Growth (Section 9) */}
              {effectiveCrossSell.length ? (
                <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/30 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-800">
                        Recommended with your pick
                      </p>
                      <h4 className="mt-0.5 text-sm font-bold text-emerald-950">
                        One Useful Addition
                      </h4>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                      Optional Add-on
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-emerald-800/80">
                    The AI identified this complementary item to pair with your selection.
                  </p>

                  <div className="mt-4 space-y-3">
                    {effectiveCrossSell.map((item) => {
                      const inBundle = Number(selected[item.product_id] ?? 0) > 0;
                      return (
                        <article
                          key={item.product_id}
                          className="rounded-xl border border-emerald-200/80 bg-white p-4 shadow-2xs"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                  Add-on
                                </span>
                                <h5 className="font-bold text-[var(--foreground)] text-sm">
                                  {item.name}
                                </h5>
                              </div>

                              <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
                                {item.reason}
                              </p>

                              <p className="mt-2 text-sm font-bold text-[var(--foreground)]">
                                {formatMoney(item.price_minor, item.currency)}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 self-end sm:self-center">
                              {inBundle ? (
                                <button
                                  type="button"
                                  onClick={() => toggleBundleItem(item.product_id)}
                                  className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-800"
                                >
                                  ✓ In bundle (Remove)
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => toggleBundleItem(item.product_id, 1)}
                                  className="rounded-xl border border-emerald-700 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100"
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

              {/* Selection Summary Strip & Guardrail Verification */}
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                      Selection Summary
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-[var(--foreground)]">
                      {selectedCount === 0
                        ? "No items selected"
                        : `${totalQuantity} ${totalQuantity === 1 ? "unit" : "units"} selected${
                            hasCrossSellSelected
                              ? " • Includes recommended add-on"
                              : ""
                          }`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-[var(--muted)]">Total Estimated</p>
                    <p className="text-lg font-bold text-[var(--foreground)]">
                      {formatMoney(
                        selectedTotalMinor,
                        recommendations[0]?.currency ?? "INR"
                      )}
                    </p>
                  </div>
                </div>

                {activeAuthorization ? (
                  <div className="mt-3 flex items-center justify-between border-t border-[var(--line)] pt-2.5 text-xs">
                    <span className="text-[var(--muted)]">
                      Spending Limit Check:
                    </span>
                    <span
                      className={`font-semibold ${
                        isOverSpendingLimit
                          ? "text-red-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {isOverSpendingLimit
                        ? `Exceeds limit of ${formatMoney(
                            activeAuthorization.max_amount_minor,
                            activeAuthorization.currency
                          )}`
                        : `Within limit of ${formatMoney(
                            activeAuthorization.max_amount_minor,
                            activeAuthorization.currency
                          )}`}
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Primary Proposal Action */}
              <button
                type="button"
                onClick={propose}
                disabled={
                  stage === "proposing" ||
                  totalQuantity === 0 ||
                  isOverSpendingLimit
                }
                className="w-full rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-semibold text-white shadow-xs transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {stage === "proposing"
                  ? "Verifying proposal on server..."
                  : isOverSpendingLimit
                  ? "Exceeds spending limit"
                  : hasCrossSellSelected
                  ? "Review bundle proposal"
                  : "Review purchase proposal"}
              </button>
            </div>
          ) : null}
        </section>

        {/* RIGHT COLUMN: Transaction Rail (Trust & Money Movement Surface) */}
        <aside
          id="transaction-rail"
          ref={transactionRailRef}
          className="scroll-mt-6 sm:scroll-mt-8 flex flex-col rounded-3xl border border-[var(--line)] bg-white p-6 shadow-xs sm:p-8"
        >
          {/* Visual State Progression (Section 13) */}
          <div className="border-b border-[var(--line)] pb-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                Transaction Console
              </p>
              <span className="text-[11px] font-semibold text-[var(--muted)]">
                {stage === "paid"
                  ? "Complete"
                  : stage === "approved"
                  ? "Payment Ready"
                  : stage === "proposed"
                  ? "Approval Required"
                  : "Discovering"}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-1.5 text-center text-[10px] font-bold uppercase tracking-wider">
              <div
                className={`rounded-md py-1.5 ${
                  stage === "idle" || stage === "thinking" || stage === "recommendations"
                    ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]"
                    : "bg-[var(--surface-muted)] text-emerald-800"
                }`}
              >
                1. Discover {stage !== "idle" && stage !== "thinking" && stage !== "recommendations" ? "✓" : ""}
              </div>

              <div
                className={`rounded-md py-1.5 ${
                  stage === "proposed"
                    ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]"
                    : stage === "approved" || stage === "paid"
                    ? "bg-[var(--surface-muted)] text-emerald-800"
                    : "bg-[var(--surface-muted)] text-[var(--muted)] opacity-50"
                }`}
              >
                2. Propose {stage === "approved" || stage === "paid" ? "✓" : ""}
              </div>

              <div
                className={`rounded-md py-1.5 ${
                  stage === "proposed" && order && !order.approved_at
                    ? "bg-amber-100 text-amber-900 border border-amber-300"
                    : stage === "approved" || stage === "paid"
                    ? "bg-[var(--surface-muted)] text-emerald-800"
                    : "bg-[var(--surface-muted)] text-[var(--muted)] opacity-50"
                }`}
              >
                3. Approve {stage === "approved" || stage === "paid" ? "✓" : ""}
              </div>

              <div
                className={`rounded-md py-1.5 ${
                  stage === "paid"
                    ? "bg-emerald-100 text-emerald-900"
                    : stage === "approved"
                    ? "bg-[var(--accent-soft)] text-[var(--accent-dark)] font-bold"
                    : "bg-[var(--surface-muted)] text-[var(--muted)] opacity-50"
                }`}
              >
                4. Pay {stage === "paid" ? "✓" : ""}
              </div>
            </div>
          </div>

          {/* STATE 1: Spending Limit Blocked (First-class Failure State - Section 17) */}
          {isOverSpendingLimit ? (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50/60 p-5">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-red-600" />
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-800">
                  Purchase Blocked
                </p>
              </div>

              <h3 className="mt-2 text-base font-bold text-red-950">
                Exceeds Spending Authorization
              </h3>

              <p className="mt-1 text-xs leading-relaxed text-red-800">
                This purchase exceeds your configured authorization. The AI agent cannot initiate an order or payment above this limit.
              </p>

              <div className="mt-4 space-y-2 rounded-xl border border-red-200/80 bg-white p-3.5 text-xs">
                <div className="flex justify-between text-[var(--muted)]">
                  <span>Requested total:</span>
                  <span className="font-bold text-red-700">
                    {formatMoney(selectedTotalMinor, recommendations[0]?.currency ?? "INR")}
                  </span>
                </div>

                <div className="flex justify-between text-[var(--muted)]">
                  <span>Authorized limit:</span>
                  <span className="font-semibold text-[var(--foreground)]">
                    {formatMoney(authorizationLimitMinor, activeAuthorization?.currency ?? "INR")}
                  </span>
                </div>

                <div className="flex justify-between border-t border-red-100 pt-2 font-bold text-red-800">
                  <span>Exceeded by:</span>
                  <span>
                    {formatMoney(selectedTotalMinor - authorizationLimitMinor, activeAuthorization?.currency ?? "INR")}
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-1.5 text-[11px] text-red-900/90">
                <p>• No payment or order was created.</p>
                <p>• The agent cannot override your spending authorization.</p>
                <p className="font-semibold text-emerald-800">✓ Guardrail check recorded in security audit log.</p>
              </div>

              <p className="mt-4 text-xs font-semibold text-red-900">
                Action required: Reduce item quantities on the left to proceed within your authorized limit.
              </p>
            </div>
          ) : order ? (
            /* STATE 2: Order Exists — Review, Approved, or Paid */
            order.approved_at ? (
              order.status === "paid" ? (
                /* STATE 2A: Payment Complete (Section 16) */
                <div className="mt-6">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 text-xl font-bold">
                      ✓
                    </div>

                    <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
                      Payment Complete
                    </p>

                    <h3 className="mt-1 text-2xl font-bold text-[var(--foreground)]">
                      {formatMoney(order.total_minor, order.currency)}
                    </h3>

                    <p className="mt-1 text-xs text-emerald-800">
                      Payment verified by Razorpay and confirmed on server.
                    </p>

                    {order.razorpay_payment_id ? (
                      <div className="mt-4 rounded-xl border border-emerald-200/80 bg-white p-3.5 text-left">
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                          Verified Payment ID
                        </p>
                        <p className="mt-1 break-all font-mono text-xs font-semibold text-[var(--foreground)]">
                          {order.razorpay_payment_id}
                        </p>
                        <p className="mt-1 text-[10px] text-[var(--muted)]">
                          Verified just now • Transaction recorded
                        </p>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={resetSession}
                      className="mt-6 w-full rounded-xl bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white shadow-xs transition-opacity hover:opacity-90"
                    >
                      Start new search
                    </button>
                  </div>
                </div>
              ) : (
                /* STATE 2B: Payment Ready — Approved & Unpaid (Section 15) */
                <div className="mt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">
                        Purchase Approved
                      </p>
                      <h3 className="text-lg font-bold text-[var(--foreground)]">
                        Payment Ready
                      </h3>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-bold text-emerald-800">
                      Approved
                    </span>
                  </div>

                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    Your purchase has been authorized. Complete payment with Razorpay below.
                  </p>

                  <div className="mt-4 flex items-baseline justify-between border-t border-[var(--line)] pt-3">
                    <span className="text-xs text-[var(--muted)]">Total payable:</span>
                    <span className="text-2xl font-bold text-[var(--foreground)]">
                      {formatMoney(order.total_minor, order.currency)}
                    </span>
                  </div>

                  <RazorpayCheckout
                    ref={checkoutRef}
                    orderId={order.id}
                    amountMinor={order.total_minor}
                    currency={order.currency}
                    onPaymentSuccess={handlePaymentSuccess}
                  />
                </div>
              )
            ) : (
              /* STATE 2C: Transaction Proposal Review & Approval (Section 11 & 14) */
              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-800">
                      Proposal Review
                    </p>
                    <h3 className="text-lg font-bold text-[var(--foreground)]">
                      Approval Required
                    </h3>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                    Step 3
                  </span>
                </div>

                <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
                  Review and explicitly approve this specific purchase before Razorpay payment opens.
                </p>

                {proposedItems.length ? (
                  <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)]/40 p-3.5 text-xs">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      {proposedItems.length} {proposedItems.length === 1 ? "Item" : "Items"} in Transaction
                    </p>
                    <ul className="space-y-2">
                      {proposedItems.map((item) => (
                        <li
                          key={item.product_id}
                          className="flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <span className="truncate font-semibold text-[var(--foreground)]">
                              {item.name} × {item.quantity}
                            </span>
                            {item.recommendation_type === "cross_sell" ? (
                              <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">
                                Add-on
                              </span>
                            ) : null}
                          </div>
                          <span className="shrink-0 font-semibold text-[var(--foreground)]">
                            {formatMoney(
                              item.price_minor * item.quantity,
                              item.currency
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-4 flex items-baseline justify-between border-t border-[var(--line)] pt-3">
                  <span className="text-xs text-[var(--muted)]">Total payable:</span>
                  <span className="text-2xl font-bold text-[var(--foreground)]">
                    {formatMoney(order.total_minor, order.currency)}
                  </span>
                </div>

                {/* Spending Authorization Check */}
                {activeAuthorization ? (
                  <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)]/60 p-3 text-xs">
                    <div className="flex justify-between text-[var(--muted)]">
                      <span>Spending limit:</span>
                      <span className="font-semibold text-[var(--foreground)]">
                        {formatMoney(
                          activeAuthorization.max_amount_minor,
                          activeAuthorization.currency
                        )}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between font-semibold text-emerald-800">
                      <span>✓ Within limit</span>
                      <span>
                        {formatMoney(
                          activeAuthorization.max_amount_minor - order.total_minor,
                          activeAuthorization.currency
                        )}{" "}
                        remaining
                      </span>
                    </div>
                  </div>
                ) : null}

                {approvalError ? (
                  <p
                    role="alert"
                    className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                  >
                    {approvalError}
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={approveOrder}
                  disabled={approving}
                  className="mt-5 w-full rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-semibold text-white shadow-xs transition-opacity hover:opacity-95 disabled:opacity-50"
                >
                  {approving ? "Authorizing purchase..." : "Approve purchase"}
                </button>

                <p className="mt-2 text-center text-[11px] text-[var(--muted)]">
                  Nothing is charged until you approve.
                </p>
              </div>
            )
          ) : (
            /* STATE 3: Idle / Empty State — Progressive Trust Console (Section 6) */
            <div className="mt-6 flex flex-1 flex-col justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-[var(--accent)]" />
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                    Your Control
                  </p>
                </div>

                <h3 className="mt-2 text-lg font-bold text-[var(--foreground)]">
                  Guardrails Active
                </h3>

                <p className="mt-1 text-xs text-[var(--muted)]">
                  Commerce with built-in boundaries and explicit consent.
                </p>

                {/* Progressive Trust Matrix (Section 6) */}
                <div className="mt-5 space-y-2.5 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)]/40 p-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--foreground)]">AI recommendation</span>
                    <span className="font-semibold text-emerald-800">✓ Catalog grounded</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--foreground)]">Server validation</span>
                    <span className="font-semibold text-emerald-800">✓ Authoritative</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--foreground)]">Your approval</span>
                    <span className="font-semibold text-amber-800">→ Required</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted)]">Payment execution</span>
                    <span className="font-mono text-[10px] text-[var(--muted)]">🔒 Locked</span>
                  </div>
                </div>

                {activeAuthorization ? (
                  <div className="mt-4 rounded-2xl border border-[var(--line)] bg-white p-4 text-xs">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      Spending Authorization
                    </p>
                    <p className="mt-1 text-xl font-bold text-[var(--foreground)]">
                      {formatMoney(
                        activeAuthorization.max_amount_minor,
                        activeAuthorization.currency
                      )}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
                      Purchases exceeding this threshold are automatically blocked.
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)]/60 p-3 text-center text-xs text-[var(--muted)]">
                Nothing is charged until you approve.
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Recent Purchases Section (Decoupled History) */}
      {recentPaidOrders.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
            Recent purchases
          </h2>

          <div className="mt-3 space-y-2">
            {recentPaidOrders.map((paidOrder) => (
              <div
                key={paidOrder.id}
                className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-white px-4 py-3 shadow-2xs"
              >
                <div className="min-w-0">
                  <p className="text-[11px] text-[var(--muted)]">
                    {new Date(paidOrder.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>

                  <p className="mt-0.5 font-mono text-xs font-semibold text-[var(--foreground)]">
                    #{paidOrder.id.slice(-8).toUpperCase()}
                  </p>
                </div>

                <div className="ml-4 flex shrink-0 items-center gap-3">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                    Paid
                  </span>

                  <p className="text-sm font-bold text-[var(--foreground)]">
                    {formatMoney(paidOrder.total_minor, paidOrder.currency)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Mobile Sticky Transaction Bar */}
      {order && stage !== "paid" ? (
        <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden">
          <div className="border-t border-[var(--line)] bg-white px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">
                  {!order.approved_at ? "Approval required" : "Payment ready"}
                </p>

                <p className="mt-0.5 truncate text-sm font-bold text-[var(--foreground)]">
                  {formatMoney(order.total_minor, order.currency)}
                </p>
              </div>

              <a
                href="#transaction-rail"
                className="shrink-0 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-90"
              >
                {!order.approved_at ? "Approve →" : "Pay →"}
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatMoney(minor, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
    minimumFractionDigits: 2,
  }).format((minor || 0) / 100);
}