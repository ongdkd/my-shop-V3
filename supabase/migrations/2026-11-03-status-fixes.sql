-- Status page fixes (2026-11-03):
-- 1. customer_orders also returns each bill's delivered date, so the customer
--    page keeps a parcel under "กำลังจัดส่ง" until it is delivered.
--    Same function as 2026-10-31-iship.sql plus 'deliveredAt'.
-- 2. Every 2 hours: ask iShip for the latest step of every parcel that isn't
--    delivered yet (Edge Function iship, ?trace=<ISHIP_WEBHOOK_KEY>), so statuses
--    stay fresh even when iShip's webhook doesn't arrive.
--    Before running, replace PUT_ISHIP_WEBHOOK_KEY_HERE with the ISHIP_WEBHOOK_KEY
--    secret, and deploy the updated iship function first.
-- Safe to run more than once.

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

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'iship-track';

select cron.schedule('iship-track', '15 */2 * * *', $$
  select net.http_post(
    url := 'https://hbboruauvxywsklffmhn.supabase.co/functions/v1/iship?trace=ISHIP_WEBHOOK_KEY',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);

-- To stop it: select cron.unschedule('iship-track');
