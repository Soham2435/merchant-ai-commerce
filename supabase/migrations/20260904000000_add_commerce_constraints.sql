-- Add merchant-level transaction limit (nullable = no limit).
-- Used by the AI buyer API to enforce a per-transaction spending cap
-- before any Razorpay order is created.
alter table public.merchants
  add column if not exists transaction_limit_minor bigint,
  add column if not exists currency text;

-- Optional constraint: limit must be positive when set.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.merchants'::regclass
       and conname = 'merchants_transaction_limit_minor_check'
  ) then
    alter table public.merchants
      add constraint merchants_transaction_limit_minor_check
      check (transaction_limit_minor is null or transaction_limit_minor > 0);
  end if;
end;
$$;
