export function EmptyState({ title, description, label = "Coming next" }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed bg-[var(--surface)] px-6 text-center">
      <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent-dark)]">
        {label}
      </span>
      <h2 className="mt-4 text-lg font-semibold text-[var(--foreground)]">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">{description}</p>
    </div>
  );
}
