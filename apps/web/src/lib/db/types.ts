/**
 * Hand-maintained Supabase `Database` type for the tables the app touches.
 * Regenerate with `supabase gen types typescript --project-id <ref> > src/lib/db/types.ts`
 * once the project exists; keep the shape in sync with supabase/migrations.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type JobState = "pending" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type MediaKind = "image" | "video" | "audio" | "model" | "file";
export type MediaOrigin = "upload" | "import" | "generated" | "derived";
export type MediaStatus = "pending" | "ready" | "failed";
export type ProviderId = "fal" | "kie" | "higgsfield" | "mock";
export type LedgerEntryType = "reservation" | "settlement" | "release" | "adjustment" | "topup";

export type WorkspaceRow = {
  id: string;
  slug: string;
  name: string;
  settings: Json;
  created_at: string;
}

export type WorkspaceMemberRow = {
  workspace_id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export type MediaAssetRow = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  kind: MediaKind;
  origin: MediaOrigin;
  status: MediaStatus;
  bucket: string;
  object_path: string | null;
  content_type: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  sha256: string | null;
  source_url: string | null;
  source_job_id: string | null;
  poster_asset_id: string | null;
  /** Optional caption set by the user. */
  title: string | null;
  /** Prompt of the generation that produced the asset (denormalised for search). */
  prompt: string | null;
  model_id: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export type GenerationRow = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  api_key_id: string | null;
  model_id: string;
  output_type: "image" | "video" | "audio" | "3d";
  provider: ProviderId | null;
  provider_endpoint: string | null;
  provider_job_id: string | null;
  provider_ref: Json | null;
  provider_input: Json | null;
  request: Json;
  adjustments: Json;
  state: JobState;
  progress: number | null;
  queue_position: number | null;
  error: Json | null;
  attempt: number;
  idempotency_key: string | null;
  webhook_received_at: string | null;
  webhook_verified: boolean | null;
  last_polled_at: string | null;
  next_poll_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cost_estimate_usd: number | null;
  cost_actual_usd: number | null;
  cost_native: number | null;
  batch_id: string | null;
  parent_id: string | null;
  folder_id: string | null;
  tags: string[];
  /** App version (git sha or package version) that created the job; migration 0008. */
  app_version: string | null;
  created_at: string;
  updated_at: string;
}

export type GenerationOutputRow = {
  id: string;
  generation_id: string;
  index: number;
  asset_id: string | null;
  provider_url: string | null;
  kind: MediaKind;
  seed: number | null;
  metadata: Json;
  created_at: string;
}

export type FolderRow = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
}

export type ElementRow = {
  id: string;
  workspace_id: string;
  name: string;
  category: "auto" | "character" | "environment" | "prop";
  description: string | null;
  asset_ids: string[];
  created_at: string;
}

export type ApiKeyRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export type ProviderKeyStatus = "untested" | "valid" | "invalid";

export type ProviderKeyRow = {
  id: string;
  workspace_id: string;
  provider: ProviderId;
  ciphertext: string;
  iv: string;
  key_hint: string;
  status: ProviderKeyStatus;
  last_tested_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ProviderKeyEventRow = {
  id: number;
  workspace_id: string;
  provider: ProviderId;
  action: "create" | "rotate" | "test" | "delete";
  detail: string | null;
  actor_id: string | null;
  created_at: string;
}

export type LedgerEntryRow = {
  id: number;
  workspace_id: string;
  generation_id: string | null;
  provider: ProviderId | null;
  entry_type: LedgerEntryType;
  amount_usd: number;
  amount_native: number | null;
  native_unit: string | null;
  note: string | null;
  created_at: string;
}

export type ProviderEventRow = {
  id: number;
  provider: ProviderId;
  provider_job_id: string | null;
  generation_id: string | null;
  kind: "webhook" | "poll" | "submit" | "cancel" | "upload";
  verified: boolean | null;
  state: JobState | null;
  http_status: number | null;
  payload: Json | null;
  created_at: string;
}

/** Public share link (/s/<token>); migration 0008. Service role only. */
export type ShareRow = {
  id: string;
  workspace_id: string;
  generation_id: string;
  /** null = all outputs of the generation. */
  output_index: number | null;
  /** 22-64 base64url characters (randomToken(16) gives 22). */
  token: string;
  title: string | null;
  show_prompt: boolean;
  show_model: boolean;
  show_cost: boolean;
  show_inputs: boolean;
  in_gallery: boolean;
  /** Lower-case slug, e.g. "spring-2026". */
  challenge: string | null;
  poster_asset_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

/** Row of public.month_to_date_spend(); numeric columns arrive as numbers (or numeric strings). */
export type MonthToDateSpendRow = { settled_usd: number; reserved_usd: number };

/** Row of public.reserve_budget(). */
export type ReserveBudgetRow = { ok: boolean; settled_usd: number; reserved_usd: number; ledger_entry_id: number | null };

/** public.studio_reconcile_config(): booleans only, never secret values. */
export type ReconcileConfig = {
  vault: boolean;
  pg_cron: boolean;
  pg_net: boolean;
  app_base_url: boolean;
  reconcile_secret: boolean;
  cron_job: boolean;
  retention_job: boolean;
  /** null when not compared (no expected value passed or no vault copy). */
  app_base_url_matches: boolean | null;
  reconcile_secret_matches: boolean | null;
};

/** public.studio_allowlist_status(). */
export type AllowlistStatus = { allowed_count: number; missing: string[] };

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

type Table<Row, InsertOptional extends keyof Row> = {
  Row: Row;
  Insert: Optional<Row, InsertOptional>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      workspaces: Table<WorkspaceRow, "id" | "settings" | "created_at">;
      workspace_members: Table<WorkspaceMemberRow, "role" | "created_at">;
      profiles: Table<ProfileRow, "email" | "display_name" | "avatar_url" | "created_at">;
      media_assets: Table<
        MediaAssetRow,
        | "id"
        | "created_by"
        | "status"
        | "bucket"
        | "object_path"
        | "content_type"
        | "bytes"
        | "width"
        | "height"
        | "duration_seconds"
        | "sha256"
        | "source_url"
        | "source_job_id"
        | "poster_asset_id"
        | "title"
        | "prompt"
        | "model_id"
        | "metadata"
        | "created_at"
        | "updated_at"
      >;
      generations: Table<
        GenerationRow,
        | "id"
        | "created_by"
        | "api_key_id"
        | "provider"
        | "provider_endpoint"
        | "provider_job_id"
        | "provider_ref"
        | "provider_input"
        | "adjustments"
        | "state"
        | "progress"
        | "queue_position"
        | "error"
        | "attempt"
        | "idempotency_key"
        | "webhook_received_at"
        | "webhook_verified"
        | "last_polled_at"
        | "next_poll_at"
        | "started_at"
        | "finished_at"
        | "cost_estimate_usd"
        | "cost_actual_usd"
        | "cost_native"
        | "batch_id"
        | "parent_id"
        | "folder_id"
        | "tags"
        | "app_version"
        | "created_at"
        | "updated_at"
      >;
      generation_outputs: Table<GenerationOutputRow, "id" | "index" | "asset_id" | "provider_url" | "seed" | "metadata" | "created_at">;
      folders: Table<FolderRow, "id" | "parent_id" | "created_at">;
      elements: Table<ElementRow, "id" | "category" | "description" | "asset_ids" | "created_at">;
      api_keys: Table<ApiKeyRow, "id" | "scopes" | "last_used_at" | "expires_at" | "revoked_at" | "created_at">;
      provider_keys: Table<ProviderKeyRow, "id" | "status" | "last_tested_at" | "last_error" | "created_by" | "created_at" | "updated_at">;
      provider_key_events: Table<ProviderKeyEventRow, "id" | "detail" | "actor_id" | "created_at">;
      ledger_entries: Table<LedgerEntryRow, "id" | "generation_id" | "provider" | "amount_native" | "native_unit" | "note" | "created_at">;
      provider_events: Table<ProviderEventRow, "id" | "provider_job_id" | "generation_id" | "verified" | "state" | "http_status" | "payload" | "created_at">;
      shares: Table<
        ShareRow,
        | "id"
        | "output_index"
        | "title"
        | "show_prompt"
        | "show_model"
        | "show_cost"
        | "show_inputs"
        | "in_gallery"
        | "challenge"
        | "poster_asset_id"
        | "created_by"
        | "created_at"
        | "updated_at"
        | "expires_at"
        | "revoked_at"
      >;
    };
    Views: {
      ledger_balances: {
        Row: { workspace_id: string; spent_usd: number; reserved_usd: number; budget_usd: number; settled_count: number };
        Relationships: [];
      };
    };
    Functions: {
      is_workspace_member: { Args: { ws: string }; Returns: boolean };
      // Migration 0007. Every function below is executable by service_role only.
      month_to_date_spend: { Args: { p_workspace_id: string; p_month_start?: string | null }; Returns: MonthToDateSpendRow[] };
      reserve_budget: {
        Args: {
          p_workspace_id: string;
          p_generation_id: string | null;
          p_amount_usd: number;
          p_cap_usd?: number;
          p_provider?: ProviderId | null;
          p_note?: string | null;
          p_month_start?: string | null;
        };
        Returns: ReserveBudgetRow[];
      };
      sync_allowed_emails: { Args: { p_emails: string[] }; Returns: number };
      studio_allowlist_status: { Args: { p_emails?: string[] }; Returns: AllowlistStatus };
      studio_schema_version: { Args: Record<PropertyKey, never>; Returns: number };
      studio_reconcile_config: { Args: { p_expected_base_url?: string | null; p_expected_secret_sha256?: string | null }; Returns: ReconcileConfig };
      prune_provider_events: { Args: { p_keep_days?: number; p_payload_days?: number }; Returns: number };
    };
    Enums: {
      job_state: JobState;
      media_kind: MediaKind;
      media_origin: MediaOrigin;
      media_status: MediaStatus;
      provider_id: ProviderId;
      ledger_entry_type: LedgerEntryType;
    };
    CompositeTypes: Record<string, never>;
  };
}
