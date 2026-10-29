-- Old status sheet imported into the database, so old orders are managed
-- in admin and shown to customers without reading the sheet.
-- Needs 2026-10-29-order-status-payments.sql first. Safe to run more than once.

create table if not exists public.legacy_orders (
  id       bigint generated always as identity primary key,
  sort     int  not null default 0,           -- original sheet order
  round    text not null default '',          -- sheet tab, e.g. "กรกฎาคม-กันยายน 2026"
  customer text not null default '',          -- raw cell; may hold several @names
  product  text not null default '',
  qty      text not null default '',
  pay      text not null default '',
  status   text not null default '',          -- '' waiting · 'จัดส่งแล้ว' · 'ยกเลิก' · custom
  tracking text not null default '',
  note     text not null default '',
  imported_at timestamptz not null default now()
);
create index if not exists legacy_orders_sort_idx on public.legacy_orders(sort);

alter table public.legacy_orders enable row level security;
drop policy if exists legacy_orders_admin_all on public.legacy_orders;
create policy legacy_orders_admin_all on public.legacy_orders
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Replaces every imported row in one transaction (a failed import keeps the old rows)
create or replace function public.admin_import_legacy(p_rows jsonb)
returns int language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'bad rows'; end if;
  delete from public.legacy_orders where true;
  insert into public.legacy_orders(sort, round, customer, product, qty, pay, status, tracking, note)
  select t.i::int, coalesce(r->>'round', ''), coalesce(r->>'customer', ''), coalesce(r->>'product', ''),
         coalesce(r->>'qty', ''), coalesce(r->>'pay', ''), coalesce(r->>'status', ''),
         coalesce(r->>'tracking', ''), coalesce(r->>'note', '')
    from jsonb_array_elements(p_rows) with ordinality as t(r, i);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.admin_import_legacy(jsonb) from public;
grant execute on function public.admin_import_legacy(jsonb) to authenticated;

-- Customer lookup now also returns their imported sheet rows
create or replace function public.customer_orders(p_name text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v text := public.norm_customer(p_name);
begin
  if length(v) < 2 then
    return jsonb_build_object('orders', '[]'::jsonb, 'payments', '[]'::jsonb, 'legacy', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'listId', o.list_id, 'listName', l.name, 'product', o.product, 'qty', o.qty,
        'payType', o.pay_type, 'total', o.total, 'totalFull', o.total_full,
        'status', o.status, 'shippedAt', o.shipped_at, 'tracking', o.tracking,
        'createdAt', o.created_at) order by o.created_at desc)
      from public.orders o join public.order_lists l on l.id = o.list_id
      where public.norm_customer(o.customer) = v), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'listId', p.list_id, 'amount', p.amount, 'paidAt', p.paid_at,
        'createdAt', p.created_at, 'hasAddress', p.address <> '') order by p.created_at desc)
      from public.payments p
      where public.norm_customer(p.customer) = v), '[]'::jsonb),
    'legacy', coalesce((
      select jsonb_agg(jsonb_build_object(
        'round', g.round, 'product', g.product, 'qty', g.qty, 'pay', g.pay,
        'status', g.status, 'tracking', g.tracking, 'note', g.note) order by g.sort)
      from public.legacy_orders g
      where v = any (select public.norm_customer(x) from regexp_split_to_table(g.customer, '[\s,]+') x)), '[]'::jsonb));
end $$;
