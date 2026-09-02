export default function Loading() {
  return (
    <div className="space-y-8" aria-label="Loading dashboard" role="status">
      <div className="h-28 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => <div key={item} className="h-36 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />)}
      </div>
    </div>
  );
}
