"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function BuyerLoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.replace("/buyer");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 py-12">
      <section className="w-full max-w-md rounded-3xl border bg-[var(--surface)] p-8 shadow-[0_20px_60px_rgba(23,33,31,0.08)]">
        <div className="mb-8 flex items-center gap-3 text-sm font-semibold text-[var(--accent-dark)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-lg text-white">
            B
          </span>
          AI Buyer
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Buyer sign in
        </h1>

        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Sign in to shop through the AI commerce assistant.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label
              htmlFor="buyer-email"
              className="mb-2 block text-sm font-medium text-[var(--foreground)]"
            >
              Email
            </label>
            <input
              id="buyer-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div>
            <label
              htmlFor="buyer-password"
              className="mb-2 block text-sm font-medium text-[var(--foreground)]"
            >
              Password
            </label>
            <input
              id="buyer-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>

          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-dark)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in as buyer"}
          </button>
        </form>
      </section>
    </main>
  );
}