"use client";

import { useActionState, useState } from "react";
import { deleteProduct, updateProduct } from "./actions";

const initialUpdateState = { success: false, message: "", fieldErrors: {} };
const initialDeleteState = { success: false, message: "" };

function formatMoney(minor, currency) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

function ProductRow({ product }) {
  const [editing, setEditing] = useState(false);
  const [updateState, updateAction, updatePending] = useActionState(updateProduct, initialUpdateState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteProduct, initialDeleteState);

  return (
    <article className="px-6 py-5">
      {editing ? (
        <form action={updateAction} className="space-y-4">
          <input type="hidden" name="product_id" value={product.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Name<input name="name" defaultValue={product.name} maxLength={120} required className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" /></label>
            <label className="text-sm font-medium">Price ({product.currency})<input name="price" defaultValue={(product.price_minor / 100).toFixed(2)} inputMode="decimal" required className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" /></label>
            <label className="text-sm font-medium">SKU<input name="sku" defaultValue={product.sku ?? ""} maxLength={80} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" /></label>
            <label className="text-sm font-medium">Category<input name="category" defaultValue={product.category ?? ""} maxLength={80} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" /></label>
          </div>
          <label className="block text-sm font-medium">Description<textarea name="description" defaultValue={product.description ?? ""} maxLength={1000} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
          <label className="flex items-center gap-2 text-sm"><input name="is_active" type="checkbox" defaultChecked={product.is_active} /> Product is active</label>
          {updateState.message ? <p className={updateState.success ? "text-sm text-[var(--accent-dark)]" : "text-sm text-red-700"} role="status">{updateState.message}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={updatePending} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{updatePending ? "Saving..." : "Save changes"}</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-[var(--foreground)]">{product.name}</h2>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
              {product.sku ? <span>SKU: {product.sku}</span> : null}
              {product.category ? <span>{product.category}</span> : null}
              <span>{product.is_active ? "Active" : "Inactive"}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-sm font-semibold text-[var(--foreground)]">{formatMoney(Number(product.price_minor), product.currency)}</p>
            <button type="button" onClick={() => setEditing(true)} className="rounded-lg border px-3 py-2 text-sm font-semibold">Edit</button>
            <form action={deleteAction}>
              <input type="hidden" name="product_id" value={product.id} />
              <button type="submit" disabled={deletePending} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">{deletePending ? "Deleting..." : "Delete"}</button>
            </form>
          </div>
          {deleteState.message ? <p className={deleteState.success ? "text-sm text-[var(--accent-dark)]" : "text-sm text-red-700"} role="status">{deleteState.message}</p> : null}
        </div>
      )}
    </article>
  );
}

export function ProductList({ products }) {
  return <section className="overflow-hidden rounded-2xl border bg-[var(--surface)]"><div className="border-b px-6 py-5"><p className="text-sm font-medium text-[var(--muted)]">{products.length} product{products.length === 1 ? "" : "s"}</p></div><div className="divide-y">{products.map((product) => <ProductRow key={product.id} product={product} />)}</div></section>;
}
