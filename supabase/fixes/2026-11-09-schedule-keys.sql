-- Fix: the automatic schedules were sending the wrong key, so every call was refused (403).
-- Steps:
--   1. Supabase → Edge Functions → Secrets: set SHEETS_SYNC_KEY to a new long text you make up.
--   2. Paste that same text below (the text itself, not the words SHEETS_SYNC_KEY).
--   3. Run this whole file once.
-- Safe to run more than once: each schedule is replaced by the same name.
do $fix$
declare
  sync_key text := 'PASTE_YOUR_NEW_KEY_TEXT_HERE';
  base     text := 'https://hbboruauvxywsklffmhn.supabase.co/functions/v1/';
  cmd      text := $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', %L), body := %L::jsonb, timeout_milliseconds := %s)$cmd$;
begin
  if sync_key like 'PASTE_%' then
    raise exception 'Paste your new key text at the top of this file first';
  end if;
  if sync_key in ('SHEETS_SYNC_KEY', 'ISHIP_WEBHOOK_KEY') then
    raise exception 'That is the name of the secret. Paste the text you saved as its value';
  end if;

  perform cron.schedule('sheets-sync', '*/15 * * * *', format(cmd, base || 'sheets-sync', sync_key, '{"action":"sync"}', 60000));
  perform cron.schedule('po-track', '*/30 * * * *', format(cmd, base || 'sheets-sync', sync_key, '{"action":"po-track"}', 120000));
  perform cron.schedule('iship-track', '15 */2 * * *', format(cmd, base || 'iship?trace=1', sync_key, '{}', 120000));
end $fix$;

-- Check a few minutes later: expect 200s, not 403s.
-- select status_code, count(*), max(created) from net._http_response group by 1;
