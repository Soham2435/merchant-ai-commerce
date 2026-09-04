create table public.agent_audit_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references public.merchants(id) on delete cascade,
  event_type text not null,
  actor text not null default 'ai_buyer',
  payload jsonb,
  result text,
  created_at timestamptz not null default now(),
  constraint agent_audit_events_type_check check (
    event_type in (
      'ai_recommendation',
      'purchase_proposed',
      'limit_exceeded',
      'order_created',
      'payment_verified',
      'payment_failed'
    )
  )
);

create index agent_audit_events_merchant_created_at_idx
  on public.agent_audit_events (merchant_id, created_at desc);

alter table public.agent_audit_events enable row level security;

create policy agent_audit_events_select_for_members
on public.agent_audit_events
for select
using (
  exists (
    select 1
      from public.merchant_members
     where merchant_members.merchant_id = agent_audit_events.merchant_id
       and merchant_members.user_id = auth.uid()
  )
);