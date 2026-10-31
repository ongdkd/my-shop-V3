-- iShip shipping: structured customer addresses, the courier of each
-- shipment, iShip booking details on delivery bills, and shop settings
-- (the sender address used when booking).
-- Needs 2026-10-29c-delivery-bills.sql first. Safe to run more than once.

-- Address form fields: { name, phone, address, district, amphoe, province, zipcode }
alter table public.payments add column if not exists address_parts jsonb;

-- Courier code of a shipped item (iShip codes, e.g. FlashExpress, THP_eParcel),
-- so the customer gets the right tracking link
alter table public.orders add column if not exists courier text not null default '';

-- iShip booking of a bill; the status fields are kept up to date by the webhook
alter table public.deliveries
  add column if not exists courier           text not null default '',
  add column if not exists tracking          text not null default '',
  add column if not exists iship_ref         text not null default '',
  add column if not exists iship_price       numeric,
  add column if not exists iship_status      text not null default '',
  add column if not exists iship_status_text text not null default '',
  add column if not exists iship_status_at   timestamptz,
  -- when the shop first learned the parcel was delivered (notifies the admin once)
  add column if not exists delivered_at      timestamptz;
create index if not exists deliveries_tracking_idx on public.deliveries(tracking) where tracking <> '';

-- ── Shop settings (admin only), e.g. key 'iship' = sender address + parcel defaults ──
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_admin_all on public.app_settings;
create policy app_settings_admin_all on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

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
        'createdAt', o.created_at, 'deliveryId', case when d.sent_at is not null then o.delivery_id end,
        'courier', o.courier)
        order by o.created_at desc)
      from public.orders o join public.order_lists l on l.id = o.list_id
      left join public.deliveries d on d.id = o.delivery_id
      where public.norm_customer(o.customer) = v), '[]'::jsonb),
    'deliveries', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'fee', d.fee, 'createdAt', d.sent_at,
                         'courier', d.courier, 'tracking', d.tracking,
                         'ishipStatus', d.iship_status_text, 'ishipStatusAt', d.iship_status_at)
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
-- p_address_parts: { name, phone, address, district, amphoe, province, zipcode }
-- from the address form, so the shop can book a courier without retyping.
drop function if exists public.customer_submit_payment(text, uuid, numeric, timestamptz, text, text, text);
drop function if exists public.customer_submit_payment(text, uuid, numeric, timestamptz, text, text, text, uuid);
create or replace function public.customer_submit_payment(
  p_name text, p_list_id uuid, p_amount numeric, p_paid_at timestamptz,
  p_bank_ref text, p_address text, p_slip text, p_delivery_id uuid default null,
  p_address_parts jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_customer text; v_list uuid := p_list_id; v_kind text;
        v_ref text := btrim(coalesce(p_bank_ref, ''));
        v_address text := btrim(coalesce(p_address, '')); v_same uuid;
        v_same_bill uuid; v_same_list uuid;
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
  if p_address_parts is not null and (jsonb_typeof(p_address_parts) <> 'object' or length(p_address_parts::text) > 2000) then
    raise exception 'ที่อยู่ไม่ถูกต้อง';
  end if;

  -- Same slip again from the same customer → new address
  select p.id, p.delivery_id, p.list_id into v_same, v_same_bill, v_same_list from public.payments p
   where public.norm_customer(p.customer) = public.norm_customer(p_name)
     and ((v_ref <> '' and p.bank_ref = v_ref) or p.slip_image = p_slip)
   order by p.created_at desc limit 1;
  if v_same is not null then
    -- …but only for what that slip paid. A slip sent when ordering can't pay a
    -- delivery bill (or another list): the bill needs its own transfer.
    if v_same_bill is distinct from p_delivery_id or (p_delivery_id is null and v_same_list <> p_list_id) then
      raise exception 'สลิปนี้เคยส่งแล้วสำหรับ% — กรุณาโอนยอดนี้แล้วแนบสลิปใหม่',
        case when v_same_bill is not null then 'บิลค่าส่งอื่น' else 'ตอนสั่งซื้อ' end;
    end if;
    if v_address = '' then
      raise exception 'สลิปนี้ถูกส่งมาแล้ว — ถ้าต้องการแก้ที่อยู่ ให้กรอกที่อยู่ใหม่แล้วส่งสลิปเดิมอีกครั้ง';
    end if;
    update public.payments set address = v_address, address_parts = p_address_parts where id = v_same;
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
  insert into public.payments(list_id, customer, amount, paid_at, bank_ref, address, slip_image, delivery_id, kind, address_parts)
  values (v_list, v_customer, p_amount, coalesce(p_paid_at, now()), v_ref, v_address, p_slip, p_delivery_id, v_kind, p_address_parts);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.customer_orders(text) from public;
revoke all on function public.customer_submit_payment(text, uuid, numeric, timestamptz, text, text, text, uuid, jsonb) from public;
grant execute on function public.customer_orders(text) to anon, authenticated;
grant execute on function public.customer_submit_payment(text, uuid, numeric, timestamptz, text, text, text, uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
