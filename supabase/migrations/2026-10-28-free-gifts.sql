-- Free gifts by spend — a small update you can run instead of the whole schema.sql.
-- Safe to run more than once. Supabase Dashboard → SQL Editor → paste → Run.

-- Free gifts per list, decided per checkout by submit_order:
--   gift_rules: [{ "id", "name", "min": 188, "currency": "CNY" | "THB", "stock": 5 | null }]
--     CNY compares the order's yuan total, THB its full-price baht total;
--     stock null = unlimited, otherwise counts down per gift given.
--   gift_mode: 'all'  → every gift whose threshold is reached
--              'best' → only the last reached rule in list order (put the
--                       biggest gift last)
alter table public.order_lists
  add column if not exists gift_rules jsonb not null default '[]'::jsonb;
alter table public.order_lists
  add column if not exists gift_mode text not null default 'all';

drop function if exists public.submit_order(uuid, text, text, jsonb);

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

  -- 3) Free gifts for this checkout — decided here so a client can't fake them.
  --    The list row is locked so two checkouts can't both take the last gift.
  select coalesce(gift_rules, '[]'::jsonb), coalesce(gift_mode, 'all')
    into v_rules, v_mode
    from public.order_lists where id = p_list_id for update;
  if jsonb_typeof(v_rules) = 'array' and jsonb_array_length(v_rules) > 0 then
    for g in
      select r.value as rule, (r.ordinality - 1)::int as idx
      from jsonb_array_elements(v_rules) with ordinality r(value, ordinality)
    loop
      continue when coalesce(g.rule->>'name', '') = ''
                 or coalesce(g.rule->>'min', '') !~ '^[0-9]+(\.[0-9]+)?$';
      continue when g.rule->>'stock' is not null
                 and (coalesce(g.rule->>'stock', '') !~ '^[0-9]+$' or (g.rule->>'stock')::int <= 0);
      if (case when g.rule->>'currency' = 'CNY' then v_yuan else v_full end) >= (g.rule->>'min')::numeric then
        v_pick := v_pick || g.idx;
      end if;
    end loop;
    -- 'best': only the last reached rule in list order
    if v_mode = 'best' and array_length(v_pick, 1) > 1 then
      v_pick := array[v_pick[array_length(v_pick, 1)]];
    end if;
    foreach v_idx in array v_pick loop
      insert into public.orders
        (list_id, customer, product, qty, pay_type, price, total,
         yuan, total_yuan, full_price, total_full, remark, checkout_id)
      values
        (p_list_id, btrim(p_customer), 'ของแถม: ' || (v_rules->v_idx->>'name'), 1, 'Gift',
         0, 0, 0, 0, 0, 0, v_phone, p_checkout_id);
      v_given := v_given || jsonb_build_array(v_rules->v_idx->>'name');
      if v_rules->v_idx->>'stock' is not null then
        v_rules := jsonb_set(v_rules, array[v_idx::text, 'stock'], to_jsonb((v_rules->v_idx->>'stock')::int - 1));
      end if;
    end loop;
    if array_length(v_pick, 1) > 0 then
      update public.order_lists set gift_rules = v_rules where id = p_list_id;
    end if;
  end if;

  return jsonb_build_object('status', 'Success', 'gifts', v_given);
end;
$$;

grant execute on function public.submit_order(uuid, text, text, jsonb, uuid) to anon, authenticated;
