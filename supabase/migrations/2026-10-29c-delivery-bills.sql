-- Delivery bills: once items arrive in Thailand the shop groups a customer's
-- items into bills (combine several orders, or split one order), each with
-- its own delivery fee. The customer pays the rest of the price + fee per bill.
-- Also: sending the same slip again replaces the address on it, and each
-- payment records what it was for (deposit / full / balance).
-- Needs 2026-10-29-order-status-payments.sql first. Safe to run more than once.

-- ── Old status-sheet rows ────────────────────────────────────
-- The customer lookup below reads this table, so it must exist even if
-- 2026-10-29b-legacy-status.sql (the sheet import) was never run.
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

-- ── Bills ────────────────────────────────────────────────────
create table if not exists public.deliveries (
  id         uuid primary key default gen_random_uuid(),
  customer   text not null,               -- norm_customer() of the items' customer
  fee        numeric,                     -- delivery fee; null = not decided yet
  created_at timestamptz not null default now()
);
-- sent_at: when the shop sent the bill. Customers only see sent bills;
-- until then the items stay in "waiting to arrive" for them.
alter table public.deliveries add column if not exists sent_at timestamptz;
alter table public.deliveries enable row level security;
drop policy if exists deliveries_admin_all on public.deliveries;
create policy deliveries_admin_all on public.deliveries
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.orders
  add column if not exists delivery_id uuid references public.deliveries(id) on delete set null;
create index if not exists orders_delivery_idx on public.orders(delivery_id);

-- kind: deposit = first payment on a list with deposit items, full = paid in
-- full up front, balance = rest of the price + delivery fee for one bill
alter table public.payments
  add column if not exists delivery_id uuid references public.deliveries(id) on delete set null,
  add column if not exists kind text not null default '';
update public.payments p set kind = case when exists (
    select 1 from public.orders o
     where o.list_id = p.list_id and o.pay_type = 'Deposit'
       and public.norm_customer(o.customer) = public.norm_customer(p.customer))
  then 'deposit' else 'full' end
 where p.kind = '';

-- ── Admin: put items in a bill ───────────────────────────────
-- p_new → a new bill; p_delivery → that bill; neither → out of any bill.
-- Bills left with no items are deleted. Returns the bill id (or null).
create or replace function public.admin_set_delivery(p_order_ids uuid[], p_delivery uuid, p_new boolean default false)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_found int; v_custs int; v_cust text; v_target uuid := p_delivery;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select count(*), count(distinct public.norm_customer(customer)), min(public.norm_customer(customer))
    into v_found, v_custs, v_cust
    from public.orders where id = any(p_order_ids);
  if v_found = 0 or v_found <> cardinality(p_order_ids) then raise exception 'ไม่พบรายการสินค้า'; end if;
  if v_custs > 1 then raise exception 'รวมบิลได้เฉพาะสินค้าของลูกค้าคนเดียวกัน'; end if;
  if exists (select 1 from public.orders where id = any(p_order_ids) and remark = 'POS') then
    raise exception 'สินค้าหน้าร้าน (POS) ไม่ต้องทำบิลค่าส่ง';
  end if;

  if p_new then
    insert into public.deliveries(customer) values (v_cust) returning id into v_target;
  elsif v_target is not null then
    if not exists (select 1 from public.deliveries where id = v_target and customer = v_cust) then
      raise exception 'บิลนี้เป็นของลูกค้าคนอื่น';
    end if;
  end if;

  update public.orders set delivery_id = v_target where id = any(p_order_ids);
  delete from public.deliveries d
   where not exists (select 1 from public.orders o where o.delivery_id = d.id)
     and not exists (select 1 from public.payments p where p.delivery_id = d.id);
  return v_target;
end $$;
revoke all on function public.admin_set_delivery(uuid[], uuid, boolean) from public;
grant execute on function public.admin_set_delivery(uuid[], uuid, boolean) to authenticated;

-- ── Customer: my orders, bills and what I already sent ───────
create or replace function public.customer_orders(p_name text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v text := public.norm_customer(p_name);
begin
  if length(v) < 2 then
    return jsonb_build_object('orders', '[]'::jsonb, 'payments', '[]'::jsonb, 'legacy', '[]'::jsonb, 'deliveries', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'listId', o.list_id, 'listName', l.name, 'product', o.product, 'qty', o.qty,
        'payType', o.pay_type, 'total', o.total, 'totalFull', o.total_full,
        'status', o.status, 'shippedAt', o.shipped_at, 'tracking', o.tracking,
        'createdAt', o.created_at, 'deliveryId', case when d.sent_at is not null then o.delivery_id end)
        order by o.created_at desc)
      from public.orders o join public.order_lists l on l.id = o.list_id
      left join public.deliveries d on d.id = o.delivery_id
      where public.norm_customer(o.customer) = v), '[]'::jsonb),
    'deliveries', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'fee', d.fee, 'createdAt', d.sent_at)
                       order by d.sent_at desc)
      from public.deliveries d where d.customer = v and d.sent_at is not null), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'listId', p.list_id, 'deliveryId', p.delivery_id, 'kind', p.kind, 'amount', p.amount,
        'paidAt', p.paid_at, 'createdAt', p.created_at, 'hasAddress', p.address <> '') order by p.created_at desc)
      from public.payments p
      where public.norm_customer(p.customer) = v), '[]'::jsonb),
    'legacy', coalesce((
      select jsonb_agg(jsonb_build_object(
        'round', g.round, 'product', g.product, 'qty', g.qty, 'pay', g.pay,
        'status', g.status, 'tracking', g.tracking, 'note', g.note) order by g.sort)
      from public.legacy_orders g
      where v = any (select public.norm_customer(x) from regexp_split_to_table(g.customer, '[\s,]+') x)), '[]'::jsonb));
end $$;

-- ── Customer: send a slip for one list, or for one delivery bill ──
-- Sending the same slip again (same QR ref, or the identical image) replaces
-- the address on it, so customers can fix a wrong address.
drop function if exists public.customer_submit_payment(text, uuid, numeric, timestamptz, text, text, text);
create or replace function public.customer_submit_payment(
  p_name text, p_list_id uuid, p_amount numeric, p_paid_at timestamptz,
  p_bank_ref text, p_address text, p_slip text, p_delivery_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_customer text; v_list uuid := p_list_id; v_kind text;
        v_ref text := btrim(coalesce(p_bank_ref, ''));
        v_address text := btrim(coalesce(p_address, '')); v_same uuid;
begin
  if p_delivery_id is not null then
    -- The bill must be this customer's, sent by the shop, with its delivery fee set
    if not exists (select 1 from public.deliveries
                    where id = p_delivery_id and customer = public.norm_customer(p_name) and sent_at is not null) then
      raise exception 'ไม่พบบิลค่าส่งของชื่อนี้';
    end if;
    if (select fee from public.deliveries where id = p_delivery_id) is null then
      raise exception 'ร้านยังไม่ได้แจ้งค่าส่ง กรุณารอสักครู่';
    end if;
    select o.customer, o.list_id into v_customer, v_list from public.orders o
     where o.delivery_id = p_delivery_id order by o.created_at limit 1;
    v_kind := 'balance';
  else
    -- Only names that really ordered in this list can send
    select o.customer into v_customer from public.orders o
     where o.list_id = p_list_id and public.norm_customer(o.customer) = public.norm_customer(p_name)
     limit 1;
    v_kind := case when exists (select 1 from public.orders o
                                 where o.list_id = p_list_id and o.pay_type = 'Deposit'
                                   and public.norm_customer(o.customer) = public.norm_customer(p_name))
                   then 'deposit' else 'full' end;
  end if;
  if v_customer is null then raise exception 'ไม่พบคำสั่งซื้อของชื่อนี้ในรายการนี้'; end if;
  if p_slip is null or p_slip !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$' or length(p_slip) > 700000 then
    raise exception 'ไฟล์สลิปไม่ถูกต้องหรือใหญ่เกินไป';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then raise exception 'จำนวนเงินไม่ถูกต้อง'; end if;
  if length(v_address) > 1000 then raise exception 'ที่อยู่ยาวเกินไป'; end if;

  -- Same slip again from the same customer → new address
  select p.id into v_same from public.payments p
   where public.norm_customer(p.customer) = public.norm_customer(p_name)
     and ((v_ref <> '' and p.bank_ref = v_ref) or p.slip_image = p_slip)
   order by p.created_at desc limit 1;
  if v_same is not null then
    if v_address = '' then
      raise exception 'สลิปนี้ถูกส่งมาแล้ว — ถ้าต้องการแก้ที่อยู่ ให้กรอกที่อยู่ใหม่แล้วส่งสลิปเดิมอีกครั้ง';
    end if;
    update public.payments set address = v_address where id = v_same;
    return jsonb_build_object('ok', true, 'addressUpdated', true);
  end if;

  if v_ref <> '' and exists (select 1 from public.payments where bank_ref = v_ref) then
    raise exception 'สลิปนี้ถูกส่งมาแล้ว';
  end if;
  -- Spam guard: a customer never needs this many slips for one list
  if (select count(*) from public.payments
       where list_id = v_list and public.norm_customer(customer) = public.norm_customer(p_name)) >= 20 then
    raise exception 'ส่งสลิปครบจำนวนสูงสุดแล้ว กรุณาติดต่อร้าน';
  end if;
  insert into public.payments(list_id, customer, amount, paid_at, bank_ref, address, slip_image, delivery_id, kind)
  values (v_list, v_customer, p_amount, coalesce(p_paid_at, now()), v_ref, v_address, p_slip, p_delivery_id, v_kind);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.customer_orders(text) from public;
revoke all on function public.customer_submit_payment(text, uuid, numeric, timestamptz, text, text, text, uuid) from public;
grant execute on function public.customer_orders(text) to anon, authenticated;
grant execute on function public.customer_submit_payment(text, uuid, numeric, timestamptz, text, text, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
