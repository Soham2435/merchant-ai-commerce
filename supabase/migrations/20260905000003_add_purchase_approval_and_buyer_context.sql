-- 1. Add approved_at timestamp to orders
alter table public.orders
  add column if not exists approved_at timestamptz;

-- 2. Update agent_audit_events constraint to allow 'purchase_approved'
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
      'checkout_failed',
      'purchase_approved'
    )
  );

-- 3. Define the 4-argument create_pending_order implementation (NO default value on p_is_buyer)
create or replace function public.create_pending_order(
  p_merchant_id uuid,
  p_idempotency_key text,
  p_items jsonb,
  p_is_buyer boolean
)
returns table (
  order_id uuid,
  subtotal_minor bigint,
  total_minor bigint,
  currency text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  authenticated_user_id uuid := auth.uid();
  is_merchant_member boolean := false;
  buyer_authorization_limit bigint;
  merchant_transaction_limit bigint;

  existing_order public.orders%rowtype;
  created_order_id uuid;

  item jsonb;
  item_product_id uuid;
  item_quantity integer;

  product_name text;
  product_price_minor bigint;
  product_currency text;
  order_currency text;

  item_line_total numeric;
  calculated_subtotal numeric := 0;
  calculated_total bigint;

  canonical_payload text;
  request_fingerprint bytea;

  product_ids uuid[] := array[]::uuid[];
  product_names text[] := array[]::text[];
  quantities integer[] := array[]::integer[];
  unit_prices bigint[] := array[]::bigint[];
  line_totals bigint[] := array[]::bigint[];

  item_count integer := 0;
  item_index integer;
begin
  if authenticated_user_id is null then
    raise exception 'authentication is required';
  end if;

  if p_merchant_id is null then
    raise exception 'merchant_id is required';
  end if;

  if p_idempotency_key is null
     or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  if length(p_idempotency_key) > 255 then
    raise exception 'idempotency_key is too long';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array';
  end if;

  item_count := jsonb_array_length(p_items);

  if item_count = 0 then
    raise exception 'at least one item is required';
  end if;

  if item_count > 100 then
    raise exception 'too many order items';
  end if;

  select exists (
    select 1
      from public.merchant_members as mm
     where mm.merchant_id = p_merchant_id
       and mm.user_id = authenticated_user_id
  )
  into is_merchant_member;

  if not p_is_buyer and not is_merchant_member then
    raise exception 'merchant membership is required';
  end if;

  for item in
    select value
      from jsonb_array_elements(p_items) as elements(value)
  loop
    if jsonb_typeof(item) <> 'object'
       or not (item ? 'product_id')
       or jsonb_typeof(item->'product_id') <> 'string'
       or (item->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      raise exception 'each item must contain a valid product_id';
    end if;

    if not (item ? 'quantity')
       or jsonb_typeof(item->'quantity') <> 'number'
       or (item->>'quantity') !~ '^[0-9]+$'
    then
      raise exception 'each item must contain a positive integer quantity';
    end if;

    item_quantity := (item->>'quantity')::integer;

    if item_quantity <= 0
       or item_quantity > 1000 then
      raise exception 'quantity must be between 1 and 1000';
    end if;

    item_product_id := (item->>'product_id')::uuid;

    if item_product_id = any(product_ids) then
      raise exception 'duplicate product_id is not allowed';
    end if;

    select p.name, p.price_minor, p.currency
      into product_name, product_price_minor, product_currency
      from public.products as p
     where p.id = item_product_id
       and p.merchant_id = p_merchant_id
       and p.is_active
     for share;

    if not found then
      raise exception 'product is missing, inactive, or not part of the merchant';
    end if;

    if order_currency is null then
      order_currency := product_currency;
    elsif order_currency <> product_currency then
      raise exception 'all products must use the same currency';
    end if;

    item_line_total := product_price_minor::numeric * item_quantity;

    if item_line_total > 9223372036854775807 then
      raise exception 'order line total exceeds the supported limit';
    end if;

    calculated_subtotal := calculated_subtotal + item_line_total;

    if calculated_subtotal > 9223372036854775807 then
      raise exception 'order total exceeds the supported limit';
    end if;

    product_ids := array_append(product_ids, item_product_id);
    product_names := array_append(product_names, product_name);
    quantities := array_append(quantities, item_quantity);
    unit_prices := array_append(unit_prices, product_price_minor);
    line_totals := array_append(line_totals, item_line_total::bigint);
  end loop;

  select string_agg(
           product_ids[index]::text || ':' || quantities[index]::text,
           ',' order by product_ids[index]::text
         )
    into canonical_payload
    from generate_subscripts(product_ids, 1) as indexes(index);

  request_fingerprint := digest(canonical_payload, 'sha256');

  /*
   * Preserve idempotency: return existing order if matching fingerprint.
   */
  select *
    into existing_order
    from public.orders
   where merchant_id = p_merchant_id
     and idempotency_key = p_idempotency_key;

  if found then
    if existing_order.idempotency_fingerprint is distinct from request_fingerprint then
      raise exception 'idempotency key conflict: the request payload differs from the existing order';
    end if;

    return query
    select existing_order.id,
           existing_order.subtotal_minor,
           existing_order.total_minor,
           existing_order.currency;

    return;
  end if;

  calculated_total := calculated_subtotal::bigint;

  /*
   * Buyer authorization is required whenever p_is_buyer is true.
   * This applies even if the caller also happens to be a merchant member.
   */
  if p_is_buyer then
    select bsa.max_amount_minor
      into buyer_authorization_limit
      from public.buyer_spending_authorizations as bsa
     where bsa.user_id = authenticated_user_id
       and bsa.currency = order_currency;

    if buyer_authorization_limit is null then
      raise exception 'buyer spending authorization is required';
    end if;

    if calculated_total > buyer_authorization_limit then
      raise exception 'buyer spending authorization exceeded';
    end if;
  end if;

  /*
   * Merchant transaction limit check.
   */
  select m.transaction_limit_minor
    into merchant_transaction_limit
    from public.merchants as m
   where m.id = p_merchant_id;

  if not found then
    raise exception 'merchant not found';
  end if;

  if merchant_transaction_limit is not null
     and calculated_total > merchant_transaction_limit then
    raise exception 'merchant transaction limit exceeded';
  end if;

  begin
    insert into public.orders (
      merchant_id,
      buyer_user_id,
      idempotency_key,
      idempotency_fingerprint,
      status,
      subtotal_minor,
      tax_minor,
      shipping_minor,
      total_minor,
      currency,
      customer_id,
      razorpay_order_id,
      razorpay_payment_id
    )
    values (
      p_merchant_id,
      case
        when p_is_buyer then authenticated_user_id
        else null
      end,
      p_idempotency_key,
      request_fingerprint,
      'pending',
      calculated_total,
      0,
      0,
      calculated_total,
      order_currency,
      null,
      null,
      null
    )
    returning id into created_order_id;

  exception
    when unique_violation then
      select *
        into existing_order
        from public.orders
       where merchant_id = p_merchant_id
         and idempotency_key = p_idempotency_key;

      if not found then
        raise;
      end if;

      if existing_order.idempotency_fingerprint is distinct from request_fingerprint then
        raise exception 'idempotency key conflict: the request payload differs from the existing order';
      end if;

      return query
      select existing_order.id,
             existing_order.subtotal_minor,
             existing_order.total_minor,
             existing_order.currency;

      return;
  end;

  for item_index in 1..array_length(product_ids, 1)
  loop
    insert into public.order_items (
      order_id,
      product_id,
      product_name,
      quantity,
      unit_price_minor,
      line_total_minor
    )
    values (
      created_order_id,
      product_ids[item_index],
      product_names[item_index],
      quantities[item_index],
      unit_prices[item_index],
      line_totals[item_index]
    );
  end loop;

  return query
  select created_order_id,
         calculated_total,
         calculated_total,
         order_currency;
end;
$function$;

-- 4. Retain the 3-argument create_pending_order wrapper for merchant compatibility
create or replace function public.create_pending_order(
  p_merchant_id uuid,
  p_idempotency_key text,
  p_items jsonb
)
returns table (
  order_id uuid,
  subtotal_minor bigint,
  total_minor bigint,
  currency text
)
language sql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $$
  select * from public.create_pending_order(p_merchant_id, p_idempotency_key, p_items, false);
$$;

revoke execute on function public.create_pending_order(uuid, text, jsonb, boolean) from public;
grant execute on function public.create_pending_order(uuid, text, jsonb, boolean) to authenticated;

revoke execute on function public.create_pending_order(uuid, text, jsonb) from public;
grant execute on function public.create_pending_order(uuid, text, jsonb) to authenticated;

-- 5. Dedicated atomic approval function
create or replace function public.approve_buyer_order(
  p_order_id uuid
)
returns table (
  order_id uuid,
  status text,
  approved_at timestamptz,
  total_minor bigint,
  currency text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'extensions', 'public'
as $function$
declare
  authenticated_user_id uuid := auth.uid();
  target_order public.orders%rowtype;
  buyer_authorization_limit bigint;
  merchant_transaction_limit bigint;
  current_approval_time timestamptz;
begin
  if authenticated_user_id is null then
    raise exception 'authentication is required';
  end if;

  if p_order_id is null then
    raise exception 'order_id is required';
  end if;

  -- Lock target order row for update
  select *
    into target_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'order not found';
  end if;

  if target_order.buyer_user_id is distinct from authenticated_user_id then
    raise exception 'unauthorized: only the buyer who created the order can approve it';
  end if;

  if target_order.status <> 'pending' then
    raise exception 'only pending orders can be approved';
  end if;

  -- Idempotency check: if already approved, return existing state safely
  if target_order.approved_at is not null then
    return query
    select target_order.id,
           target_order.status,
           target_order.approved_at,
           target_order.total_minor,
           target_order.currency;
    return;
  end if;

  -- Re-check buyer spending authorization
  select bsa.max_amount_minor
    into buyer_authorization_limit
    from public.buyer_spending_authorizations as bsa
   where bsa.user_id = authenticated_user_id
     and bsa.currency = target_order.currency;

  if buyer_authorization_limit is null then
    raise exception 'buyer spending authorization is required';
  end if;

  if target_order.total_minor > buyer_authorization_limit then
    raise exception 'buyer spending authorization exceeded';
  end if;

  -- Re-check merchant transaction limit
  select m.transaction_limit_minor
    into merchant_transaction_limit
    from public.merchants as m
   where m.id = target_order.merchant_id;

  if not found then
    raise exception 'merchant not found';
  end if;

  if merchant_transaction_limit is not null
     and target_order.total_minor > merchant_transaction_limit then
    raise exception 'merchant transaction limit exceeded';
  end if;

  current_approval_time := clock_timestamp();

  -- Atomically update order and record audit event
  update public.orders
     set approved_at = current_approval_time,
         updated_at = current_approval_time
   where id = target_order.id;

  insert into public.agent_audit_events (
    merchant_id,
    event_type,
    actor,
    payload,
    result,
    created_at
  ) values (
    target_order.merchant_id,
    'purchase_approved',
    'buyer',
    jsonb_build_object(
      'order_id', target_order.id,
      'buyer_user_id', authenticated_user_id,
      'merchant_id', target_order.merchant_id,
      'total_minor', target_order.total_minor,
      'currency', target_order.currency,
      'approved_at', current_approval_time
    ),
    'approved',
    current_approval_time
  );

  return query
  select target_order.id,
         target_order.status,
         current_approval_time,
         target_order.total_minor,
         target_order.currency;
end;
$function$;

revoke execute on function public.approve_buyer_order(uuid) from public;
grant execute on function public.approve_buyer_order(uuid) to authenticated;
