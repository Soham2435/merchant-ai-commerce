do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'products'
      and policyname = 'products_buyer_active_select'
  ) then
    create policy products_buyer_active_select
    on public.products
    for select
    to authenticated
    using (
      is_active = true
    );
  end if;
end
$$;