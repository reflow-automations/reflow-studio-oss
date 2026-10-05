-- Provider API keys entered in the app (Settings → Providers), encrypted with
-- AES-256-GCM under KEY_ENCRYPTION_SECRET (Vercel env). Service-role only: the
-- table has RLS enabled and no policies, so the browser never sees ciphertext.

create table public.provider_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider public.provider_id not null,
  ciphertext text not null,
  iv text not null,
  key_hint text not null,
  status text not null default 'untested' check (status in ('untested', 'valid', 'invalid')),
  last_tested_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

alter table public.provider_keys enable row level security;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger provider_keys_touch
  before update on public.provider_keys
  for each row execute function public.touch_updated_at();

-- Audit trail (who saved/tested/removed which key; never the secret itself).
create table public.provider_key_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider public.provider_id not null,
  action text not null check (action in ('create', 'rotate', 'test', 'delete')),
  detail text,
  actor_id uuid,
  created_at timestamptz not null default now()
);

alter table public.provider_key_events enable row level security;
create index provider_key_events_workspace_idx on public.provider_key_events (workspace_id, created_at desc);

comment on table public.provider_keys is 'Encrypted provider API keys per workspace (AES-256-GCM, AAD = workspace:provider).';
comment on column public.workspaces.settings is 'JSON settings, e.g. {"provider_preference": "cheapest" | "fal" | "kie"}.';
