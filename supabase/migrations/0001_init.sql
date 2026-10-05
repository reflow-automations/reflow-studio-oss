-- Reflow Studio — initial schema (single-tenant workspace, Supabase Postgres 17)
-- Apply with the Supabase CLI (`supabase db push`) or the Supabase MCP `apply_migration`.

-- Pre-flight: this schema reuses names that Supabase starter templates also use
-- (public.profiles, handle_new_user, the media/uploads buckets). Refuse to run on
-- a project that already hosts another app instead of silently taking them over.
do $$
declare
  foreign_buckets boolean := false;
begin
  if to_regclass('public.workspaces') is not null then
    return;
  end if;
  if to_regclass('storage.buckets') is not null then
    execute $q$select exists (select 1 from storage.buckets where id in ('media', 'uploads'))$q$ into foreign_buckets;
  end if;
  if to_regclass('public.profiles') is not null or foreign_buckets then
    raise exception 'This Supabase project already contains another app (public.profiles or a media/uploads bucket exists). Reflow Studio needs a dedicated, empty project.';
  end if;
end $$;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.job_state as enum ('pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.media_kind as enum ('image', 'video', 'audio', 'model', 'file');
create type public.media_origin as enum ('upload', 'import', 'generated', 'derived');
create type public.media_status as enum ('pending', 'ready', 'failed');
create type public.provider_id as enum ('fal', 'kie', 'mock');
create type public.ledger_entry_type as enum ('reservation', 'settlement', 'release', 'adjustment', 'topup');

-- ---------------------------------------------------------------------------
-- Workspace & membership (single tenant today, multi-tenant ready)
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Every authenticated user is auto-added to the default workspace (single tenant).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid;
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  select id into ws from public.workspaces where slug = 'default';
  if ws is null then
    insert into public.workspaces (slug, name) values ('default', 'Reflow Studio') returning id into ws;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, new.id, case when (select count(*) from public.workspace_members where workspace_id = ws) = 0 then 'owner' else 'member' end)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used by RLS policies.
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Media assets (uploads, imports, generated outputs) — stored in Supabase Storage
-- ---------------------------------------------------------------------------
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  kind public.media_kind not null,
  origin public.media_origin not null,
  status public.media_status not null default 'pending',
  bucket text not null default 'media',
  object_path text,
  content_type text,
  bytes bigint,
  width int,
  height int,
  duration_seconds numeric,
  sha256 text,
  -- where the bytes came from (provider CDN url, user url); expires on provider side
  source_url text,
  source_job_id uuid,
  poster_asset_id uuid references public.media_assets(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index media_assets_workspace_idx on public.media_assets (workspace_id, created_at desc);
create index media_assets_job_idx on public.media_assets (source_job_id);

-- ---------------------------------------------------------------------------
-- Generation jobs
-- ---------------------------------------------------------------------------
create table public.generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  api_key_id uuid,
  -- catalog
  model_id text not null,
  output_type text not null check (output_type in ('image', 'video', 'audio', '3d')),
  -- provider
  provider public.provider_id,
  provider_endpoint text,
  provider_job_id text,
  provider_ref jsonb,               -- status/response/cancel urls, family
  provider_input jsonb,             -- body actually sent
  -- request (normalised) + adjustments
  request jsonb not null,
  adjustments jsonb not null default '[]'::jsonb,
  -- lifecycle
  state public.job_state not null default 'pending',
  progress int,
  queue_position int,
  error jsonb,
  attempt int not null default 1,
  idempotency_key text,
  webhook_received_at timestamptz,
  webhook_verified boolean,
  last_polled_at timestamptz,
  next_poll_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  -- money
  cost_estimate_usd numeric(12, 6),
  cost_actual_usd numeric(12, 6),
  cost_native numeric(14, 4),
  -- grouping (batch, pipeline)
  batch_id uuid,
  parent_id uuid references public.generations(id) on delete set null,
  folder_id uuid,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index generations_idempotency_idx on public.generations (workspace_id, idempotency_key) where idempotency_key is not null;
create unique index generations_provider_job_idx on public.generations (provider, provider_job_id) where provider_job_id is not null;
create index generations_workspace_idx on public.generations (workspace_id, created_at desc);
create index generations_state_idx on public.generations (state, next_poll_at) where state in ('queued', 'running', 'pending');
create index generations_batch_idx on public.generations (batch_id);

create table public.generation_outputs (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations(id) on delete cascade,
  index int not null default 0,
  asset_id uuid references public.media_assets(id) on delete set null,
  provider_url text,
  kind public.media_kind not null,
  seed bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (generation_id, index)
);

alter table public.media_assets
  add constraint media_assets_source_job_fk foreign key (source_job_id) references public.generations(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Folders / projects
-- ---------------------------------------------------------------------------
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id uuid references public.folders(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.generations add constraint generations_folder_fk foreign key (folder_id) references public.folders(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Reusable reference elements (Higgsfield "elements": characters / environments / props)
-- ---------------------------------------------------------------------------
create table public.elements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  category text not null default 'auto' check (category in ('auto', 'character', 'environment', 'prop')),
  description text,
  asset_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

-- ---------------------------------------------------------------------------
-- API keys for the MCP server / automation clients (secret is never stored)
-- ---------------------------------------------------------------------------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  prefix text not null,              -- first 12 chars, shown in the UI
  key_hash text not null unique,     -- sha256(secret)
  scopes text[] not null default '{generate,read}',
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.generations add constraint generations_api_key_fk foreign key (api_key_id) references public.api_keys(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Cost ledger (append-only). Balances are derived, never mutated in place.
-- ---------------------------------------------------------------------------
create table public.ledger_entries (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  generation_id uuid references public.generations(id) on delete set null,
  provider public.provider_id,
  entry_type public.ledger_entry_type not null,
  -- positive = money spent/reserved, negative = released/refunded/topped-up
  amount_usd numeric(12, 6) not null,
  amount_native numeric(14, 4),
  native_unit text,
  note text,
  created_at timestamptz not null default now()
);
create index ledger_entries_workspace_idx on public.ledger_entries (workspace_id, created_at desc);
create index ledger_entries_generation_idx on public.ledger_entries (generation_id);

create or replace view public.ledger_balances with (security_invoker = true) as
select
  workspace_id,
  coalesce(sum(case when entry_type = 'settlement' then amount_usd else 0 end), 0) as spent_usd,
  coalesce(sum(case when entry_type in ('reservation', 'release') then amount_usd else 0 end), 0) as reserved_usd,
  coalesce(sum(case when entry_type = 'topup' then -amount_usd else 0 end), 0) as budget_usd,
  count(*) filter (where entry_type = 'settlement') as settled_count
from public.ledger_entries
group by workspace_id;

-- ---------------------------------------------------------------------------
-- Provider events (webhooks + polls) for debugging and idempotency
-- ---------------------------------------------------------------------------
create table public.provider_events (
  id bigint generated always as identity primary key,
  provider public.provider_id not null,
  provider_job_id text,
  generation_id uuid references public.generations(id) on delete set null,
  kind text not null check (kind in ('webhook', 'poll', 'submit', 'cancel', 'upload')),
  verified boolean,
  state public.job_state,
  http_status int,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index provider_events_job_idx on public.provider_events (provider, provider_job_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger generations_touch before update on public.generations for each row execute function public.touch_updated_at();
create trigger media_assets_touch before update on public.media_assets for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: members of a workspace can read everything in it;
-- writes go through the server (service role) except user-owned rows.
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.profiles enable row level security;
alter table public.media_assets enable row level security;
alter table public.generations enable row level security;
alter table public.generation_outputs enable row level security;
alter table public.folders enable row level security;
alter table public.elements enable row level security;
alter table public.api_keys enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.provider_events enable row level security;

create policy "members read workspace" on public.workspaces for select using (public.is_workspace_member(id));
create policy "members read members" on public.workspace_members for select using (public.is_workspace_member(workspace_id));
create policy "own profile" on public.profiles for select using (id = auth.uid());
create policy "own profile update" on public.profiles for update using (id = auth.uid());

create policy "members read media" on public.media_assets for select using (public.is_workspace_member(workspace_id));
create policy "members insert media" on public.media_assets for insert with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "members update own media" on public.media_assets for update using (public.is_workspace_member(workspace_id));
create policy "members delete media" on public.media_assets for delete using (public.is_workspace_member(workspace_id));

create policy "members read generations" on public.generations for select using (public.is_workspace_member(workspace_id));
create policy "members read outputs" on public.generation_outputs for select using (exists (select 1 from public.generations g where g.id = generation_id and public.is_workspace_member(g.workspace_id)));
create policy "members manage folders" on public.folders for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage elements" on public.elements for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "own api keys" on public.api_keys for select using (user_id = auth.uid());
create policy "members read ledger" on public.ledger_entries for select using (public.is_workspace_member(workspace_id));
-- provider_events: server only (no policies → service role only)

-- ---------------------------------------------------------------------------
-- Realtime: broadcast generation changes on a private per-workspace topic
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_generation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.state is not distinct from new.state and old.progress is not distinct from new.progress and old.queue_position is not distinct from new.queue_position then
    return new; -- polling touches (last_polled_at) are not broadcast
  end if;
  perform realtime.broadcast_changes(
    'workspace:' || coalesce(new.workspace_id, old.workspace_id)::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return coalesce(new, old);
end;
$$;
create trigger generations_broadcast
  after insert or update on public.generations
  for each row
  when (pg_trigger_depth() = 0)
  execute function public.broadcast_generation_change();

-- Allow workspace members to receive the private topic.
create policy "members receive workspace broadcasts"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() like 'workspace:%'
    and public.is_workspace_member((split_part(realtime.topic(), ':', 2))::uuid)
  );

-- ---------------------------------------------------------------------------
-- Storage buckets (private; served via signed URLs). 50 MB is the free-plan per-file cap; R2 is the primary store.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800), ('uploads', 'uploads', false, 52428800)
on conflict (id) do nothing;

create policy "members read media objects" on storage.objects for select to authenticated
  using (bucket_id in ('media', 'uploads') and public.is_workspace_member((split_part(name, '/', 1))::uuid));
create policy "members upload objects" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and public.is_workspace_member((split_part(name, '/', 1))::uuid));
