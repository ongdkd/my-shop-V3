-- Staff roles: "admin" can use everything; "pos" can only use the POS screen.
-- Run once in the Supabase SQL Editor. Safe to run again.
--
-- Logins themselves are Supabase Auth accounts (e.g. staff@kagashop.admin), created from
-- admin → ทีมงาน (staff-users function). This table only says what each login may do.

create table if not exists public.staff_roles (
  email      text primary key check (email = lower(email)),
  role       text not null check (role in ('admin', 'pos')),
  created_at timestamptz not null default now()
);
alter table public.staff_roles enable row level security;

-- Admin = the existing allowlist, an "admin" row here, or an account marked admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) or exists (
    select 1 from public.staff_roles s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', '')) and s.role = 'admin'
  ) or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- POS staff = admins plus logins with the "pos" role
create or replace function public.is_pos_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.staff_roles s
    where s.email = lower(coalesce(auth.jwt() ->> 'email', '')) and s.role = 'pos'
  );
$$;
revoke all on function public.is_pos_staff() from public;
grant execute on function public.is_pos_staff() to authenticated;

-- 'admin', 'pos' or null: which pages this login may open
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_admin() then 'admin' when public.is_pos_staff() then 'pos' else null end;
$$;
revoke all on function public.my_role() from public;
grant execute on function public.my_role() to authenticated;

-- Only admins see and change the roles
drop policy if exists staff_roles_admin_all on public.staff_roles;
create policy staff_roles_admin_all on public.staff_roles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Which rounds each POS login may use (admins: every round). Ticked in admin → ทีมงาน.
create table if not exists public.staff_rounds (
  email   text not null references public.staff_roles(email) on delete cascade on update cascade,
  list_id uuid not null references public.order_lists(id) on delete cascade,
  primary key (email, list_id)
);
alter table public.staff_rounds enable row level security;
drop policy if exists staff_rounds_admin_all on public.staff_rounds;
create policy staff_rounds_admin_all on public.staff_rounds
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- May this login sell from (and read) this round in POS?
create or replace function public.can_pos_list(p_list uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.staff_rounds r
    join public.staff_roles s on s.email = r.email and s.role = 'pos'
    where r.email = lower(coalesce(auth.jwt() ->> 'email', '')) and r.list_id = p_list
  );
$$;
revoke all on function public.can_pos_list(uuid) from public;
grant execute on function public.can_pos_list(uuid) to authenticated;

-- The rounds this login may use in POS; null = every round (admins)
create or replace function public.my_pos_lists()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_admin() then null
    else coalesce((select array_agg(r.list_id) from public.staff_rounds r
      join public.staff_roles s on s.email = r.email and s.role = 'pos'
      where r.email = lower(coalesce(auth.jwt() ->> 'email', ''))), '{}'::uuid[]) end;
$$;
revoke all on function public.my_pos_lists() from public;
grant execute on function public.my_pos_lists() to authenticated;

-- What POS staff may READ: their rounds, those rounds' products, and those rounds' POS sales.
-- They can't write any table directly.
drop policy if exists lists_pos_read on public.order_lists;
create policy lists_pos_read on public.order_lists
  for select to authenticated using (public.can_pos_list(id));
drop policy if exists products_pos_read on public.products;
create policy products_pos_read on public.products
  for select to authenticated using (public.can_pos_list(list_id));
drop policy if exists orders_pos_read on public.orders;
create policy orders_pos_read on public.orders
  for select to authenticated using (remark = 'POS' and public.can_pos_list(list_id));

-- Selling: the live submit_pos_sale, now open to POS staff for their rounds, run with the owner's rights
CREATE OR REPLACE FUNCTION public.submit_pos_sale(p_list_id uuid, p_items jsonb, p_checkout_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  it      jsonb;
  prod    public.products%rowtype;
  v_qty   numeric;
  v_opt   text;
  v_label text;
  v_detail jsonb;
  v_count integer := 0;
  req     record;
begin
  if not public.can_pos_list(p_list_id) then
    return jsonb_build_object('status', 'Error', 'message', 'Unauthorised');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('status', 'Error', 'message', 'No order items received');
  end if;
  if jsonb_array_length(p_items) > 100 then
    return jsonb_build_object('status', 'Error', 'message', 'Too many order items');
  end if;

  -- 1) validate every item
  for it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object'
       or coalesce(it->>'id', '') = ''
       or length(it->>'id') > 100
       or coalesce(it->>'quantity', '') !~ '^[1-9][0-9]*$'
       or (it->>'quantity')::numeric > 100
       or length(coalesce(it->>'selectedOption', '')) > 200 then
      return jsonb_build_object('status', 'Error', 'message', 'Invalid order item');
    end if;
    select * into prod from public.products
      where list_id = p_list_id and code = (it->>'id')
      limit 1;
    if not found then
      return jsonb_build_object('status', 'Error', 'message', 'Product not found: ' || coalesce(it->>'id', ''));
    end if;
    -- POS sends option names without the ":barcode" suffix, so accept
    -- both the raw stored value and its name part.
    v_opt := btrim(coalesce(it->>'selectedOption', ''));
    if btrim(prod.options) <> '' then
      if v_opt = '' or not exists (
        select 1 from unnest(string_to_array(prod.options, ',')) allowed(value)
        where btrim(allowed.value) = v_opt
           or btrim(split_part(allowed.value, ':', 1)) = v_opt
      ) then
        return jsonb_build_object('status', 'Error', 'message', 'Invalid product option: ' || prod.name);
      end if;
    elsif v_opt <> '' then
      return jsonb_build_object('status', 'Error', 'message', 'Product has no options: ' || prod.name);
    end if;
  end loop;

  -- 2) lock rows in a stable order and validate aggregate quantities
  for req in
    select item.value->>'id' as code, sum((item.value->>'quantity')::numeric) as qty
    from jsonb_array_elements(p_items) as item(value)
    group by item.value->>'id'
    order by item.value->>'id'
  loop
    select * into prod from public.products
      where list_id = p_list_id and code = req.code
      for update;
    if prod.remaining is not null and prod.remaining < req.qty then
      return jsonb_build_object('status', 'Error', 'message', 'Stock not enough for ' || prod.name);
    end if;
  end loop;

  -- Enforce the selected option's own stock in addition to the product total.
  for req in
    select item.value->>'id' as code,
           btrim(coalesce(item.value->>'selectedOption', '')) as option_name,
           sum((item.value->>'quantity')::numeric) as qty
    from jsonb_array_elements(p_items) as item(value)
    where btrim(coalesce(item.value->>'selectedOption', '')) <> ''
    group by item.value->>'id', btrim(coalesce(item.value->>'selectedOption', ''))
    order by item.value->>'id', btrim(coalesce(item.value->>'selectedOption', ''))
  loop
    select * into prod from public.products
      where list_id = p_list_id and code = req.code
      limit 1;
    if jsonb_array_length(coalesce(prod.option_details, '[]'::jsonb)) > 0 then
      select detail.value into v_detail
      from jsonb_array_elements(prod.option_details) detail(value)
      where btrim(coalesce(detail.value->>'name', '')) = req.option_name
         or (
           btrim(coalesce(detail.value->>'code', '')) <> ''
           and btrim(coalesce(detail.value->>'name', '')) || ':' || btrim(detail.value->>'code') = req.option_name
         )
      limit 1;
      if not found then
        return jsonb_build_object('status', 'Error', 'message', 'Invalid product option: ' || prod.name);
      end if;
      if v_detail ? 'remaining'
         and v_detail->>'remaining' is not null
         and (v_detail->>'remaining')::numeric < req.qty then
        return jsonb_build_object('status', 'Error', 'message', 'Stock not enough for ' || prod.name || ' (' || req.option_name || ')');
      end if;
    end if;
  end loop;

  -- Idempotency guard (see submit_order): duplicate retry = already saved
  if p_checkout_id is not null then
    begin
      insert into public.checkout_requests(id) values (p_checkout_id);
    exception when unique_violation then
      return jsonb_build_object('status', 'Success', 'duplicate', true);
    end;
  end if;

  -- 3) deduct stock + insert order rows
  for it in select * from jsonb_array_elements(p_items) loop
    select * into prod from public.products
      where list_id = p_list_id and code = (it->>'id')
      order by seq limit 1
      for update;

    v_qty := (it->>'quantity')::numeric;
    v_opt := btrim(coalesce(it->>'selectedOption', ''));

    if prod.remaining is not null then
      update public.products set remaining = remaining - v_qty where id = prod.id;
    end if;

    if v_opt <> '' and jsonb_array_length(coalesce(prod.option_details, '[]'::jsonb)) > 0 then
      update public.products p
      set option_details = coalesce((
        select jsonb_agg(
          case
            when (
              btrim(coalesce(detail.value->>'name', '')) = v_opt
              or (
                btrim(coalesce(detail.value->>'code', '')) <> ''
                and btrim(coalesce(detail.value->>'name', '')) || ':' || btrim(detail.value->>'code') = v_opt
              )
            ) and detail.value ? 'remaining' and detail.value->>'remaining' is not null
            then jsonb_set(
              detail.value,
              '{remaining}',
              to_jsonb(greatest(0::numeric, (detail.value->>'remaining')::numeric - v_qty)),
              true
            )
            else detail.value
          end
          order by detail.ordinality
        )
        from jsonb_array_elements(p.option_details) with ordinality detail(value, ordinality)
      ), '[]'::jsonb)
      where p.id = prod.id;
    end if;

    v_label := case when v_opt <> '' then prod.name || ' (' || v_opt || ')' else prod.name end;

    insert into public.orders
      (list_id, customer, product, qty, pay_type, price, total,
       yuan, total_yuan, full_price, total_full, remark, checkout_id)
    values
      (p_list_id, 'หน้าร้าน (POS)', v_label, v_qty, 'Full Price',
       coalesce(prod.price, 0), coalesce(prod.price, 0) * v_qty,
       coalesce(prod.yuan, 0), coalesce(prod.yuan, 0) * v_qty,
       coalesce(prod.price, 0), coalesce(prod.price, 0) * v_qty,
       'POS', p_checkout_id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('status', 'Success', 'saved', v_count);
end;
$function$;
revoke all on function public.submit_pos_sale(uuid, jsonb, uuid) from public, anon;
grant execute on function public.submit_pos_sale(uuid, jsonb, uuid) to authenticated;
