-- Every 15 minutes: write the website's orders to the status Google Sheet
-- (Edge Function sheets-sync). Before running, replace PUT_SHEETS_SYNC_KEY_HERE
-- with the same text you set as the SHEETS_SYNC_KEY secret.
-- Safe to run more than once (the old schedule is replaced).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'sheets-sync';

select cron.schedule('sheets-sync', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://hbboruauvxywsklffmhn.supabase.co/functions/v1/sheets-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', 'PUT_SHEETS_SYNC_KEY_HERE'),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);

-- To stop it: select cron.unschedule('sheets-sync');
