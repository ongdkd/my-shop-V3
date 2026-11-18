-- Gifts per bill: once a customer's order has been paid (left "รอชำระเงิน"), what they
-- order next starts a new bill with its own gift count. Only an admin can add items to an
-- earlier bill (admin → คำสั่งซื้อ → เพิ่มสินค้าให้ลูกค้า); its gifts are then recounted and
-- the customer pays the difference with a slip as usual.
-- Run once in the Supabase SQL Editor (after 2026-11-22-staff-roles.sql). Safe to run again.
-- Existing orders all stay on bill 1, so nothing already given changes.

alter table public.orders add column if not exists bill_no integer not null default 1;
create index if not exists orders_bill_idx on public.orders(list_id, public.norm_customer(customer), bill_no);

-- The bill a customer's new order joins: their latest bill, unless it has been paid
-- (slips reach past the earlier bills) or the shop marked it paid / arrived / shipped.
create or replace function public.cust_open_bill(p_list_id uuid, p_customer text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cust   text := public.norm_customer(p_customer);
  v_bill   integer;
  v_before numeric;
  v_paid   numeric;
begin
  select max(bill_no) into v_bill from public.orders
    where list_id = p_list_id and public.norm_customer(customer) = v_cust
      and coalesce(remark, '') <> 'POS' and coalesce(status, '') <> 'ยกเลิก';
  if v_bill is null then return 1; end if;
  if exists (select 1 from public.orders
      where list_id = p_list_id and public.norm_customer(customer) = v_cust and bill_no = v_bill
        and pay_type <> 'Gift' and coalesce(status, '') <> 'ยกเลิก'
        and (shipped_at is not null or delivery_id is not null or coalesce(status, '') ~ '(ชำระแล้ว|ถึงไทย)')) then
    return v_bill + 1;
  end if;
  select coalesce(sum(total), 0) into v_before from public.orders
    where list_id = p_list_id and public.norm_customer(customer) = v_cust and bill_no < v_bill
      and coalesce(remark, '') <> 'POS' and coalesce(status, '') <> 'ยกเลิก';
  select coalesce(sum(amount), 0) into v_paid from public.payments
    where list_id = p_list_id and public.norm_customer(customer) = v_cust and delivery_id is null;
  if v_paid > v_before + 0.009 then return v_bill + 1; end if;
  return v_bill;
end;
$$;
revoke all on function public.cust_open_bill(uuid, text) from public, anon, authenticated;

-- Gifts for one bill (the live sync_gifts, limited to bill p_bill)
CREATE OR REPLACE FUNCTION public.sync_gifts_bill(p_list_id uuid, p_customer text, p_phone text, p_checkout_id uuid, p_grow boolean, p_shrink boolean, p_bill integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cust   text := public.norm_customer(p_customer);
  v_rules  jsonb;
  v_mode   text;
  v_yuan   numeric;
  v_full   numeric;
  v_total  numeric;
  v_min    numeric;
  v_name   text;
  v_stock  int;
  v_n      int;
  v_cut    int;
  v_want   int[] := '{}';
  v_have   int[] := '{}';
  v_last   int := null;
  v_given  jsonb := '[]'::jsonb;
  v_dirty  boolean := false;
  i        int;
  gr       record;
begin
  select coalesce(gift_rules, '[]'::jsonb), coalesce(gift_mode, 'all')
    into v_rules, v_mode
    from public.order_lists where id = p_list_id for update;
  if not found or jsonb_typeof(v_rules) <> 'array' or jsonb_array_length(v_rules) = 0 then
    return v_given;
  end if;

  -- Thresholds use the full value of the goods (a deposit still counts in full)
  select coalesce(sum(total_yuan), 0), coalesce(sum(total_full), 0)
    into v_yuan, v_full
    from public.orders
    where list_id = p_list_id and public.norm_customer(customer) = v_cust
      and pay_type <> 'Gift' and coalesce(remark, '') <> 'POS' and coalesce(status, '') <> 'ยกเลิก'
      and bill_no = p_bill;

  for i in 0 .. jsonb_array_length(v_rules) - 1 loop
    v_n := 0;
    v_name := coalesce(v_rules->i->>'name', '');
    select coalesce(sum(qty), 0)::int into v_cut
      from public.orders
      where list_id = p_list_id and public.norm_customer(customer) = v_cust
        and pay_type = 'Gift' and product = 'ของแถม: ' || v_name and coalesce(status, '') <> 'ยกเลิก'
        and bill_no = p_bill;
    v_have := v_have || v_cut;
    if v_name <> '' and coalesce(v_rules->i->>'min', '') ~ '^[0-9]+(\.[0-9]+)?$' and (v_rules->i->>'min')::numeric > 0 then
      v_min := (v_rules->i->>'min')::numeric;
      v_total := case when v_rules->i->>'currency' = 'CNY' then v_yuan else v_full end;
      if v_total >= v_min then
        v_n := case when coalesce(v_rules->i->>'every', 'false') = 'true' then floor(v_total / v_min)::int else 1 end;
        -- stock null = unlimited; otherwise what they hold plus what is left
        if v_rules->i->>'stock' is not null then
          v_stock := case when v_rules->i->>'stock' ~ '^[0-9]+$' then (v_rules->i->>'stock')::int else 0 end;
          v_n := least(v_n, v_cut + v_stock);
        end if;
        if v_n > 0 then v_last := i; end if;
      end if;
    end if;
    v_want := v_want || v_n;
  end loop;

  -- 'best': only the last reached rule in list order
  if v_mode = 'best' then
    for i in 0 .. jsonb_array_length(v_rules) - 1 loop
      if v_last is null or i <> v_last then v_want[i + 1] := 0; end if;
    end loop;
  end if;

  for i in 0 .. jsonb_array_length(v_rules) - 1 loop
    v_name := coalesce(v_rules->i->>'name', '');
    v_n := v_want[i + 1] - v_have[i + 1];
    if v_n > 0 and p_grow then
      insert into public.orders
        (list_id, customer, product, qty, pay_type, price, total,
         yuan, total_yuan, full_price, total_full, remark, checkout_id, bill_no)
      values
        (p_list_id, btrim(p_customer), 'ของแถม: ' || v_name, v_n, 'Gift',
         0, 0, 0, 0, 0, 0, coalesce(p_phone, ''), p_checkout_id, p_bill);
      v_given := v_given || jsonb_build_array(v_name || case when v_n > 1 then ' ×' || v_n else '' end);
      if v_rules->i->>'stock' is not null then
        v_rules := jsonb_set(v_rules, array[i::text, 'stock'], to_jsonb(greatest(0, (v_rules->i->>'stock')::int - v_n)));
        v_dirty := true;
      end if;
    elsif v_n < 0 and p_shrink then
      v_cut := -v_n;
      for gr in
        select id, qty from public.orders
        where list_id = p_list_id and public.norm_customer(customer) = v_cust
          and pay_type = 'Gift' and product = 'ของแถม: ' || v_name
          and coalesce(status, '') <> 'ยกเลิก' and shipped_at is null
          and bill_no = p_bill
        order by created_at desc, seq desc
      loop
        exit when v_cut <= 0;
        if gr.qty <= v_cut then
          delete from public.orders where id = gr.id;
          v_n := gr.qty::int;
        else
          update public.orders set qty = qty - v_cut where id = gr.id;
          v_n := v_cut;
        end if;
        v_cut := v_cut - v_n;
        if v_rules->i->>'stock' is not null and v_rules->i->>'stock' ~ '^[0-9]+$' then
          v_rules := jsonb_set(v_rules, array[i::text, 'stock'], to_jsonb((v_rules->i->>'stock')::int + v_n));
          v_dirty := true;
        end if;
      end loop;
    end if;
  end loop;

  if v_dirty then
    update public.order_lists set gift_rules = v_rules where id = p_list_id;
  end if;
  return v_given;
end;
$function$;
revoke all on function public.sync_gifts_bill(uuid, text, text, uuid, boolean, boolean, integer) from public, anon, authenticated;

-- Existing callers (admin deleting orders, customers removing items) recount every bill
create or replace function public.sync_gifts(p_list_id uuid, p_customer text, p_phone text, p_checkout_id uuid, p_grow boolean, p_shrink boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_given jsonb := '[]'::jsonb;
  b       integer;
begin
  for b in
    select distinct bill_no from public.orders
    where list_id = p_list_id and public.norm_customer(customer) = public.norm_customer(p_customer)
      and coalesce(remark, '') <> 'POS'
    order by bill_no
  loop
    v_given := v_given || public.sync_gifts_bill(p_list_id, p_customer, p_phone, p_checkout_id, p_grow, p_shrink, b);
  end loop;
  return v_given;
end;
$$;
revoke all on function public.sync_gifts(uuid, text, text, uuid, boolean, boolean) from public, anon, authenticated;

-- Orders (the live submit_order: new orders join the customer's open bill)
CREATE OR REPLACE FUNCTION public.submit_order(p_list_id uuid, p_customer text, p_phone text, p_items jsonb, p_checkout_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  it       jsonb;
  prod     public.products%rowtype;
  v_qty    numeric;
  v_is_dep boolean;
  v_opt    text;
  v_unit   numeric;
  v_label  text;
  v_phone  text;
  v_detail jsonb;
  req      record;
  v_yuan   numeric := 0;   -- order totals the gift thresholds compare against
  v_full   numeric := 0;
  v_rules  jsonb;
  v_mode   text;
  v_given  jsonb := '[]'::jsonb;
  -- admin_add_items sets app.admin_bill: add to that bill, even in a closed round
  v_admin  boolean := coalesce(current_setting('app.admin_bill', true), '') ~ '^[0-9]+$' and public.is_admin();
  v_bill   integer;
  v_pick   int[] := '{}';
  g        record;
  v_idx    int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('status', 'Error', 'message', 'No order items received');
  end if;
  if jsonb_array_length(p_items) > 100 then
    return jsonb_build_object('status', 'Error', 'message', 'Too many order items');
  end if;
  if length(btrim(coalesce(p_customer, ''))) < 1 or length(btrim(p_customer)) > 100 then
    return jsonb_build_object('status', 'Error', 'message', 'Invalid customer name');
  end if;
  v_phone := regexp_replace(coalesce(p_phone, ''), '[-[:space:]]', '', 'g');
  if v_phone !~ '^0[6-9][0-9]{8}$' then
    return jsonb_build_object('status', 'Error', 'message', 'Invalid phone number');
  end if;
  if not v_admin and not exists (
    select 1 from public.order_lists
    where id = p_list_id
      and lower(btrim(status)) = 'open'
      and lower(btrim(display)) not in ('hidden', 'hide', 'false', 'no')
  ) then
    return jsonb_build_object('status', 'Error', 'message', 'Order list is not open');
  end if;
  if v_admin and not exists (select 1 from public.order_lists where id = p_list_id) then
    return jsonb_build_object('status', 'Error', 'message', 'Order list not found');
  end if;
  -- Which bill (gift count) these items join
  v_bill := case when v_admin then current_setting('app.admin_bill', true)::integer
                 else public.cust_open_bill(p_list_id, p_customer) end;

  -- 1) Validate every item before casting request values.
  for it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object'
       or coalesce(it->>'id', '') = ''
       or length(it->>'id') > 100
       or coalesce(it->>'quantity', '') !~ '^[1-9][0-9]*$'
       or (it->>'quantity')::numeric > 100
       or coalesce(it->>'isDeposit', 'false') not in ('true', 'false')
       or length(coalesce(it->>'selectedOption', '')) > 200 then
      return jsonb_build_object('status', 'Error', 'message', 'Invalid order item');
    end if;
    select * into prod from public.products
      where list_id = p_list_id and code = (it->>'id')
      limit 1;
    if not found then
      return jsonb_build_object('status', 'Error', 'message', 'Product not found: ' || coalesce(it->>'id', ''));
    end if;
    if not v_admin and lower(btrim(prod.status)) <> 'open' then
      return jsonb_build_object('status', 'Error', 'message', 'Product is closed: ' || prod.name);
    end if;
    -- A ฿0 deposit must never reserve stock for free
    if coalesce((it->>'isDeposit')::boolean, false) and coalesce(prod.deposit, 0) <= 0 then
      return jsonb_build_object('status', 'Error', 'message', 'Deposit not available for ' || prod.name);
    end if;
    -- Options are stored as "name:barcode"; accept the raw value or the
    -- display name so clients never need to show barcodes to customers.
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

  -- Lock in a stable order and validate the aggregate requested quantity.
  -- Aggregating prevents duplicate item rows from bypassing the stock check.
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

  -- Validate each selected option independently. The parent quantity is the
  -- total across all options, while option_details.remaining is the maximum
  -- sellable quantity for that specific choice.
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

  -- Idempotency guard — AFTER all validations so a rejected attempt can
  -- be retried, but BEFORE any write. A duplicate id means this checkout
  -- already succeeded: answer Success without writing anything twice.
  if p_checkout_id is not null then
    begin
      insert into public.checkout_requests(id) values (p_checkout_id);
    exception when unique_violation then
      return jsonb_build_object('status', 'Success', 'duplicate', true);
    end;
  end if;

  -- 2) deduct stock + insert order rows
  for it in select * from jsonb_array_elements(p_items) loop
    select * into prod from public.products
      where list_id = p_list_id and code = (it->>'id')
      order by seq limit 1
      for update;

    v_qty    := (it->>'quantity')::numeric;
    v_is_dep := coalesce((it->>'isDeposit')::boolean, false);
    v_opt    := btrim(coalesce(it->>'selectedOption', ''));

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

    v_unit  := case when v_is_dep then coalesce(prod.deposit, 0) else coalesce(prod.price, 0) end;
    -- Record only the display name (never "name:barcode") so web and POS
    -- orders of the same option group together in every report.
    v_label := case when v_opt <> '' then prod.name || ' (' || split_part(v_opt, ':', 1) || ')' else prod.name end;

    insert into public.orders
      (list_id, customer, product, qty, pay_type, price, total,
       yuan, total_yuan, full_price, total_full, remark, checkout_id, bill_no)
    values
      (p_list_id, btrim(p_customer), v_label, v_qty,
       case when v_is_dep then 'Deposit' else 'Full Price' end,
       v_unit, v_unit * v_qty,
       coalesce(prod.yuan, 0), coalesce(prod.yuan, 0) * v_qty,
       coalesce(prod.price, 0), coalesce(prod.price, 0) * v_qty,
       v_phone, p_checkout_id, v_bill);

    -- Thresholds use the full value of the goods (a deposit still counts in full)
    v_yuan := v_yuan + coalesce(prod.yuan, 0) * v_qty;
    v_full := v_full + coalesce(prod.price, 0) * v_qty;
  end loop;

  -- 3) Free gifts — decided on the server so a client can't fake them, and counted
  --    on this bill: a second order adds up with the first until that bill has been
  --    paid (cust_open_bill); after that a new bill starts its own count.
  v_given := public.sync_gifts_bill(p_list_id, p_customer, v_phone, p_checkout_id, true, false, v_bill);

  return jsonb_build_object('status', 'Success', 'gifts', v_given);
end;
$function$;

-- Admin: add items to a customer's bill (open or closed round). Uses submit_order's own
-- checks, prices and stock, then says how much the customer now owes for this round.
create or replace function public.admin_add_items(p_list_id uuid, p_customer text, p_bill integer, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cust  text := public.norm_customer(p_customer);
  v_name  text;
  v_phone text;
  v_ck    uuid := gen_random_uuid();
  v_res   jsonb;
  v_added numeric;
  v_owed  numeric;
begin
  if not public.is_admin() then
    return jsonb_build_object('status', 'Error', 'message', 'สำหรับแอดมินเท่านั้น');
  end if;
  if p_bill is null or p_bill < 1 then
    return jsonb_build_object('status', 'Error', 'message', 'เลือกบิลก่อน');
  end if;
  -- the customer's name as they wrote it, and their phone from their own orders
  select customer into v_name from public.orders
    where list_id = p_list_id and public.norm_customer(customer) = v_cust and coalesce(remark, '') <> 'POS'
    order by created_at limit 1;
  if v_name is null then
    return jsonb_build_object('status', 'Error', 'message', 'ลูกค้าคนนี้ยังไม่มีออเดอร์ในรอบนี้');
  end if;
  select remark into v_phone from public.orders
    where public.norm_customer(customer) = v_cust and remark ~ '^0[6-9][0-9]{8}$'
    order by (list_id = p_list_id) desc, created_at desc limit 1;
  if v_phone is null then
    return jsonb_build_object('status', 'Error', 'message', 'ไม่พบเบอร์โทรของลูกค้าคนนี้');
  end if;
  perform set_config('app.admin_bill', p_bill::text, true);
  v_res := public.submit_order(p_list_id, v_name, v_phone, p_items, v_ck);
  perform set_config('app.admin_bill', '', true);
  if coalesce(v_res->>'status', '') <> 'Success' then return v_res; end if;
  select coalesce(sum(total), 0) into v_added from public.orders where checkout_id = v_ck;
  select coalesce(sum(total), 0) into v_owed from public.orders
    where list_id = p_list_id and public.norm_customer(customer) = v_cust
      and coalesce(remark, '') <> 'POS' and coalesce(status, '') <> 'ยกเลิก';
  v_owed := v_owed - coalesce((select sum(amount) from public.payments
    where list_id = p_list_id and public.norm_customer(customer) = v_cust and delivery_id is null), 0);
  return v_res || jsonb_build_object('added', v_added, 'owed', round(greatest(v_owed, 0), 2), 'customer', v_name);
end;
$$;
revoke all on function public.admin_add_items(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.admin_add_items(uuid, text, integer, jsonb) to authenticated;
