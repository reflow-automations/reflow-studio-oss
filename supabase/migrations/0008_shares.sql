-- Reflow Studio 0008: public share links (competition entries, link previews).
--
-- A share exposes one generation (or one of its outputs) at /s/<token> without a
-- login. Service-role only, like provider_keys: RLS is on and there are no
-- policies, so neither the anon nor the authenticated key can list or forge
-- tokens. The public page is rendered server-side from a field whitelist.
-- Public profile data lives in workspaces.settings.public_profile (no table).

create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  generation_id uuid not null references public.generations(id) on delete cascade,
  -- null = all outputs of the generation
  output_index int check (output_index between 0 and 15),
  -- randomToken(16) from @reflow/core: 22 base64url characters (128 bits)
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{22,64}$'),
  title text check (char_length(title) <= 120),
  show_prompt boolean not null default true,
  show_model boolean not null default true,
  show_cost boolean not null default false,
  show_inputs boolean not null default false,
  in_gallery boolean not null default false,
  challenge text check (challenge ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  poster_asset_id uuid references public.media_assets(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists shares_generation_idx on public.shares (generation_id) where revoked_at is null;
create index if not exists shares_workspace_idx on public.shares (workspace_id, created_at desc);
create index if not exists shares_gallery_idx on public.shares (workspace_id, created_at desc) where in_gallery and revoked_at is null;
create index if not exists shares_poster_idx on public.shares (poster_asset_id) where poster_asset_id is not null;
create index if not exists shares_created_by_idx on public.shares (created_by) where created_by is not null;
-- One active (not revoked) share per generation and output; null output_index = "all outputs".
create unique index if not exists shares_one_active_idx on public.shares (generation_id, coalesce(output_index, -1)) where revoked_at is null;

drop trigger if exists shares_touch on public.shares;
create trigger shares_touch before update on public.shares for each row execute function public.touch_updated_at();

alter table public.shares enable row level security;
revoke all on table public.shares from public, anon, authenticated;
grant select, insert, update, delete on table public.shares to service_role;

comment on table public.shares is 'Public share links (/s/<token>). Service role only; revoke = set revoked_at.';

-- Provenance for competition manifests: the app version that created the job.
alter table public.generations add column if not exists app_version text;
comment on column public.generations.app_version is 'App version (git sha or package version) that created the generation.';

comment on column public.workspaces.settings is 'JSON settings, e.g. {"provider_preference": "cheapest" | "fal" | "kie" | "higgsfield", "public_profile": {"display_name", "handle", "bio", "links": {"github", "linkedin", "website"}, "gallery_enabled": false}}.';

create or replace function public.studio_schema_version()
returns integer
language sql
stable
set search_path = ''
as $$
  select 8;
$$;
revoke execute on function public.studio_schema_version() from public, anon, authenticated;
grant execute on function public.studio_schema_version() to service_role;
