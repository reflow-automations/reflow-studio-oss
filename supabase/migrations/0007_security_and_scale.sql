-- Reflow Studio 0007: security and scale.
--
-- 1. Sign-ups are blocked in the database. A new auth.users row is accepted only
--    when its e-mail is on private.allowed_emails; an empty list means no new
--    accounts at all (fail closed). The build step (apps/web/scripts/migrate.mjs)
--    and the /setup owner bootstrap fill the list from OWNER_EMAILS through
--    public.sync_allowed_emails(). Existing accounts are not affected.
--    By hand: select public.sync_allowed_emails(array['you@your-domain.com']);
-- 2. Budget accounting in SQL: month_to_date_spend() aggregates on the server
--    (PostgREST max_rows can no longer truncate it) and reserve_budget() checks
--    the cap and inserts the reservation atomically per workspace.
-- 3. pg_cron only calls the app when reconcile work is pending; provider_events
--    are pruned daily; missing indexes and trigram search for the library.
-- 4. Client write policies the app never uses are dropped (all writes go through
--    the service role).
-- 5. Health helpers for /setup: studio_schema_version(), studio_reconcile_config()
--    and studio_allowlist_status().
-- Every function added here is callable by service_role only.

-- ---------------------------------------------------------------------------
-- 0. Explicit privileges. Newer Supabase projects no longer grant table
--    privileges automatically; the app talks to Postgres as service_role and
--    reads its own API keys (RLS "own api keys") as authenticated.
-- ---------------------------------------------------------------------------
grant usage on schema public to service_role, authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.api_keys to authenticated;
-- Tables and sequences later migrations create (as the migrating role) get the same service_role grants.
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;

-- ---------------------------------------------------------------------------
-- 1. Sign-up allowlist
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.allowed_emails (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  created_at timestamptz not null default now()
);
revoke all on table private.allowed_emails from public, anon, authenticated;
comment on table private.allowed_emails is 'E-mail addresses allowed to get a Supabase account (synced from OWNER_EMAILS). Empty = no new accounts.';

create or replace function private.enforce_allowed_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or not exists (
    select 1 from private.allowed_emails a where a.email = lower(btrim(new.email))
  ) then
    raise exception 'sign-ups are closed for this studio'
      using errcode = '42501',
            hint = 'Only addresses in OWNER_EMAILS can get an account; a production deploy or the /setup page syncs the list.';
  end if;
  return new;
end;
$$;

drop trigger if exists reflow_enforce_allowed_email on auth.users;
create trigger reflow_enforce_allowed_email
  before insert on auth.users
  for each row execute function private.enforce_allowed_email();

-- Replace the allowlist with p_emails (trimmed, lower-cased, de-duplicated; entries
-- without an @ are ignored). Returns the number of addresses now on the list.
create or replace function public.sync_allowed_emails(p_emails text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emails text[];
begin
  select coalesce(array_agg(distinct s.e), '{}'::text[])
    into v_emails
    from (select lower(btrim(x)) as e from unnest(coalesce(p_emails, '{}'::text[])) as x) s
   where position('@' in s.e) > 1;
  delete from private.allowed_emails a where not (a.email = any (v_emails));
  insert into private.allowed_emails (email) select unnest(v_emails) on conflict (email) do nothing;
  return cardinality(v_emails);
end;
$$;

-- For /setup: how many addresses are allowed and which of p_emails are missing.
create or replace function public.studio_allowlist_status(p_emails text[] default '{}')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'allowed_count', (select count(*) from private.allowed_emails),
    'missing', coalesce((
      select jsonb_agg(distinct lower(btrim(x)))
        from unnest(coalesce(p_emails, '{}'::text[])) as x
       where btrim(x) <> ''
         and not exists (select 1 from private.allowed_emails a where a.email = lower(btrim(x)))
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Budget accounting
-- ---------------------------------------------------------------------------

-- Same numbers StudioService.monthToDateSpend() computed client-side: settlements
-- since the month start, plus reservations and releases since the month start
-- (clamped at 0). p_month_start defaults to the start of the current UTC month;
-- the service passes its own clock so tests decide the boundary.
create or replace function public.month_to_date_spend(p_workspace_id uuid, p_month_start timestamptz default null)
returns table (settled_usd numeric, reserved_usd numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(l.amount_usd) filter (where l.entry_type = 'settlement'), 0)::numeric,
    greatest(coalesce(sum(l.amount_usd) filter (where l.entry_type in ('reservation', 'release')), 0), 0)::numeric
  from public.ledger_entries l
  where l.workspace_id = p_workspace_id
    and l.created_at >= coalesce(p_month_start, date_trunc('month', now() at time zone 'utc') at time zone 'utc');
$$;

-- Atomic check-and-reserve, a drop-in for "assertBudget + insert reservation" in
-- StudioService.createGeneration(). Serialised per workspace with a transaction
-- advisory lock, so parallel submissions cannot all pass the same check.
--   ok = false: the cap would be exceeded; nothing was written.
--   ok = true : a reservation row was inserted when the rounded amount is > 0
--               (ledger_entry_id), or nothing was needed (amount 0, id null).
-- settled_usd / reserved_usd are the month-to-date figures before this call.
-- p_cap_usd <= 0 means no cap. The amount is rounded to 6 decimals like the ledger.
create or replace function public.reserve_budget(
  p_workspace_id uuid,
  p_generation_id uuid,
  p_amount_usd numeric,
  p_cap_usd numeric default 0,
  p_provider public.provider_id default null,
  p_note text default null,
  p_month_start timestamptz default null
)
returns table (ok boolean, settled_usd numeric, reserved_usd numeric, ledger_entry_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric := round(greatest(coalesce(p_amount_usd, 0), 0), 6);
  v_settled numeric;
  v_reserved numeric;
  v_entry bigint;
begin
  if p_generation_id is not null and not exists (
    select 1 from public.generations g where g.id = p_generation_id and g.workspace_id = p_workspace_id
  ) then
    raise exception 'generation % does not belong to workspace %', p_generation_id, p_workspace_id using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('reflow:budget:' || p_workspace_id::text, 0));

  select m.settled_usd, m.reserved_usd into v_settled, v_reserved
    from public.month_to_date_spend(p_workspace_id, p_month_start) m;

  if coalesce(p_cap_usd, 0) > 0 and v_settled + v_reserved + v_amount > p_cap_usd then
    return query select false, v_settled, v_reserved, null::bigint;
    return;
  end if;

  if v_amount > 0 then
    insert into public.ledger_entries (workspace_id, generation_id, provider, entry_type, amount_usd, note)
    values (p_workspace_id, p_generation_id, p_provider, 'reservation', v_amount, coalesce(p_note, 'highest known candidate estimate including fallback'))
    returning id into v_entry;
  end if;

  return query select true, v_settled, v_reserved, v_entry;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3a. Reconcile guard: pg_cron fires every minute, but the app is only called
--     when a poll is due or a submission is stuck in pending past the service's
--     5-minute timeout (PENDING_TIMEOUT_MS in apps/web/src/lib/studio/service.ts).
-- ---------------------------------------------------------------------------
create or replace function public.trigger_reconcile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  secret text;
begin
  if not exists (
    select 1 from public.generations g
     where (g.state in ('queued', 'running') and (g.next_poll_at is null or g.next_poll_at <= now()))
        or (g.state = 'pending' and g.created_at < now() - interval '5 minutes')
  ) then
    return;
  end if;
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

-- ---------------------------------------------------------------------------
-- 3b. Retention: provider_events grow with every poll and webhook. Delete rows
--     older than p_keep_days, drop payloads older than p_payload_days, and trim
--     the run history of the reflow-* cron jobs. Returns the deleted event count.
-- ---------------------------------------------------------------------------
create or replace function public.prune_provider_events(p_keep_days integer default 30, p_payload_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.provider_events where created_at < now() - make_interval(days => greatest(coalesce(p_keep_days, 30), 1));
  get diagnostics v_deleted = row_count;
  update public.provider_events
     set payload = null
   where payload is not null
     and created_at < now() - make_interval(days => greatest(coalesce(p_payload_days, 7), 1));
  if to_regclass('cron.job_run_details') is not null then
    begin
      execute $q$
        delete from cron.job_run_details
         where end_time < now() - interval '7 days'
           and jobid in (select jobid from cron.job where jobname like 'reflow-%')
      $q$;
    exception when insufficient_privilege then
      raise notice 'cron.job_run_details is not writable for this role; cron history is kept';
    end;
  end if;
  return v_deleted;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('reflow-retention-daily', '17 3 * * *', $cmd$select public.prune_provider_events();$cmd$);
  else
    raise notice 'pg_cron is not installed: the reflow-retention-daily job is skipped';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3c. Indexes for foreign keys and per-user lookups.
-- ---------------------------------------------------------------------------
create index if not exists provider_events_generation_idx on public.provider_events (generation_id) where generation_id is not null;
create index if not exists provider_events_created_idx on public.provider_events (created_at);
create index if not exists generations_api_key_idx on public.generations (api_key_id) where api_key_id is not null;
create index if not exists generations_folder_idx on public.generations (folder_id) where folder_id is not null;
create index if not exists generations_parent_idx on public.generations (parent_id) where parent_id is not null;
create index if not exists generations_creator_idx on public.generations (workspace_id, created_by, created_at desc);
create index if not exists generation_outputs_asset_idx on public.generation_outputs (asset_id) where asset_id is not null;
create index if not exists media_assets_poster_idx on public.media_assets (poster_asset_id) where poster_asset_id is not null;
create index if not exists folders_workspace_idx on public.folders (workspace_id);
create index if not exists folders_parent_idx on public.folders (parent_id) where parent_id is not null;
create index if not exists workspace_members_user_idx on public.workspace_members (user_id, created_at);
create index if not exists api_keys_user_idx on public.api_keys (user_id);
create index if not exists api_keys_workspace_idx on public.api_keys (workspace_id);

-- ---------------------------------------------------------------------------
-- 3d. Library search: the service filters with ILIKE '%q%' on prompt/title, which
--     the tsvector index from 0004 cannot serve. Trigram indexes can.
-- ---------------------------------------------------------------------------
do $$
declare
  v_schema text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm')
     and exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    create schema if not exists extensions;
    create extension pg_trgm with schema extensions;
  end if;
  select n.nspname into v_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if v_schema is null then
    raise notice 'pg_trgm is not available: library search keeps scanning';
    return;
  end if;
  drop index if exists public.media_assets_search_idx;
  execute format('create index if not exists media_assets_prompt_trgm_idx on public.media_assets using gin (prompt %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists media_assets_title_trgm_idx on public.media_assets using gin (title %I.gin_trgm_ops)', v_schema);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Client write policies. The browser only signs in and reads its own API
--    keys; every write goes through the service role, and uploads use signed
--    upload URLs that need no storage insert policy.
-- ---------------------------------------------------------------------------
drop policy if exists "members insert media" on public.media_assets;
drop policy if exists "members update own media" on public.media_assets;
drop policy if exists "members delete media" on public.media_assets;
drop policy if exists "members manage folders" on public.folders;
drop policy if exists "members read folders" on public.folders;
create policy "members read folders" on public.folders for select using (public.is_workspace_member(workspace_id));
drop policy if exists "members manage elements" on public.elements;
drop policy if exists "members read elements" on public.elements;
create policy "members read elements" on public.elements for select using (public.is_workspace_member(workspace_id));
-- profiles.email is written by handle_new_user only; users editing it served no feature.
drop policy if exists "own profile update" on public.profiles;
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "members upload objects" on storage.objects;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Health helpers for /setup
-- ---------------------------------------------------------------------------

-- Bumped by every migration; the app compares it with REQUIRED_SCHEMA_VERSION
-- in apps/web/src/lib/setup/schema.ts.
create or replace function public.studio_schema_version()
returns integer
language sql
stable
set search_path = ''
as $$
  select 7;
$$;

-- Booleans only, never secret values. When the app passes its own base URL and
-- the sha256 (hex) of its reconcile secret, *_matches says whether the vault
-- copies agree (null when not compared).
create or replace function public.studio_reconcile_config(p_expected_base_url text default null, p_expected_secret_sha256 text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vault boolean := to_regclass('vault.decrypted_secrets') is not null;
  v_base text;
  v_secret text;
  v_cron boolean := false;
  v_retention boolean := false;
begin
  if v_vault then
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_base using 'app_base_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_secret using 'reconcile_secret';
  end if;
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = $1 and active)' into v_cron using 'reflow-reconcile-every-minute';
    execute 'select exists (select 1 from cron.job where jobname = $1 and active)' into v_retention using 'reflow-retention-daily';
  end if;
  return jsonb_build_object(
    'vault', v_vault,
    'pg_cron', exists (select 1 from pg_extension where extname = 'pg_cron'),
    'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'),
    'app_base_url', coalesce(v_base, '') <> '',
    'reconcile_secret', coalesce(v_secret, '') <> '',
    'cron_job', v_cron,
    'retention_job', v_retention,
    'app_base_url_matches', case
      when p_expected_base_url is null or coalesce(v_base, '') = '' then null
      else rtrim(v_base, '/') = rtrim(p_expected_base_url, '/')
    end,
    'reconcile_secret_matches', case
      when p_expected_secret_sha256 is null or coalesce(v_secret, '') = '' then null
      else encode(sha256(convert_to(v_secret, 'UTF8')), 'hex') = lower(p_expected_secret_sha256)
    end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges for everything defined above: service_role only.
-- ---------------------------------------------------------------------------
revoke execute on function private.enforce_allowed_email() from public, anon, authenticated;
revoke execute on function public.sync_allowed_emails(text[]) from public, anon, authenticated;
revoke execute on function public.studio_allowlist_status(text[]) from public, anon, authenticated;
revoke execute on function public.month_to_date_spend(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.reserve_budget(uuid, uuid, numeric, numeric, public.provider_id, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.trigger_reconcile() from public, anon, authenticated;
revoke execute on function public.prune_provider_events(integer, integer) from public, anon, authenticated;
revoke execute on function public.studio_schema_version() from public, anon, authenticated;
revoke execute on function public.studio_reconcile_config(text, text) from public, anon, authenticated;

grant execute on function public.sync_allowed_emails(text[]) to service_role;
grant execute on function public.studio_allowlist_status(text[]) to service_role;
grant execute on function public.month_to_date_spend(uuid, timestamptz) to service_role;
grant execute on function public.reserve_budget(uuid, uuid, numeric, numeric, public.provider_id, text, timestamptz) to service_role;
grant execute on function public.prune_provider_events(integer, integer) to service_role;
grant execute on function public.studio_schema_version() to service_role;
grant execute on function public.studio_reconcile_config(text, text) to service_role;
