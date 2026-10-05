-- Asset "memory": denormalised prompt/model on media_assets so the library and
-- the MCP show_medias tool can search past outputs without joining generations
-- (a common pattern for asset libraries).

alter table public.media_assets
  add column title text,
  add column prompt text,
  add column model_id text;

create index media_assets_search_idx on public.media_assets
  using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(prompt, '')));
create index media_assets_model_idx on public.media_assets (workspace_id, model_id);

comment on column public.media_assets.prompt is 'Prompt of the generation that produced this asset (denormalised).';
