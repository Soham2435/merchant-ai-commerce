alter table public.orders
  add column if not exists buyer_user_id uuid
    references auth.users(id)
    on delete restrict;

create index if not exists orders_buyer_user_created_at_idx
  on public.orders (buyer_user_id, created_at desc)
  where buyer_user_id is not null;


drop policy if exists orders_buyer_select_own
  on public.orders;

create policy orders_buyer_select_own
on public.orders
for select
to authenticated
using (
  buyer_user_id = auth.uid()
);


drop policy if exists order_items_buyer_select_own
  on public.order_items;

create policy order_items_buyer_select_own
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
      from public.orders
     where orders.id = order_items.order_id
       and orders.buyer_user_id = auth.uid()
  )
);


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
set search_path = pg_catalog, extensions, public
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
  buyer_authorization_limit bigint;
  merchant_transaction_limit bigint;
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

  calculated_total := calculated_subtotal::bigint;

  select string_agg(
           product_ids[index]::text || ':' || quantities[index]::text,
           ',' order by product_ids[index]::text
         )
    into canonical_payload
    from generate_subscripts(product_ids, 1) as indexes(index);

  request_fingerprint := digest(canonical_payload, 'sha256');

    /*
   * Database-level buyer authorization.
   *
   * Merchant members use this RPC for the merchant workspace and
   * are authorized by merchant_members. Buyer callers must have
   * an explicit buyer spending authorization.
   *
   * The API performs the same buyer check for explainable UX,
   * but this database check prevents direct RPC calls from
   * bypassing the buyer authorization boundary.
   */
  if not exists (
    select 1
      from public.merchant_members
     where merchant_id = p_merchant_id
       and user_id = authenticated_user_id
  ) then

    select max_amount_minor
      into buyer_authorization_limit
      from public.buyer_spending_authorizations
     where user_id = authenticated_user_id
       and currency = order_currency;

    if buyer_authorization_limit is null then
      raise exception 'buyer spending authorization is required';
    end if;

    if calculated_total > buyer_authorization_limit then
      raise exception 'buyer spending authorization exceeded';
    end if;

  end if;
  
  /*
   * Merchant-side transaction constraint remains independent
   * from the buyer authorization.
   */
  select transaction_limit_minor
    into merchant_transaction_limit
    from public.merchants
   where id = p_merchant_id;

  if not found then
    raise exception 'merchant not found';
  end if;

  if merchant_transaction_limit is not null
     and calculated_total > merchant_transaction_limit then
    raise exception 'merchant transaction limit exceeded';
  end if;

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
      authenticated_user_id,
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


revoke all
on function public.create_pending_order(uuid, text, jsonb)
from public;

grant execute
on function public.create_pending_order(uuid, text, jsonb)
to authenticated;