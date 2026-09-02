create extension if not exists pgcrypto;

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.merchant_members (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (merchant_id, user_id),
  constraint merchant_members_role_check check (role in ('owner', 'admin', 'member'))
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  name text not null,
  description text,
  sku text,
  price_minor bigint not null,
  currency text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_price_minor_check check (price_minor >= 0),
  constraint products_currency_check check (currency ~ '^[A-Z]{3}$'),
  unique (id, merchant_id)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  name text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, merchant_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  customer_id uuid,
  status text not null default 'pending',
  subtotal_minor bigint not null,
  tax_minor bigint not null default 0,
  shipping_minor bigint not null default 0,
  total_minor bigint not null,
  currency text not null,
  razorpay_order_id text,
  razorpay_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_subtotal_minor_check check (subtotal_minor >= 0),
  constraint orders_tax_minor_check check (tax_minor >= 0),
  constraint orders_shipping_minor_check check (shipping_minor >= 0),
  constraint orders_total_minor_check check (total_minor >= 0),
  constraint orders_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint orders_status_check check (status in ('pending', 'paid', 'failed', 'cancelled', 'fulfilled')),
  unique (id, merchant_id),
  foreign key (customer_id, merchant_id)
    references public.customers(id, merchant_id)
    on delete restrict
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete restrict,
  product_name text not null,
  quantity integer not null,
  unit_price_minor bigint not null,
  line_total_minor bigint not null,
  created_at timestamptz not null default now(),
  constraint order_items_quantity_check check (quantity > 0),
  constraint order_items_unit_price_minor_check check (unit_price_minor >= 0),
  constraint order_items_line_total_minor_check check (line_total_minor >= 0)
);

create unique index products_merchant_sku_unique
  on public.products (merchant_id, sku)
  where sku is not null;

create unique index customers_merchant_email_unique
  on public.customers (merchant_id, lower(email))
  where email is not null;

create unique index orders_razorpay_order_id_unique
  on public.orders (razorpay_order_id)
  where razorpay_order_id is not null;

create unique index orders_razorpay_payment_id_unique
  on public.orders (razorpay_payment_id)
  where razorpay_payment_id is not null;

create index merchant_members_user_id_idx
  on public.merchant_members (user_id);

create index products_merchant_active_idx
  on public.products (merchant_id, is_active);

create index customers_merchant_idx
  on public.customers (merchant_id);

create index orders_merchant_created_at_idx
  on public.orders (merchant_id, created_at desc);

create index orders_merchant_status_idx
  on public.orders (merchant_id, status);

create index order_items_order_id_idx
  on public.order_items (order_id);

create index order_items_product_id_idx
  on public.order_items (product_id);

create or replace function public.prevent_merchant_change()
returns trigger
language plpgsql
as $$
begin
  if new.merchant_id is distinct from old.merchant_id then
    raise exception 'merchant ownership cannot be changed';
  end if;

  return new;
end;
$$;

create trigger products_prevent_merchant_change
before update on public.products
for each row execute function public.prevent_merchant_change();

create trigger customers_prevent_merchant_change
before update on public.customers
for each row execute function public.prevent_merchant_change();

create trigger orders_prevent_merchant_change
before update on public.orders
for each row execute function public.prevent_merchant_change();

create or replace function public.validate_order_item_merchant()
returns trigger
language plpgsql
as $$
declare
  order_merchant_id uuid;
  product_merchant_id uuid;
begin
  if new.product_id is null then
    return new;
  end if;

  select merchant_id
    into order_merchant_id
    from public.orders
   where id = new.order_id;

  select merchant_id
    into product_merchant_id
    from public.products
   where id = new.product_id;

  if order_merchant_id is distinct from product_merchant_id then
    raise exception 'order item product must belong to the order merchant';
  end if;

  return new;
end;
$$;

create trigger order_items_validate_merchant
before insert or update on public.order_items
for each row execute function public.validate_order_item_merchant();

alter table public.merchants enable row level security;
alter table public.merchant_members enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy merchants_select_for_members
on public.merchants
for select
using (
  exists (
    select 1
      from public.merchant_members
     where merchant_members.merchant_id = merchants.id
       and merchant_members.user_id = auth.uid()
  )
);

create policy merchant_members_select_own_memberships
on public.merchant_members
for select
using (user_id = auth.uid());

create policy products_member_access
on public.products
for all
using (
  exists (
    select 1
      from public.merchant_members
     where merchant_members.merchant_id = products.merchant_id
       and merchant_members.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
      from public.merchant_members
     where merchant_members.merchant_id = products.merchant_id
       and merchant_members.user_id = auth.uid()
  )
);

create policy customers_member_access
on public.customers
for all
using (
  exists (
    select 1
      from public.merchant_members
     where merchant_members.merchant_id = customers.merchant_id
       and merchant_members.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
      from public.merchant_members
     where merchant_members.merchant_id = customers.merchant_id
       and merchant_members.user_id = auth.uid()
  )
);

create policy orders_member_access
on public.orders
for all
using (
  exists (
    select 1
      from public.merchant_members
     where merchant_members.merchant_id = orders.merchant_id
       and merchant_members.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
      from public.merchant_members
     where merchant_members.merchant_id = orders.merchant_id
       and merchant_members.user_id = auth.uid()
  )
);

create policy order_items_member_access
on public.order_items
for all
using (
  exists (
    select 1
      from public.orders
      join public.merchant_members
        on merchant_members.merchant_id = orders.merchant_id
       and merchant_members.user_id = auth.uid()
     where orders.id = order_items.order_id
  )
)
with check (
  exists (
    select 1
      from public.orders
      join public.merchant_members
        on merchant_members.merchant_id = orders.merchant_id
       and merchant_members.user_id = auth.uid()
     where orders.id = order_items.order_id
  )
);
