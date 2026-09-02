export function TopBar() {
  return (
    <header className="flex items-center justify-between border-b bg-[var(--surface)] px-4 py-4 sm:px-8">
      <div>
        <p className="text-sm font-medium text-[var(--foreground)]">Good morning</p>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Here is your commerce snapshot.</p>
      </div>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent-dark)]" aria-label="Merchant account">
        MA
      </div>
    </header>
  );
}
