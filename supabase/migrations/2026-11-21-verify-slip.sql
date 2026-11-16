-- Slips are checked with the bank before they are accepted (SlipOK, via the
-- verify-slip Edge Function). Run this AFTER deploying verify-slip and setting
-- SLIPOK_API_KEY + SLIPOK_BRANCH_ID, or every customer slip will be refused.
-- Turn the check off again (slips accepted as before):
--   update public.app_settings set value = '{"on": false}' where key = 'slip_verify';

-- One row per bank reference the verify-slip function has checked. Written only by
-- the function (service role); admins can read it.
create table if not exists public.slip_checks (
  bank_ref    text primary key,
  payload     text not null default '',
  amount      numeric not null,
  paid_at     timestamptz not null,
  receiver_ok boolean not null default false,
  receiver    text not null default '',
  sender      text not null default '',
  checked_at  timestamptz not null default now()
);
alter table public.slip_checks enable row level security;
drop policy if exists slip_checks_admin_read on public.slip_checks;
create policy slip_checks_admin_read on public.slip_checks for select to authenticated using (public.is_admin());

insert into public.app_settings(key, value) values ('slip_verify', '{"on": true}')
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function public.customer_submit_payment(
  p_name text, p_list_id uuid, p_amount numeric, p_paid_at timestamptz,
  p_bank_ref text, p_address text, p_slip text, p_delivery_id uuid default null,
  p_address_parts jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_customer text; v_list uuid := p_list_id; v_kind text;
        v_ref text := btrim(coalesce(p_bank_ref, ''));
        v_address text := btrim(coalesce(p_address, '')); v_same uuid;
        v_same_bill uuid; v_same_list uuid;
        v_chk public.slip_checks; v_due numeric; v_from timestamptz;
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
  -- Every slip carries its bank reference (read from the slip's QR): it's what catches a slip sent twice
  if v_ref !~ '^[A-Za-z0-9]{8,64}$' then
    raise exception 'ไม่พบเลขอ้างอิงจาก QR บนสลิป กรุณาใช้รูปสลิปจากแอปธนาคาร';
  end if;
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

  -- Slip check (switched on in app_settings 'slip_verify'): the verify-slip Edge Function
  -- has asked the bank about this slip. It must be paid to the shop, cover what is still
  -- owed, and be dated after the order (or the bill). The bank's amount and time are saved.
  if coalesce((select (value->>'on')::boolean from public.app_settings where key = 'slip_verify'), false) then
    select * into v_chk from public.slip_checks where bank_ref = v_ref;
    if v_chk.bank_ref is null then
      raise exception 'สลิปนี้ยังไม่ผ่านการตรวจกับธนาคาร กรุณาเลือกรูปสลิปใหม่อีกครั้ง';
    end if;
    if not v_chk.receiver_ok then raise exception 'สลิปนี้ไม่ได้โอนเข้าบัญชีของร้าน'; end if;
    if p_delivery_id is not null then
      -- Bill: the rest of every deposit item in it + the delivery fee, less what was sent already
      select coalesce(sum(greatest(o.total_full - o.total, 0)) filter (where o.pay_type = 'Deposit'), 0)
        into v_due from public.orders o where o.delivery_id = p_delivery_id;
      v_due := v_due + coalesce((select fee from public.deliveries where id = p_delivery_id), 0)
             - coalesce((select sum(amount) from public.payments where delivery_id = p_delivery_id), 0);
      select created_at into v_from from public.deliveries where id = p_delivery_id;
    else
      -- Order: everything this customer ordered in the list, less the slips they sent for it
      select coalesce(sum(o.total), 0), min(o.created_at) into v_due, v_from from public.orders o
       where o.list_id = p_list_id and public.norm_customer(o.customer) = public.norm_customer(p_name)
         and o.pay_type <> 'Gift' and coalesce(o.status, '') <> 'ยกเลิก' and coalesce(o.remark, '') <> 'POS';
      v_due := v_due - coalesce((select sum(amount) from public.payments
                                  where list_id = p_list_id and delivery_id is null
                                    and public.norm_customer(customer) = public.norm_customer(p_name)), 0);
    end if;
    v_due := round(v_due, 2);
    if v_due <= 0 then raise exception 'รายการนี้ชำระครบแล้ว ไม่ต้องส่งสลิปเพิ่มค่ะ'; end if;
    if v_chk.amount < v_due - 0.01 then
      raise exception 'ยอดในสลิป ฿% น้อยกว่ายอดที่ต้องโอน ฿% กรุณาโอนให้ครบแล้วส่งสลิปใหม่',
        to_char(v_chk.amount, 'FM999,999,990.00'), to_char(v_due, 'FM999,999,990.00');
    end if;
    if v_from is not null and v_chk.paid_at < v_from - interval '1 day' then
      raise exception 'สลิปนี้โอนวันที่ % ก่อนวันที่สั่งซื้อ กรุณาใช้สลิปของการโอนครั้งนี้',
        to_char(v_chk.paid_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI');
    end if;
    if v_chk.paid_at > now() + interval '10 minutes' then raise exception 'วันที่บนสลิปไม่ถูกต้อง'; end if;
    p_amount := v_chk.amount; p_paid_at := v_chk.paid_at;
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

revoke all on function public.customer_submit_payment(text, uuid, numeric, timestamptz, text, text, text, uuid, jsonb) from public;
grant execute on function public.customer_submit_payment(text, uuid, numeric, timestamptz, text, text, text, uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
