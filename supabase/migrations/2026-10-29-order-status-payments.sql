-- Order status, shipping and customer payment slips.
-- Safe to run more than once. Also included in supabase/schema.sql.

-- ── Per-item status ──────────────────────────────────────────
-- shipped_at null = not shipped. status holds any other label:
-- '' = waiting, 'ยกเลิก' = cancelled, or a custom label added in admin.
alter table public.orders
  add column if not exists shipped_at timestamptz,
  add column if not exists tracking text not null default '',
  add column if not exists status text not null default '';

-- Customers look themselves up by @name: case-insensitive, leading @ optional
create or replace function public.norm_customer(t text)
returns text language sql immutable as $$
  select regexp_replace(lower(btrim(coalesce(t, ''))), '^@+', '')
$$;
create index if not exists orders_norm_customer_idx
  on public.orders(public.norm_customer(customer));

-- ── Payment slips + delivery address ─────────────────────────
-- slip_image is a small JPEG data URL; it is cleared once everything the
-- customer ordered in that list is shipped. The text fields are kept.
create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid references public.order_lists(id) on delete cascade,
  customer   text not null,
  amount     numeric not null default 0,
  paid_at    timestamptz,
  bank_ref   text not null default '',   -- transaction ref read from the slip QR
  address    text not null default '',
  slip_image text,
  created_at timestamptz not null default now()
);
create index if not exists payments_lookup_idx
  on public.payments(list_id, public.norm_customer(customer));
-- The same bank slip can only be sent once
create unique index if not exists payments_bank_ref_uniq
  on public.payments(bank_ref) where bank_ref <> '';

-- Lets the admin list ask "is there a photo?" without downloading it
create or replace function public.has_slip(public.payments)
returns boolean language sql stable as $$ select $1.slip_image is not null $$;

alter table public.payments enable row level security;
drop policy if exists payments_admin_all on public.payments;
create policy payments_admin_all on public.payments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Customer: my orders + what I already sent (no address/slip back) ──
create or replace function public.customer_orders(p_name text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v text := public.norm_customer(p_name);
begin
  if length(v) < 2 then
    return jsonb_build_object('orders', '[]'::jsonb, 'payments', '[]'::jsonb);
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
      where public.norm_customer(p.customer) = v), '[]'::jsonb));
end $$;

-- ── Customer: send a slip (+ optional address) for one order list ──
create or replace function public.customer_submit_payment(
  p_name text, p_list_id uuid, p_amount numeric, p_paid_at timestamptz,
  p_bank_ref text, p_address text, p_slip text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_customer text; v_ref text := btrim(coalesce(p_bank_ref, ''));
begin
  -- Only names that really ordered in this list can send
  select o.customer into v_customer from public.orders o
   where o.list_id = p_list_id and public.norm_customer(o.customer) = public.norm_customer(p_name)
   limit 1;
  if v_customer is null then raise exception 'ไม่พบคำสั่งซื้อของชื่อนี้ในรายการนี้'; end if;
  if p_slip is null or p_slip !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$' or length(p_slip) > 700000 then
    raise exception 'ไฟล์สลิปไม่ถูกต้องหรือใหญ่เกินไป';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then raise exception 'จำนวนเงินไม่ถูกต้อง'; end if;
  if length(coalesce(p_address, '')) > 1000 then raise exception 'ที่อยู่ยาวเกินไป'; end if;
  if v_ref <> '' and exists (select 1 from public.payments where bank_ref = v_ref) then
    raise exception 'สลิปนี้ถูกส่งมาแล้ว';
  end if;
  -- Spam guard: a customer never needs this many slips for one list
  if (select count(*) from public.payments
       where list_id = p_list_id and public.norm_customer(customer) = public.norm_customer(p_name)) >= 20 then
    raise exception 'ส่งสลิปครบจำนวนสูงสุดแล้ว กรุณาติดต่อร้าน';
  end if;
  insert into public.payments(list_id, customer, amount, paid_at, bank_ref, address, slip_image)
  values (p_list_id, v_customer, p_amount, coalesce(p_paid_at, now()), v_ref,
          btrim(coalesce(p_address, '')), p_slip);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.customer_orders(text) from public;
revoke all on function public.customer_submit_payment(text, uuid, numeric, timestamptz, text, text, text) from public;
grant execute on function public.customer_orders(text) to anon, authenticated;
grant execute on function public.customer_submit_payment(text, uuid, numeric, timestamptz, text, text, text) to anon, authenticated;

-- ── Drop slip photos once a customer's list is fully shipped ──
-- "Done" = at least one item shipped and nothing still waiting
-- (every item is shipped or cancelled).
create or replace function public.clear_slips_when_shipped()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.orders o
              where o.list_id = new.list_id
                and public.norm_customer(o.customer) = public.norm_customer(new.customer)
                and o.shipped_at is not null)
     and not exists (select 1 from public.orders o
              where o.list_id = new.list_id
                and public.norm_customer(o.customer) = public.norm_customer(new.customer)
                and o.shipped_at is null and o.status <> 'ยกเลิก') then
    update public.payments set slip_image = null
     where list_id = new.list_id
       and public.norm_customer(customer) = public.norm_customer(new.customer)
       and slip_image is not null;
  end if;
  return null;
end $$;
drop trigger if exists orders_clear_slips on public.orders;
create trigger orders_clear_slips
  after update of shipped_at, status on public.orders
  for each row execute function public.clear_slips_when_shipped();
