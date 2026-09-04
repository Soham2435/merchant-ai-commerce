alter table public.agent_audit_events
  drop constraint if exists agent_audit_events_type_check;

alter table public.agent_audit_events
  add constraint agent_audit_events_type_check check (
    event_type in (
      'ai_recommendation',
      'purchase_proposed',
      'limit_exceeded',
      'order_created',
      'payment_verified',
      'payment_failed',
      'checkout_failed'
    )
  );