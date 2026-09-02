export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="w-full max-w-3xl rounded-3xl border bg-[var(--surface)] p-8 shadow-[0_20px_60px_rgba(23,33,31,0.08)] sm:p-12">
        <div className="mb-16 flex items-center gap-3 text-sm font-semibold tracking-wide text-[var(--accent-dark)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-lg text-white">M</span>
          Merchant AI Commerce
        </div>
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Commerce operations, clarified</p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-[var(--foreground)] sm:text-6xl">
          Make every merchant decision count.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--muted)]">
          A focused workspace for products, orders, customers, and the signals that help your business move forward.
        </p>
        <a className="mt-10 inline-flex h-12 items-center rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-dark)]" href="/dashboard">
          Open dashboard <span className="ml-3" aria-hidden="true">-&gt;</span>
        </a>
      </section>
    </main>
  );
}
