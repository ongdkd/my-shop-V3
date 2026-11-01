-- Every 30 minutes: check Purchase Orders LOG parcels at iCargo, so the admin is
-- notified when one reaches Thailand (Edge Function sheets-sync, action po-track).
-- Before running, replace PUT_SHEETS_SYNC_KEY_HERE with the SHEETS_SYNC_KEY secret.
-- Also needs the ICARGO_USERNAME and ICARGO_PASSWORD secrets.
-- Safe to run more than once (the old schedule is replaced).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'po-track';

select cron.schedule('po-track', '*/30 * * * *', $$
  select net.http_post(
    url := 'https://hbboruauvxywsklffmhn.supabase.co/functions/v1/sheets-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', 'PUT_SHEETS_SYNC_KEY_HERE'),
    body := '{"action":"po-track"}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);

-- To stop it: select cron.unschedule('po-track');
