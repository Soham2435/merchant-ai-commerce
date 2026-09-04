create table public.buyer_spending_authorizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  max_amount_minor bigint not null,
  currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buyer_spending_authorizations_amount_check
    check (max_amount_minor > 0),
  constraint buyer_spending_authorizations_currency_check
    check (currency ~ '^[A-Z]{3}$')
);

create or replace function public.prevent_buyer_spending_authorization_escalation()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and (
    new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.currency is distinct from old.currency
    or new.created_at is distinct from old.created_at
    or new.max_amount_minor > old.max_amount_minor
  ) then
    raise exception 'buyer spending authorization can only be reduced';
  end if;

  return new;
end;
$$;

create trigger buyer_spending_authorizations_prevent_escalation
before update on public.buyer_spending_authorizations
for each row
execute function public.prevent_buyer_spending_authorization_escalation();

alter table public.buyer_spending_authorizations enable row level security;

create policy buyer_spending_authorizations_select_own
on public.buyer_spending_authorizations
for select
using (user_id = auth.uid());

create policy buyer_spending_authorizations_update_own
on public.buyer_spending_authorizations
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

revoke insert, delete on table public.buyer_spending_authorizations from authenticated;
grant select, update on table public.buyer_spending_authorizations to authenticated;
grant all on table public.buyer_spending_authorizations to service_role;