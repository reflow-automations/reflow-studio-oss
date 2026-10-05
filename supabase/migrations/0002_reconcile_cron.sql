-- Poll-based reconciliation every minute via pg_cron + pg_net.
-- Vercel Hobby crons run at most daily, so the schedule lives in Postgres instead.
-- Inert until both vault secrets exist (the build step in apps/web/scripts/migrate.mjs
-- writes them; by hand:
--   `select vault.create_secret('<RECONCILE_SECRET>', 'reconcile_secret');`
--   `select vault.create_secret('https://<your-app>', 'app_base_url');`).
-- Supabase ships pg_cron and pg_net on every plan; on a Postgres without them the
-- extensions and the schedule are skipped and the app relies on webhooks and
-- poll-on-read alone.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  else
    raise notice 'pg_cron is not available: the reconcile schedule is skipped';
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create schema if not exists extensions;
    create extension if not exists pg_net schema extensions;
  else
    raise notice 'pg_net is not available: trigger_reconcile() cannot reach the app';
  end if;
end $$;

create or replace function public.trigger_reconcile()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base_url text;
  secret text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'app_base_url' limit 1;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'reconcile_secret' limit 1;
  if base_url is null or secret is null then
    raise notice 'reconcile skipped: vault secrets app_base_url / reconcile_secret missing';
    return;
  end if;
  perform net.http_post(
    url := base_url || '/api/internal/reconcile',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 25000
  );
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('reflow-reconcile-every-minute', '* * * * *', $cmd$select public.trigger_reconcile();$cmd$);
  end if;
end $$;
