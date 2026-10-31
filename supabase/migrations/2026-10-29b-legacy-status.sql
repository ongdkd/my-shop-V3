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

-- The customer lookup (customer_orders) that returns these rows is defined in
-- 2026-10-31-iship.sql, the latest version. It used to be redefined here too,
-- which replaced the newer one (no delivery bills on the customer page) when
-- this file was run again. To restore it, run 2026-10-31-iship.sql.
