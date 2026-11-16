-- ── Warehouse stock = pieces physically on the shelf ──
-- Until now a piece left the warehouse count when it was moved into a round.
-- From here on it leaves when its order is shipped, or sold over the counter (POS).
-- Moving pieces into a round only reserves them. Only products that came from the
-- warehouse (products.source_stock_item_id) are counted; everything else is untouched.
-- Run once in the Supabase SQL Editor. Safe to run again.

-- The variant row of a warehouse item: by barcode, then by name
create or replace function public.stock_child(p_parent uuid, p_code text, p_name text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select k.id from public.stock_items k
   where k.parent_id = p_parent
     and ((btrim(coalesce(p_code, '')) <> '' and lower(btrim(k.code)) = lower(btrim(p_code)))
          or lower(btrim(k.name)) = lower(btrim(coalesce(p_name, ''))))
   order by (btrim(coalesce(p_code, '')) <> '' and lower(btrim(k.code)) = lower(btrim(p_code))) desc
   limit 1
$$;
revoke all on function public.stock_child(uuid, text, text) from public, anon, authenticated;

-- The warehouse row an order line came from; null when its product is not from the warehouse.
-- An order's product is the product's name, or "name (option)" (same rule as remove_order_rows).
create or replace function public.order_stock_item(p_list uuid, p_product text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  prod   public.products%rowtype;
  v_opt  text;
  v_code text;
begin
  select * into prod from public.products p
   where p.list_id = p_list
     and (p.name = p_product
          or (left(p_product, length(p.name) + 2) = p.name || ' (' and right(p_product, 1) = ')'))
   order by (p.name = p_product) desc, length(p.name) desc
   limit 1;
  if not found or prod.source_stock_item_id is null then return null; end if;
  if prod.name = p_product then return prod.source_stock_item_id; end if;
  v_opt := substr(p_product, length(prod.name) + 3, length(p_product) - length(prod.name) - 3);
  select d->>'code' into v_code
    from jsonb_array_elements(coalesce(prod.option_details, '[]'::jsonb)) d
   where btrim(coalesce(d->>'name', '')) = v_opt
   limit 1;
  return public.stock_child(prod.source_stock_item_id, v_code, v_opt);
end;
$$;
revoke all on function public.order_stock_item(uuid, text) from public, anon, authenticated;

-- Shipped (or un-shipped) → the shelf count follows. One trigger, so every way an
-- order gets shipped is covered: admin, the delivery bill, iShip, the sheet sync.
create or replace function public.orders_move_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was  numeric := 0;  -- pieces of this row already off the shelf
  v_now  numeric := 0;  -- pieces off the shelf after this change
  v_item uuid;
begin
  -- Off the shelf = shipped, or sold over the counter
  if tg_op = 'UPDATE' then
    if old.shipped_at is not null or old.remark = 'POS' then v_was := old.qty; end if;
  end if;
  if new.shipped_at is not null or new.remark = 'POS' then v_now := new.qty; end if;
  if tg_op = 'UPDATE' then
    if v_was = v_now and old.product = new.product and old.list_id = new.list_id then return null; end if;
  end if;
  if v_was > 0 then
    v_item := public.order_stock_item(old.list_id, old.product);
    update public.stock_items set stock = stock + v_was where id = v_item and stock is not null;
  end if;
  if v_now > 0 then
    v_item := public.order_stock_item(new.list_id, new.product);
    -- ponytail: a count that would go below zero stops at zero — shipping is never
    -- blocked by a wrong count; correct the number in คลังสินค้า if that happens
    update public.stock_items set stock = greatest(0, stock - v_now) where id = v_item and stock is not null;
  end if;
  return null;
end;
$$;
drop trigger if exists orders_move_stock on public.orders;
create trigger orders_move_stock
  after insert or update of shipped_at, qty, product, list_id, remark on public.orders
  for each row execute function public.orders_move_stock();

-- Pieces on the shelf that are already spoken for, per warehouse row: what a round
-- still offers, plus what is sold and waiting to be shipped. Free to move = stock − this.
create or replace function public.stock_reserved()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(item, qty), '{}'::jsonb) from (
    select item, sum(qty) as qty from (
      -- still offered in a round: single products…
      select p.source_stock_item_id as item, p.remaining as qty
        from public.products p
       where p.source_stock_item_id is not null and p.remaining is not null
         and jsonb_array_length(coalesce(p.option_details, '[]'::jsonb)) = 0
      union all
      -- …and each variant
      select public.stock_child(p.source_stock_item_id, d->>'code', d->>'name'), (d->>'remaining')::numeric
        from public.products p, jsonb_array_elements(coalesce(p.option_details, '[]'::jsonb)) d
       where p.source_stock_item_id is not null and d->>'remaining' is not null
      union all
      -- sold, waiting to be shipped
      select public.order_stock_item(o.list_id, o.product), o.qty
        from public.orders o
       where o.shipped_at is null and o.status is distinct from 'ยกเลิก' and o.remark is distinct from 'POS'
    ) x
    where item is not null and qty > 0
    group by item
  ) y
$$;
revoke all on function public.stock_reserved() from public, anon, authenticated;

create or replace function public.admin_stock_reserved()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then return '{}'::jsonb; end if;
  return public.stock_reserved();
end;
$$;
revoke all on function public.admin_stock_reserved() from public, anon;
grant execute on function public.admin_stock_reserved() to authenticated;

-- One-time correction: the old way already took reserved pieces out of the count,
-- so they go back in. What was added is kept in app_settings 'stock_on_shelf'.
do $$
declare
  r jsonb;
begin
  if not exists (select 1 from public.app_settings where key = 'stock_on_shelf') then
    r := public.stock_reserved();
    update public.stock_items s
       set stock = s.stock + (r->>(s.id::text))::numeric
     where s.stock is not null and r ? (s.id::text);
    insert into public.app_settings (key, value) values ('stock_on_shelf', jsonb_build_object('at', now(), 'added', r));
  end if;
end $$;
