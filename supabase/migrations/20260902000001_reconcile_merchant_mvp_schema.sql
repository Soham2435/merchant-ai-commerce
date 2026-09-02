create extension if not exists pgcrypto;

-- Validate the existing tables before making any schema changes.
do $$
declare
  invalid_count bigint;
begin
  if to_regclass('public.merchants') is null then
    raise exception 'Reconciliation aborted: public.merchants does not exist';
  end if;

  if to_regclass('public.products') is null then
    raise exception 'Reconciliation aborted: public.products does not exist';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'merchants'
       and column_name = 'id'
       and data_type = 'uuid'
  ) then
    raise exception 'Reconciliation aborted: public.merchants.id must be uuid';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'id'
       and data_type = 'uuid'
  ) then
    raise exception 'Reconciliation aborted: public.products.id must be uuid';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'merchant_id'
       and data_type = 'uuid'
  ) then
    raise exception 'Reconciliation aborted: public.products.merchant_id must be uuid';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'price_paise'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'price_minor'
  ) then
    raise exception 'Reconciliation aborted: products.price_paise or products.price_minor is required';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'price_paise'
  ) and exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'price_minor'
  ) then
    raise exception 'Reconciliation aborted: both products.price_paise and products.price_minor exist';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'active'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'is_active'
  ) then
    raise exception 'Reconciliation aborted: products.active or products.is_active is required';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'active'
  ) and exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'is_active'
  ) then
    raise exception 'Reconciliation aborted: both products.active and products.is_active exist';
  end if;

  execute 'select count(*) from public.products where price_paise < 0'
    into invalid_count;
  if invalid_count > 0 then
    raise exception 'Reconciliation aborted: % products have a negative price_paise', invalid_count;
  end if;

  execute 'select count(*) from public.products where price_paise is null'
    into invalid_count;
  if invalid_count > 0 then
    raise exception 'Reconciliation aborted: % products have a null price_paise', invalid_count;
  end if;

  execute 'select count(*) from public.products where currency !~ ''^[A-Z]{3}$'''
    into invalid_count;
  if invalid_count > 0 then
    raise exception 'Reconciliation aborted: % products have invalid currency values', invalid_count;
  end if;

  execute 'select count(*) from public.products where currency is null'
    into invalid_count;
  if invalid_count > 0 then
    raise exception 'Reconciliation aborted: % products have a null currency', invalid_count;
  end if;

  execute 'select count(*) from public.products where active is null'
    into invalid_count;
  if invalid_count > 0 then
    raise exception 'Reconciliation aborted: % products have a null active value', invalid_count;
  end if;

  execute 'select count(*) from public.products p left join public.merchants m on m.id = p.merchant_id where m.id is null'
    into invalid_count;
  if invalid_count > 0 then
    raise exception 'Reconciliation aborted: % products reference a missing merchant', invalid_count;
  end if;
end;
$$;

-- Preserve existing merchant columns and values; add only the missing timestamp.
alter table public.merchants
  add column if not exists updated_at timestamptz not null default now();

-- Preserve category and metadata for existing application compatibility.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'price_paise'
  ) then
    alter table public.products rename column price_paise to price_minor;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'products'
       and column_name = 'active'
  ) then
    alter table public.products rename column active to is_active;
  end if;
end;
$$;

alter table public.products
  add column if not exists sku text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.products
  alter column price_minor type bigint using price_minor::bigint;

-- Validate again after the schema-safe renames and before adding constraints.
do $$
declare
  invalid_count bigint;
begin
  execute 'select count(*) from public.products where price_minor < 0'
    into invalid_count;
  if invalid_count > 0 then
    raise exception 'Reconciliation aborted: % products have a negative price_minor', invalid_count;
  end if;

  execute 'select count(*) from public.products where price_minor is null'
    into invalid_count;
  if invalid_count > 0 then
    raise exception 'Reconciliation aborted: % products have a null price_minor', invalid_count;
  end if;

  execute 'select count(*) from public.products where currency !~ ''^[A-Z]{3}$'''
    into invalid_count;
  if invalid_count > 0 then
    raise exception 'Reconciliation aborted: % products have invalid currency values', invalid_count;
  end if;

  execute 'select count(*) from public.products where currency is null'
    into invalid_count;
  if invalid_count > 0 then
    raise exception 'Reconciliation aborted: % products have a null currency', invalid_count;
  end if;

  execute 'select count(*) from public.products where is_active is null'
    into invalid_count;
  if invalid_count > 0 then
    raise exception 'Reconciliation aborted: % products have a null is_active value', invalid_count;
  end if;

  execute 'select count(*) from public.products p left join public.merchants m on m.id = p.merchant_id where m.id is null'
    into invalid_count;
  if invalid_count > 0 then
    raise exception 'Reconciliation aborted: % products reference a missing merchant', invalid_count;
  end if;
end;
$$;

alter table public.products
  alter column price_minor set not null,
  alter column currency set not null,
  alter column is_active set not null,
  alter column is_active set default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.products'::regclass
       and conname = 'products_price_minor_check'
  ) then
    alter table public.products
      add constraint products_price_minor_check check (price_minor >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.products'::regclass
       and conname = 'products_currency_check'
  ) then
    alter table public.products
      add constraint products_currency_check check (currency ~ '^[A-Z]{3}$');
  end if;
end;
$$;

create table if not exists public.merchant_members (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (merchant_id, user_id),
  constraint merchant_members_role_check check (role in ('owner', 'admin', 'member'))
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  name text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, merchant_id)
);

create table if not exists public.orders (
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

create table if not exists public.order_items (
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

create unique index if not exists products_merchant_sku_unique
  on public.products (merchant_id, sku)
  where sku is not null;

create unique index if not exists customers_merchant_email_unique
  on public.customers (merchant_id, lower(email))
  where email is not null;

create unique index if not exists orders_razorpay_order_id_unique
  on public.orders (razorpay_order_id)
  where razorpay_order_id is not null;

create unique index if not exists orders_razorpay_payment_id_unique
  on public.orders (razorpay_payment_id)
  where razorpay_payment_id is not null;

create index if not exists merchant_members_user_id_idx
  on public.merchant_members (user_id);

create index if not exists products_merchant_active_idx
  on public.products (merchant_id, is_active);

create index if not exists customers_merchant_idx
  on public.customers (merchant_id);

create index if not exists orders_merchant_created_at_idx
  on public.orders (merchant_id, created_at desc);

create index if not exists orders_merchant_status_idx
  on public.orders (merchant_id, status);

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

create index if not exists order_items_product_id_idx
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

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'products_prevent_merchant_change' and tgrelid = 'public.products'::regclass) then
    create trigger products_prevent_merchant_change
    before update on public.products
    for each row execute function public.prevent_merchant_change();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'customers_prevent_merchant_change' and tgrelid = 'public.customers'::regclass) then
    create trigger customers_prevent_merchant_change
    before update on public.customers
    for each row execute function public.prevent_merchant_change();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'orders_prevent_merchant_change' and tgrelid = 'public.orders'::regclass) then
    create trigger orders_prevent_merchant_change
    before update on public.orders
    for each row execute function public.prevent_merchant_change();
  end if;
end;
$$;

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

  select merchant_id into order_merchant_id from public.orders where id = new.order_id;
  select merchant_id into product_merchant_id from public.products where id = new.product_id;

  if order_merchant_id is distinct from product_merchant_id then
    raise exception 'order item product must belong to the order merchant';
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'order_items_validate_merchant' and tgrelid = 'public.order_items'::regclass) then
    create trigger order_items_validate_merchant
    before insert or update on public.order_items
    for each row execute function public.validate_order_item_merchant();
  end if;
end;
$$;

alter table public.merchants enable row level security;
alter table public.merchant_members enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'merchants' and policyname = 'merchants_select_for_members') then
    create policy merchants_select_for_members on public.merchants for select using (exists (select 1 from public.merchant_members where merchant_members.merchant_id = merchants.id and merchant_members.user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'merchant_members' and policyname = 'merchant_members_select_own_memberships') then
    create policy merchant_members_select_own_memberships on public.merchant_members for select using (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'products' and policyname = 'products_member_access') then
    create policy products_member_access on public.products for all using (exists (select 1 from public.merchant_members where merchant_members.merchant_id = products.merchant_id and merchant_members.user_id = auth.uid())) with check (exists (select 1 from public.merchant_members where merchant_members.merchant_id = products.merchant_id and merchant_members.user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customers' and policyname = 'customers_member_access') then
    create policy customers_member_access on public.customers for all using (exists (select 1 from public.merchant_members where merchant_members.merchant_id = customers.merchant_id and merchant_members.user_id = auth.uid())) with check (exists (select 1 from public.merchant_members where merchant_members.merchant_id = customers.merchant_id and merchant_members.user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_member_access') then
    create policy orders_member_access on public.orders for all using (exists (select 1 from public.merchant_members where merchant_members.merchant_id = orders.merchant_id and merchant_members.user_id = auth.uid())) with check (exists (select 1 from public.merchant_members where merchant_members.merchant_id = orders.merchant_id and merchant_members.user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_items' and policyname = 'order_items_member_access') then
    create policy order_items_member_access on public.order_items for all using (exists (select 1 from public.orders join public.merchant_members on merchant_members.merchant_id = orders.merchant_id and merchant_members.user_id = auth.uid() where orders.id = order_items.order_id)) with check (exists (select 1 from public.orders join public.merchant_members on merchant_members.merchant_id = orders.merchant_id and merchant_members.user_id = auth.uid() where orders.id = order_items.order_id));
  end if;
end;
$$;
