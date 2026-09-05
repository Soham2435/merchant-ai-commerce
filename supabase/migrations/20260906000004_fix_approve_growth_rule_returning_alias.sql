-- Migration: Fix ambiguous RETURNING clause in approve_growth_rule RPC
-- Uses INSERT target alias `mgr` so that RETURNING mgr.id, mgr.created_at
-- does not collide with the RETURNS TABLE output columns of the same names.

create or replace function public.approve_growth_rule(
    p_trigger_product_id    uuid,
    p_recommended_product_id uuid,
    p_reason                 text,
    p_rule_type              text
) returns table (
    id                    uuid,
    merchant_id           uuid,
    trigger_product_id    uuid,
    recommended_product_id uuid,
    rule_type             text,
    reason                text,
    active                boolean,
    approved_at           timestamptz,
    created_at            timestamptz
) language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
    v_user_id     uuid        := auth.uid();
    v_merchant_id uuid;
    v_rule        record;
    v_approved_at timestamptz := clock_timestamp();
begin
    -- 1. Authentication
    if v_user_id is null then
        raise exception 'authentication required';
    end if;

    -- 2. Merchant authorization (owner or admin)
    select mm.merchant_id
      into v_merchant_id
      from public.merchant_members mm
     where mm.user_id = v_user_id
       and mm.role in ('owner', 'admin')
     limit 1;

    if v_merchant_id is null then
        raise exception 'user is not an owner or admin of any merchant';
    end if;

    -- 3. Input validation
    if p_rule_type <> 'cross_sell' then
        raise exception 'invalid request: rule_type must be cross_sell';
    end if;

    if p_trigger_product_id = p_recommended_product_id then
        raise exception 'invalid request: trigger and recommended product ids must differ';
    end if;

    if trim(p_reason) = '' then
        raise exception 'invalid request: reason cannot be empty';
    end if;

    -- 4. Product validation (both products must belong to the merchant and be active)
    if not exists (
        select 1
          from public.products p
         where p.id = p_trigger_product_id
           and p.merchant_id = v_merchant_id
           and p.is_active
    ) then
        raise exception 'invalid product: trigger product invalid or inactive';
    end if;

    if not exists (
        select 1
          from public.products p
         where p.id = p_recommended_product_id
           and p.merchant_id = v_merchant_id
           and p.is_active
    ) then
        raise exception 'invalid product: recommended product invalid or inactive';
    end if;

    -- 5. Duplicate active rule prevention
    if exists (
        select 1
          from public.merchant_growth_rules r
         where r.merchant_id           = v_merchant_id
           and r.trigger_product_id    = p_trigger_product_id
           and r.recommended_product_id = p_recommended_product_id
           and r.rule_type             = 'cross_sell'
           and r.active                = true
    ) then
        raise exception 'duplicate rule: this growth rule is already active';
    end if;

    -- 6. Insert the rule atomically.
    -- The INSERT uses the alias `mgr` so that RETURNING can reference
    -- mgr.id and mgr.created_at unambiguously, avoiding collisions with
    -- the identically-named RETURNS TABLE output columns.
    insert into public.merchant_growth_rules as mgr (
        merchant_id,
        trigger_product_id,
        recommended_product_id,
        rule_type,
        reason,
        active,
        approved_at
    )
    values (
        v_merchant_id,
        p_trigger_product_id,
        p_recommended_product_id,
        'cross_sell',
        trim(p_reason),
        true,
        v_approved_at
    )
    returning mgr.id, mgr.created_at
    into v_rule;

    -- 7. Audit the approval in the same transaction.
    insert into public.agent_audit_events (
        merchant_id,
        event_type,
        actor,
        payload,
        result,
        created_at
    )
    values (
        v_merchant_id,
        'ai_growth_rule_approved',
        'merchant',
        jsonb_build_object(
            'user_id',               v_user_id,
            'rule_id',               v_rule.id,
            'trigger_product_id',    p_trigger_product_id,
            'recommended_product_id', p_recommended_product_id,
            'rule_type',             'cross_sell',
            'reason',                trim(p_reason),
            'approved_at',           v_approved_at
        ),
        'approved',
        v_approved_at
    );

    -- 8. Return the approved rule row.
    return query
    select
        v_rule.id,
        v_merchant_id,
        p_trigger_product_id,
        p_recommended_product_id,
        'cross_sell'::text,
        trim(p_reason),
        true,
        v_approved_at,
        v_rule.created_at;
end;
$function$;

revoke execute on function public.approve_growth_rule(uuid, uuid, text, text) from public;
grant  execute on function public.approve_growth_rule(uuid, uuid, text, text) to authenticated;
