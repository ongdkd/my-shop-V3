-- ── Automatic daily backup inside Supabase ──
-- A snapshot of every table is kept in public.backups (newest 30).
-- pg_cron runs it every night; admins can also take one or download one
-- from Admin → ภาพรวม → สำรองข้อมูล.
-- Same block as in supabase/schema.sql; safe to run more than once.
create table if not exists public.backups (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  summary    jsonb not null default '{}'::jsonb,
  data       jsonb not null
);
alter table public.backups enable row level security;
drop policy if exists backups_admin_read on public.backups;
create policy backups_admin_read on public.backups
  for select to authenticated using (public.is_admin());

create or replace function public.take_backup()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
  v_id   bigint;
begin
  -- pg_cron has no signed-in user; signed-in callers must be admins
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'forbidden';
  end if;

  v_data := jsonb_build_object(
    'order_lists',   coalesce((select jsonb_agg(t order by t.seq) from public.order_lists t), '[]'::jsonb),
    'products',      coalesce((select jsonb_agg(t order by t.seq) from public.products t), '[]'::jsonb),
    'orders',        coalesce((select jsonb_agg(t order by t.seq) from public.orders t), '[]'::jsonb),
    'stock_items',   coalesce((select jsonb_agg(t order by t.seq) from public.stock_items t), '[]'::jsonb),
    'notify_emails', coalesce((select jsonb_agg(t) from public.notify_emails t), '[]'::jsonb)
  );
  insert into public.backups(summary, data)
  values (jsonb_build_object(
            'order_lists', jsonb_array_length(v_data->'order_lists'),
            'products',    jsonb_array_length(v_data->'products'),
            'orders',      jsonb_array_length(v_data->'orders'),
            'stock_items', jsonb_array_length(v_data->'stock_items')),
          v_data)
  returning id into v_id;

  -- ponytail: fixed 30 snapshots; lower it if the 500 MB free DB fills up
  delete from public.backups
  where id not in (select id from public.backups order by id desc limit 30);
  return v_id;
end;
$$;

revoke all on function public.take_backup() from public;
grant execute on function public.take_backup() to authenticated;

-- Every day 03:00 Thailand time (20:00 UTC). Skipped where pg_cron is not
-- available (local test databases).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('daily-backup', '0 20 * * *', 'select public.take_backup()');
  end if;
end $$;

notify pgrst, 'reload schema';
