"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

let razorpayScriptPromise;

function loadRazorpayScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Checkout is only available in a browser."));
  }

  if (window.Razorpay) {
    return Promise.resolve();
  }

  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;

      script.onload = () => resolve();

      script.onerror = () => {
        razorpayScriptPromise = null;
        reject(new Error("Razorpay Checkout could not be loaded."));
      };

      document.body.appendChild(script);
    });
  }

  return razorpayScriptPromise;
}

export const RazorpayCheckout = forwardRef(function RazorpayCheckout(
  { orderId, amountMinor, currency },
  ref
) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [payment, setPayment] = useState(null);
  const failureReported = useRef(false);

  async function recordCheckoutFailure(reason) {
    if (failureReported.current) {
      return;
    }

    failureReported.current = true;

    try {
      await fetch("/api/buyer/checkout-event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order_id: orderId,
          reason,
        }),
        keepalive: true,
      });
    } catch {
      // The payment remains unverified even if failure telemetry is unavailable.
    }
  }

  async function startPayment() {
    if (loading || payment) {
      return;
    }

    setLoading(true);
    setMessage("");
    failureReported.current = false;

    try {
      const orderResponse = await fetch("/api/razorpay/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order_id: orderId,
        }),
      });

      const orderBody = await orderResponse.json();

      if (!orderResponse.ok || !orderBody.success) {
        throw new Error(
          orderBody.message ?? "The Razorpay order could not be prepared."
        );
      }

      await loadRazorpayScript();

      const paymentOrder = orderBody.order;

      const checkout = new window.Razorpay({
        key: orderBody.key_id,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency,
        name: "Merchant AI Commerce",
        description: `Payment for order ${orderId}`,
        order_id: paymentOrder.razorpay_order_id,

        handler: async (response) => {
          try {
            const verificationResponse = await fetch(
              "/api/razorpay/payments/verify",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  order_id: orderId,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              }
            );

            const verificationBody = await verificationResponse.json();

            if (!verificationResponse.ok || !verificationBody.success) {
              throw new Error(
                verificationBody.message ?? "Payment verification failed."
              );
            }

            setPayment(verificationBody.order);
            setMessage(verificationBody.message);
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Payment verification failed. No successful payment was recorded."
            );
          } finally {
            setLoading(false);
          }
        },

        modal: {
          ondismiss: () => {
            setLoading(false);

            void recordCheckoutFailure("checkout_cancelled");

            setMessage(
              "Checkout was cancelled. No successful payment was recorded."
            );
          },
        },
      });

      checkout.on("payment.failed", () => {
        setLoading(false);

        void recordCheckoutFailure("payment_failed");

        setMessage(
          "Razorpay reported a failed payment. No successful payment was recorded."
        );
      });

      checkout.open();
    } catch (error) {
      setLoading(false);

      void recordCheckoutFailure("checkout_error");

      setMessage(
        error instanceof Error
          ? error.message
          : "Checkout could not be started."
      );
    }
  }

  useImperativeHandle(ref, () => ({
    startPayment,
  }));

  return (
    <section className="mt-5 border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">
            Payment state
          </p>

          <p className="mt-1 text-xs text-[var(--muted)]">
            Razorpay Test Mode. The server verifies the payment before marking
            this order paid.
          </p>
        </div>

        <span className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold capitalize text-[var(--accent-dark)]">
          {payment?.status ?? "pending"}
        </span>
      </div>

      {payment ? (
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--muted)]">Verified payment ID</dt>

            <dd className="max-w-[13rem] truncate font-medium text-[var(--foreground)]">
              {payment.razorpay_payment_id}
            </dd>
          </div>
        </dl>
      ) : (
        <button
          type="button"
          onClick={startPayment}
          disabled={loading}
          className="mt-4 w-full rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Opening Razorpay Checkout..." : "Pay with Razorpay"}
        </button>
      )}

      {message ? (
        <p
          className={`mt-3 text-sm ${
            payment ? "text-[var(--accent-dark)]" : "text-red-700"
          }`}
          role="status"
        >
          {message}
        </p>
      ) : null}

      <p className="mt-3 text-xs text-[var(--muted)]">
        {formatMoney(amountMinor, currency)} payable for this order.
      </p>
    </section>
  );
});

function formatMoney(minor, currency) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}