"use client";

import { useActionState } from "react";
import { createProduct } from "./actions";

const initialState = {
  success: false,
  message: "",
  fieldErrors: {},
};

function FieldError({ children }) {
  return children ? (
    <p className="mt-1 text-xs text-red-600">{children}</p>
  ) : null;
}

export function CreateProductForm({ currency }) {
  const [state, formAction, pending] = useActionState(
    createProduct,
    initialState
  );

  return (
    <section className="rounded-2xl border bg-[var(--surface)] p-6">
      <div className="mb-6">
        <p className="text-sm font-semibold text-[var(--foreground)]">
          Add product
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Add a product to the merchant catalog so it can become available to
          customers and the commerce agent.
        </p>
      </div>

      <form action={formAction} className="space-y-5">
        {state.message ? (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              state.success
                ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-dark)]"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
            role="status"
          >
            {state.message}
          </div>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label
              htmlFor="product-name"
              className="text-sm font-medium text-[var(--foreground)]"
            >
              Product name
            </label>
            <input
              id="product-name"
              name="name"
              type="text"
              maxLength={120}
              required
              className="mt-2 w-full rounded-xl border bg-transparent px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder="e.g. Premium Coffee Beans"
              aria-invalid={Boolean(state.fieldErrors?.name)}
            />
            <FieldError>{state.fieldErrors?.name}</FieldError>
          </div>

          <div>
            <label
              htmlFor="product-price"
              className="text-sm font-medium text-[var(--foreground)]"
            >
              Price ({currency})
            </label>
            <input
              id="product-price"
              name="price"
              type="text"
              inputMode="decimal"
              required
              className="mt-2 w-full rounded-xl border bg-transparent px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder="1499.00"
              aria-invalid={Boolean(state.fieldErrors?.price)}
            />
            <FieldError>{state.fieldErrors?.price}</FieldError>
          </div>

          <div>
            <label
              htmlFor="product-sku"
              className="text-sm font-medium text-[var(--foreground)]"
            >
              SKU
            </label>
            <input
              id="product-sku"
              name="sku"
              type="text"
              maxLength={80}
              className="mt-2 w-full rounded-xl border bg-transparent px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder="COFFEE-001"
              aria-invalid={Boolean(state.fieldErrors?.sku)}
            />
            <FieldError>{state.fieldErrors?.sku}</FieldError>
          </div>

          <div>
            <label
              htmlFor="product-category"
              className="text-sm font-medium text-[var(--foreground)]"
            >
              Category
            </label>
            <input
              id="product-category"
              name="category"
              type="text"
              maxLength={80}
              className="mt-2 w-full rounded-xl border bg-transparent px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder="Beverages"
              aria-invalid={Boolean(state.fieldErrors?.category)}
            />
            <FieldError>{state.fieldErrors?.category}</FieldError>
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="product-description"
              className="text-sm font-medium text-[var(--foreground)]"
            >
              Description
            </label>
            <textarea
              id="product-description"
              name="description"
              rows={4}
              maxLength={1000}
              className="mt-2 w-full resize-y rounded-xl border bg-transparent px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder="Describe what makes this product useful to the customer."
              aria-invalid={Boolean(state.fieldErrors?.description)}
            />
            <FieldError>{state.fieldErrors?.description}</FieldError>
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm text-[var(--foreground)]">
          <input
            name="is_active"
            type="checkbox"
            defaultChecked
            className="h-4 w-4 rounded border"
          />
          Product is active and available for commerce
        </label>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {pending ? "Creating product..." : "Create product"}
        </button>
      </form>
    </section>
  );
}
