"use client";

export default function Error({ reset }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed bg-[var(--surface)] px-6 text-center" role="alert">
      <p className="text-sm font-semibold text-[var(--foreground)]">This workspace could not load.</p>
      <p className="mt-2 text-sm text-[var(--muted)]">Try again, or check the application logs for more detail.</p>
      <button className="mt-5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-dark)]" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
