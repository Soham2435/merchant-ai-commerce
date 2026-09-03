alter table public.orders
  add column if not exists idempotency_key text,
  add column if not exists idempotency_fingerprint bytea;

create unique index if not exists orders_merchant_idempotency_key_unique
  on public.orders (merchant_id, idempotency_key)
  where idempotency_key is not null;

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
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  authenticated_user_id uuid := auth.uid();
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

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  if length(p_idempotency_key) > 255 then
    raise exception 'idempotency_key is too long';
  end if;

  if not exists (
    select 1
      from public.merchant_members
     where merchant_id = p_merchant_id
       and user_id = authenticated_user_id
  ) then
    raise exception 'merchant membership is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array';
  end if;

  item_count := jsonb_array_length(p_items);

  if item_count = 0 then
    raise exception 'at least one item is required';
  end if;

  if item_count > 100 then
    raise exception 'too many order items';
  end if;

  for item in select value from jsonb_array_elements(p_items) as elements(value)
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

    if item_quantity <= 0 or item_quantity > 1000 then
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

  begin
    insert into public.orders (
      merchant_id,
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
$$;

revoke all on function public.create_pending_order(uuid, text, jsonb) from public;
grant execute on function public.create_pending_order(uuid, text, jsonb) to authenticated;
