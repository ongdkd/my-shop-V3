-- Gifts per every X spent + removing items from unpaid orders.
-- Run in Supabase Dashboard → SQL Editor. Safe to run more than once.
--
--  * A gift rule can be "ทุก ๆ ยอดนี้": ¥1591 with a ¥66 rule gives 24, not 1.
--  * Gifts count everything the customer ordered in the list, so a second order
--    adds to the first (no need to cancel and order again to reach a gift).
--  * Admin can delete an unpaid order: stock goes back, unearned gifts are taken back.
--  * Customers can remove items on the status page before they send a slip.

-- ── Gifts per every X spent, counted on the customer's whole round; removing items ──
-- A gift rule may carry "every": true → one gift for every `min` spent
-- (¥1591 with a ¥66 rule = 24). Gifts are counted on everything the customer has
-- ordered in the list, not on one checkout, so ordering again adds up.

-- Brings one customer's gift rows in a list in line with what they have ordered.
-- p_grow: may add gifts; p_shrink: may take back gifts that are not shipped yet.
-- Returns the names of the gifts added now (["Sticker", "Card ×3"]).
create or replace function public.sync_gifts(
  p_list_id uuid, p_customer text, p_phone text, p_checkout_id uuid,
  p_grow boolean, p_shrink boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
      and pay_type <> 'Gift' and coalesce(remark, '') <> 'POS' and coalesce(status, '') <> 'ยกเลิก';

  for i in 0 .. jsonb_array_length(v_rules) - 1 loop
    v_n := 0;
    v_name := coalesce(v_rules->i->>'name', '');
    select coalesce(sum(qty), 0)::int into v_cut
      from public.orders
      where list_id = p_list_id and public.norm_customer(customer) = v_cust
        and pay_type = 'Gift' and product = 'ของแถม: ' || v_name and coalesce(status, '') <> 'ยกเลิก';
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
         yuan, total_yuan, full_price, total_full, remark, checkout_id)
      values
        (p_list_id, btrim(p_customer), 'ของแถม: ' || v_name, v_n, 'Gift',
         0, 0, 0, 0, 0, 0, coalesce(p_phone, ''), p_checkout_id);
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
$$;
revoke all on function public.sync_gifts(uuid, text, text, uuid, boolean, boolean) from public, anon, authenticated;

-- Deletes order rows; p_restock puts their pieces back on the product (and its
-- option) they came from. Gift and POS rows are deleted without restocking.
create or replace function public.remove_order_rows(p_ids uuid[], p_restock boolean)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  o     record;
  prod  public.products%rowtype;
  v_opt text;
  n     int := 0;
begin
  for o in select * from public.orders where id = any (p_ids) order by seq for update loop
    if p_restock and o.pay_type <> 'Gift' and coalesce(o.remark, '') <> 'POS' then
      -- An order's product is the product's name, or "name (option)"
      select * into prod from public.products p
        where p.list_id = o.list_id
          and (p.name = o.product
               or (left(o.product, length(p.name) + 2) = p.name || ' (' and right(o.product, 1) = ')'))
        order by (p.name = o.product) desc, length(p.name) desc
        limit 1
        for update;
      if found then
        if prod.remaining is not null then
          update public.products set remaining = remaining + o.qty where id = prod.id;
        end if;
        if prod.name <> o.product and jsonb_array_length(coalesce(prod.option_details, '[]'::jsonb)) > 0 then
          v_opt := substr(o.product, length(prod.name) + 3, length(o.product) - length(prod.name) - 3);
          update public.products p
          set option_details = coalesce((
            select jsonb_agg(
              case
                when btrim(coalesce(detail.value->>'name', '')) = v_opt
                     and detail.value ? 'remaining' and detail.value->>'remaining' is not null
                then jsonb_set(detail.value, '{remaining}',
                               to_jsonb((detail.value->>'remaining')::numeric + o.qty), true)
                else detail.value
              end
              order by detail.ordinality)
            from jsonb_array_elements(p.option_details) with ordinality detail(value, ordinality)
          ), '[]'::jsonb)
          where p.id = prod.id;
        end if;
      end if;
    end if;
    delete from public.orders where id = o.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.remove_order_rows(uuid[], boolean) from public, anon, authenticated;

-- Admin: delete orders (a bill the customer never paid), give the stock back, and
-- take back the gifts the remaining total no longer earns.
create or replace function public.admin_remove_orders(p_ids uuid[], p_restock boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  who    jsonb;
  v_who  jsonb;
  v_grow boolean;
  n      int;
begin
  if not public.is_admin() then
    return jsonb_build_object('status', 'Error', 'message', 'Not allowed');
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    return jsonb_build_object('status', 'Error', 'message', 'ไม่พบคำสั่งซื้อ');
  end if;
  -- Deleting a gift row by hand must not hand the same gift straight back
  v_grow := not exists (select 1 from public.orders where id = any (p_ids) and pay_type = 'Gift');
  select coalesce(jsonb_agg(jsonb_build_object('list', w.list_id, 'customer', w.customer, 'phone', w.phone)), '[]'::jsonb)
    into v_who
    from (select distinct on (list_id, public.norm_customer(customer)) list_id, customer, coalesce(remark, '') as phone
          from public.orders where id = any (p_ids) and coalesce(remark, '') <> 'POS') w;
  n := public.remove_order_rows(p_ids, coalesce(p_restock, true));
  for who in select * from jsonb_array_elements(v_who) loop
    perform public.sync_gifts((who->>'list')::uuid, who->>'customer', who->>'phone', null, v_grow, true);
  end loop;
  return jsonb_build_object('status', 'Success', 'deleted', n);
end;
$$;
revoke all on function public.admin_remove_orders(uuid[], boolean) from public, anon;
grant execute on function public.admin_remove_orders(uuid[], boolean) to authenticated;

-- Customer (status page): take items out of an order they have not paid for yet.
-- They prove it is theirs with the phone number the order was placed with.
create or replace function public.customer_remove_items(
  p_name text, p_phone text, p_list_id uuid, p_order_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cust  text := public.norm_customer(p_name);
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[-[:space:]]', '', 'g');
  v_ids   uuid[];
  n       int;
begin
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_order_ids, '{}'::uuid[])) x;
  if length(v_cust) < 2 or coalesce(array_length(v_ids, 1), 0) = 0 or array_length(v_ids, 1) > 100 then
    return jsonb_build_object('status', 'Error', 'message', 'ไม่พบรายการที่เลือก');
  end if;
  if v_phone !~ '^0[6-9][0-9]{8}$' then
    return jsonb_build_object('status', 'Error', 'message', 'เบอร์โทรไม่ถูกต้อง');
  end if;
  if not exists (select 1 from public.order_lists where id = p_list_id and lower(btrim(status)) = 'open') then
    return jsonb_build_object('status', 'Error', 'message', 'รอบนี้ปิดรับออเดอร์แล้ว แก้ไขไม่ได้ กรุณาติดต่อร้านค่ะ');
  end if;
  if exists (select 1 from public.payments p
             where p.list_id = p_list_id and p.delivery_id is null and public.norm_customer(p.customer) = v_cust) then
    return jsonb_build_object('status', 'Error', 'message', 'ส่งสลิปของรอบนี้แล้ว แก้ไขไม่ได้ กรุณาติดต่อร้านค่ะ');
  end if;
  select count(*) into n from public.orders o
    where o.id = any (v_ids) and o.list_id = p_list_id
      and public.norm_customer(o.customer) = v_cust
      and regexp_replace(coalesce(o.remark, ''), '[-[:space:]]', '', 'g') = v_phone
      and o.pay_type <> 'Gift' and o.shipped_at is null
      and coalesce(o.status, '') = '' and o.delivery_id is null;
  if n <> array_length(v_ids, 1) then
    return jsonb_build_object('status', 'Error', 'message', 'เบอร์โทรไม่ตรงกับที่ใช้สั่งซื้อ หรือรายการนี้แก้ไขไม่ได้แล้ว');
  end if;
  n := public.remove_order_rows(v_ids, true);
  perform public.sync_gifts(p_list_id, p_name, v_phone, null, true, true);
  return jsonb_build_object('status', 'Success', 'removed', n);
end;
$$;
grant execute on function public.customer_remove_items(text, text, uuid, uuid[]) to anon, authenticated;

-- What a customer has already ordered in a list, so the cart can show how far
-- they are from the next gift
create or replace function public.customer_list_totals(p_list_id uuid, p_name text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('yuan', coalesce(sum(total_yuan), 0), 'full', coalesce(sum(total_full), 0))
  from public.orders
  where list_id = p_list_id and length(public.norm_customer(p_name)) >= 2
    and public.norm_customer(customer) = public.norm_customer(p_name)
    and pay_type <> 'Gift' and coalesce(remark, '') <> 'POS' and coalesce(status, '') <> 'ยกเลิก'
$$;
grant execute on function public.customer_list_totals(uuid, text) to anon, authenticated;

-- submit_order: the same as before, with step 3 (gifts) handed to sync_gifts
create or replace function public.submit_order(
  p_list_id     uuid,
  p_customer    text,
  p_phone       text,
  p_items       jsonb,
  p_checkout_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  if not exists (
    select 1 from public.order_lists
    where id = p_list_id
      and lower(btrim(status)) = 'open'
      and lower(btrim(display)) not in ('hidden', 'hide', 'false', 'no')
  ) then
    return jsonb_build_object('status', 'Error', 'message', 'Order list is not open');
  end if;

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
    if lower(btrim(prod.status)) <> 'open' then
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
       yuan, total_yuan, full_price, total_full, remark, checkout_id)
    values
      (p_list_id, btrim(p_customer), v_label, v_qty,
       case when v_is_dep then 'Deposit' else 'Full Price' end,
       v_unit, v_unit * v_qty,
       coalesce(prod.yuan, 0), coalesce(prod.yuan, 0) * v_qty,
       coalesce(prod.price, 0), coalesce(prod.price, 0) * v_qty,
       v_phone, p_checkout_id);

    -- Thresholds use the full value of the goods (a deposit still counts in full)
    v_yuan := v_yuan + coalesce(prod.yuan, 0) * v_qty;
    v_full := v_full + coalesce(prod.price, 0) * v_qty;
  end loop;

  -- 3) Free gifts — decided on the server so a client can't fake them, and counted
  --    on everything this customer has ordered in the list (sync_gifts, below),
  --    so a second order adds up with the first.
  v_given := public.sync_gifts(p_list_id, p_customer, v_phone, p_checkout_id, true, false);

  return jsonb_build_object('status', 'Success', 'gifts', v_given);
end;
$$;

revoke all on function public.submit_order(uuid, text, text, jsonb, uuid) from public;
grant execute on function public.submit_order(uuid, text, text, jsonb, uuid) to anon, authenticated;

-- Status page lookup: each order now carries its id and whether its list is still
-- open, so the page can offer "remove this item" on unpaid orders
create or replace function public.customer_orders(p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text := public.norm_customer(p_name);
begin
  if length(v) < 2 then
    return jsonb_build_object('orders', '[]'::jsonb, 'payments', '[]'::jsonb, 'legacy', '[]'::jsonb, 'deliveries', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'listOpen', lower(btrim(l.status)) = 'open', 'listId', o.list_id, 'listName', l.name, 'product', o.product, 'qty', o.qty,
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
                         'ishipStatus', d.iship_status_text, 'ishipStatusAt', d.iship_status_at,
                         'holdAt', d.hold_at, 'paidMarkAt', d.paid_mark_at,
                         'deliveredAt', d.delivered_at)
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
grant execute on function public.customer_orders(text) to anon, authenticated;
