-- Security advisor fixes.

-- Trigger/cron functions are never called through the REST API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.broadcast_generation_change() from public, anon, authenticated;
-- trigger_reconcile() comes from 0002; guarded so this file also applies when 0002 was skipped.
do $$
begin
  if to_regprocedure('public.trigger_reconcile()') is not null then
    revoke execute on function public.trigger_reconcile() from public, anon, authenticated;
  end if;
end $$;
-- RLS helper: signed-in users need it for policy evaluation; anonymous callers do not.
revoke execute on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;

alter function public.touch_updated_at() set search_path = public;

-- pg_net keeps its objects in the `net` schema; only the extension record moves.
-- Only reinstall when it is not already in `extensions`: dropping it wipes its queue.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and not exists (
       select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
       where e.extname = 'pg_net' and n.nspname = 'extensions'
     ) then
    drop extension if exists pg_net;
    create schema if not exists extensions;
    create extension pg_net schema extensions;
  end if;
end $$;
