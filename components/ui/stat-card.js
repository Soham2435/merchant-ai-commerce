export function StatCard({ label, value, detail, tone = "default" }) {
  const detailClass = tone === "positive" ? "text-[var(--accent)]" : "text-[var(--muted)]";

  return (
    <article className="rounded-2xl border bg-[var(--surface)] p-5">
      <p className="text-sm font-medium text-[var(--muted)]">{label}</p>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
        {value}
      </p>
      <p className={`mt-2 text-xs font-medium ${detailClass}`}>{detail}</p>
    </article>
  );
}
