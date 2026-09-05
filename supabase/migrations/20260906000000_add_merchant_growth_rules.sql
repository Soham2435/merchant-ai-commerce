-- Migration: Add merchant_growth_rules table and extend agent_audit_events event types

create table public.merchant_growth_rules (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  trigger_product_id uuid not null references public.products(id),
  recommended_product_id uuid not null references public.products(id),
  rule_type text not null default 'cross_sell',
  reason text not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  constraint merchant_growth_rules_rule_type_check check (rule_type = 'cross_sell'),
  constraint merchant_growth_rules_product_check check (trigger_product_id <> recommended_product_id)
);

-- Trigger to ensure both products belong to the same merchant
create or replace function public.validate_growth_rule_products() returns trigger language plpgsql as $$
begin
  if (select merchant_id from public.products where id = NEW.trigger_product_id) <> NEW.merchant_id then
    raise exception 'trigger_product must belong to the same merchant';
  end if;
  if (select merchant_id from public.products where id = NEW.recommended_product_id) <> NEW.merchant_id then
    raise exception 'recommended_product must belong to the same merchant';
  end if;
  return NEW;
end;
$$;

create trigger merchant_growth_rules_product_check
  before insert or update on public.merchant_growth_rules
  for each row execute function public.validate_growth_rule_products();

-- Partial unique index for active rules to prevent duplicates
create unique index merchant_growth_rules_active_unique on public.merchant_growth_rules (
  merchant_id, trigger_product_id, recommended_product_id, rule_type
) where active = true;

-- Enable row level security and policies
alter table public.merchant_growth_rules enable row level security;

create policy merchant_growth_rules_select
on public.merchant_growth_rules
for select
using (
  exists (
    select 1 from public.merchant_members
    where merchant_members.merchant_id = merchant_growth_rules.merchant_id
      and merchant_members.user_id = auth.uid()
  )
);


create policy merchant_growth_rules_insert
on public.merchant_growth_rules
for insert
with check (
  exists (
    select 1 from public.merchant_members
    where merchant_members.merchant_id = merchant_growth_rules.merchant_id
      and merchant_members.user_id = auth.uid()
      and merchant_members.role in ('owner','admin')
  )
);


-- Extend agent_audit_events event_type enum
alter table public.agent_audit_events drop constraint agent_audit_events_type_check;
alter table public.agent_audit_events add constraint agent_audit_events_type_check check (
  event_type in (
    'ai_recommendation',
    'purchase_proposed',
    'limit_exceeded',
    'order_created',
    'payment_verified',
    'payment_failed',
    'checkout_failed',
    'purchase_approved',
    'ai_growth_opportunity',
    'ai_growth_rule_approved'
  )
);
