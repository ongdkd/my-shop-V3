-- LND Mar26 MD: take the pieces of orders that are already shipped out of the
-- warehouse count, once. The round's products were never linked to the warehouse,
-- so the shipping trigger (2026-11-16b-ship-stock.sql) did not count them.
-- An order line "LND Mar26 MD เซ็ตรูปฟิล์ม (เซน)" is the warehouse item
-- "LND Mar26 MD เซ็ตรูปฟิล์ม", variant "เซน".
-- APPLIED 2026-11-16 through the admin page (17 rows, 20 pieces); kept as the record of
-- what was done. Running it now changes nothing: the flag below is already set.
-- Only run this if the counts in คลังสินค้า were taken BEFORE those orders went out.
-- Run once in the Supabase SQL Editor; a second run changes nothing. What was
-- taken off is kept in app_settings 'stock_fix_lnd_mar26_shipped'.
do $$
declare
  r jsonb;
begin
  if exists (select 1 from public.app_settings where key = 'stock_fix_lnd_mar26_shipped') then
    raise notice 'already done';
    return;
  end if;
  with item as (
    -- every countable warehouse row with the order label it corresponds to
    select s.id, s.stock,
           lower(regexp_replace(case when s.parent_id is null then s.name else p.name || ' (' || s.name || ')' end, '\s+', '', 'g')) as k
      from public.stock_items s
      left join public.stock_items p on p.id = s.parent_id
     where s.stock is not null
       and not exists (select 1 from public.stock_items c where c.parent_id = s.id)
  ), gone as (
    select lower(regexp_replace(o.product, '\s+', '', 'g')) as k, sum(o.qty) as qty
      from public.orders o
      join public.order_lists l on l.id = o.list_id
     where l.name = 'Love and Deepspace Mar26 MD' and o.shipped_at is not null
     group by 1
  ), fix as (
    update public.stock_items s
       set stock = greatest(0, s.stock - g.qty)
      from item i join gone g on g.k = i.k
     where s.id = i.id
    returning s.id, g.qty
  )
  select coalesce(jsonb_object_agg(id, qty), '{}'::jsonb) into r from fix;
  insert into public.app_settings (key, value)
  values ('stock_fix_lnd_mar26_shipped', jsonb_build_object('at', now(), 'taken_off', r));
  raise notice 'took shipped pieces off % warehouse rows', (select count(*) from jsonb_object_keys(r));
end $$;
