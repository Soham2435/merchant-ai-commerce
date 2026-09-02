export function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="flex flex-col gap-5 border-b pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? (
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
