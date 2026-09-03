"use client";

import { useActionState, useRef, useState } from "react";
import { createPendingOrder } from "./actions";

const initialState = {
  success: false,
  message: "",
  fieldErrors: {},
  order: null,
};

function formatMoney(minor, currency) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function OrderConstructor({ products, recentOrders }) {
  const [cart, setCart] = useState([]);
  const [state, formAction, pending] = useActionState(
    createPendingOrder,
    initialState
  );
  const idempotencyKeyRef = useRef(null);

  const selectedProducts = cart
    .map((item) => ({
      ...item,
      product: products.find((product) => product.id === item.product_id),
    }))
    .filter((item) => item.product);
  const subtotalMinor = selectedProducts.reduce(
    (total, item) => total + item.product.priceMinor * item.quantity,
    0
  );
  const previewCurrency = selectedProducts[0]?.product.currency ?? "INR";
  const hasItems = selectedProducts.length > 0;
  const isConflict = /idempotency key conflict/i.test(state.message ?? "");

  function toggleProduct(productId) {
    setCart((currentCart) => {
      const existingItem = currentCart.find(
        (item) => item.product_id === productId
      );

      return existingItem
        ? currentCart.filter((item) => item.product_id !== productId)
        : [...currentCart, { product_id: productId, quantity: 1 }];
    });
  }

  function updateQuantity(productId, value) {
    const quantity = Number(value);

    setCart((currentCart) =>
      currentCart.map((item) =>
        item.product_id === productId
          ? { ...item, quantity: Number.isFinite(quantity) ? quantity : 0 }
          : item
      )
    );
  }

  function handleSubmit(event) {
    if (!hasItems) {
      event.preventDefault();
      return;
    }

    idempotencyKeyRef.current.value = crypto.randomUUID();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
      <section className="rounded-2xl border bg-[var(--surface)] p-6">
        <div className="flex flex-col gap-2 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">
              Build an order
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
              Select active catalog products and set the requested quantities.
            </p>
          </div>
          <span className="text-xs font-medium text-[var(--muted)]">
            {selectedProducts.length} selected
          </span>
        </div>

        <div className="mt-5 divide-y">
          {products.map((product) => {
            const selectedItem = cart.find(
              (item) => item.product_id === product.id
            );
            const isSelected = Boolean(selectedItem);

            return (
              <div
                key={product.id}
                className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <label className="flex min-w-0 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleProduct(product.id)}
                    className="mt-1 h-4 w-4 rounded border"
                    aria-label={`Select ${product.name}`}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-[var(--foreground)]">
                      {product.name}
                    </span>
                    <span className="mt-1 block text-sm text-[var(--muted)]">
                      {formatMoney(product.priceMinor, product.currency)} each
                    </span>
                  </span>
                </label>

                {isSelected ? (
                  <div className="flex items-center gap-4 sm:shrink-0">
                    <label className="text-xs font-medium text-[var(--muted)]">
                      Quantity
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        step="1"
                        value={selectedItem.quantity}
                        onChange={(event) =>
                          updateQuantity(product.id, event.target.value)
                        }
                        className="mt-1 block h-10 w-24 rounded-lg border bg-transparent px-3 text-sm text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
                        aria-label={`${product.name} quantity`}
                      />
                    </label>
                    <span className="min-w-24 text-right text-sm font-semibold text-[var(--foreground)]">
                      {formatMoney(
                        product.priceMinor * selectedItem.quantity,
                        product.currency
                      )}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <form action={formAction} onSubmit={handleSubmit} className="mt-6">
          <input
            type="hidden"
            name="items"
            value={JSON.stringify(cart)}
            readOnly
          />
          <input
            ref={idempotencyKeyRef}
            type="hidden"
            name="idempotency_key"
            defaultValue=""
            readOnly
          />

          {state.fieldErrors?.items ? (
            <p className="mb-3 text-sm text-red-700" role="alert">
              {state.fieldErrors.items}
            </p>
          ) : null}
          {state.fieldErrors?.idempotency_key ? (
            <p className="mb-3 text-sm text-red-700" role="alert">
              {state.fieldErrors.idempotency_key}
            </p>
          ) : null}
          {state.message && !state.success ? (
            <div
              className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
                isConflict
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
              role="alert"
            >
              {state.message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!hasItems || pending}
            className="w-full rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {pending ? "Creating pending order..." : "Create pending order"}
          </button>
        </form>
      </section>

      <aside className="space-y-6">
        <section className="rounded-2xl border bg-[var(--surface)] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">
                Order preview
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Preview only. The server recalculates the final amount from the
                catalog.
              </p>
            </div>
            <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
              Draft
            </span>
          </div>

          <div className="mt-5 space-y-3 border-t pt-5">
            {selectedProducts.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Select a product to start the order.
              </p>
            ) : (
              selectedProducts.map((item) => (
                <div
                  key={item.product_id}
                  className="flex items-start justify-between gap-4 text-sm"
                >
                  <span className="text-[var(--muted)]">
                    {item.product.name} × {item.quantity}
                  </span>
                  <span className="font-medium text-[var(--foreground)]">
                    {formatMoney(
                      item.product.priceMinor * item.quantity,
                      item.product.currency
                    )}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="mt-5 flex items-end justify-between border-t pt-5">
            <span className="text-sm font-medium text-[var(--muted)]">
              Preview subtotal
            </span>
            <span className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
              {formatMoney(subtotalMinor, previewCurrency)}
            </span>
          </div>
        </section>

        {state.success && state.order ? (
          <section className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-dark)]">
              Order created
            </p>
            <p className="mt-2 text-sm text-[var(--accent-dark)]">
              The database accepted this order with pending status.
            </p>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--accent-dark)]">Order ID</dt>
                <dd className="max-w-[12rem] truncate font-medium text-[var(--foreground)]">
                  {state.order.order_id}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--accent-dark)]">Authoritative total</dt>
                <dd className="font-semibold text-[var(--foreground)]">
                  {formatMoney(state.order.total_minor, state.order.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--accent-dark)]">Currency</dt>
                <dd className="font-medium text-[var(--foreground)]">
                  {state.order.currency}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--accent-dark)]">Status</dt>
                <dd className="font-medium capitalize text-[var(--foreground)]">
                  pending
                </dd>
              </div>
            </dl>
          </section>
        ) : null}

        <RecentPendingOrders recentOrders={recentOrders} />
      </aside>
    </div>
  );
}

export function RecentPendingOrders({ recentOrders }) {
  return (
    <section className="rounded-2xl border bg-[var(--surface)] p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">
            Recent pending orders
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Latest orders from this merchant workspace.
          </p>
        </div>
        <span className="text-xs font-medium text-[var(--muted)]">
          {recentOrders.length}
        </span>
      </div>

      {recentOrders.length === 0 ? (
        <p className="mt-5 border-t border-dashed pt-5 text-sm text-[var(--muted)]">
          No pending orders yet.
        </p>
      ) : (
        <div className="mt-5 divide-y border-t">
          {recentOrders.map((order) => (
            <div
              key={order.id}
              className="flex items-center justify-between gap-4 py-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">
                  {order.id}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {formatDate(order.createdAt)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {formatMoney(order.totalMinor, order.currency)}
                </p>
                <p className="mt-1 text-xs font-medium capitalize text-[var(--accent-dark)]">
                  {order.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}