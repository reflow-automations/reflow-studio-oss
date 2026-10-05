/**
 * In-memory stand-in for the supabase-js client covering exactly the query
 * builder subset `src/lib/studio/service.ts` uses:
 *
 *   from(table).select(cols).eq().lt().gte().in().or().order().limit().maybeSingle()/.single()
 *   from(table).insert(row).select().single()
 *   from(table).update(patch).eq()[.select().single()]
 *   select("*, generations!inner(workspace_id)")      (embedded parent, inner join)
 *   from(table)...is(column, null | true | false)
 *   rpc(fn, args)[.single()/.maybeSingle()]           (the migration 0007 functions, see FakeDatabase.rpc)
 *   auth.admin.getUserById/listUsers/createUser       (with the allowlist + handle_new_user triggers)
 *   storage.from(bucket).upload/createSignedUrl/createSignedUploadUrl/list
 *
 * Everything outside that subset throws a `FakeSupabaseError` so gaps stay
 * visible instead of silently returning `undefined`. Data-dependent
 * constraint violations (unique / foreign key) come back as PostgREST-style
 * `{ data: null, error }` results, exactly like the real client, and are also
 * recorded in `db.violations` so tests can assert nothing was dropped.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AllowlistStatus, ApiKeyRow, Database, GenerationOutputRow, GenerationRow, LedgerEntryRow, MediaAssetRow, ProfileRow, ProviderEventRow, ReconcileConfig, ShareRow, WorkspaceMemberRow, WorkspaceRow } from "@/lib/db/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TableName = "workspaces" | "workspace_members" | "profiles" | "media_assets" | "generations" | "generation_outputs" | "api_keys" | "ledger_entries" | "provider_events" | "shares";
export type ViewName = "ledger_balances";
export type RelationName = TableName | ViewName;

export interface TableRows {
  workspaces: WorkspaceRow;
  workspace_members: WorkspaceMemberRow;
  profiles: ProfileRow;
  media_assets: MediaAssetRow;
  generations: GenerationRow;
  generation_outputs: GenerationOutputRow;
  api_keys: ApiKeyRow;
  ledger_entries: LedgerEntryRow;
  provider_events: ProviderEventRow;
  shares: ShareRow;
}

export interface LedgerBalanceRow {
  workspace_id: string;
  spent_usd: number;
  reserved_usd: number;
  budget_usd: number;
  settled_count: number;
}

type Row = Record<string, unknown>;

export interface PostgrestError {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
}

export interface QueryResult<T> {
  data: T;
  error: PostgrestError | null;
  count: null;
  status: number;
  statusText: string;
}

export type FakeOp = { table: RelationName; op: "select"; rows: number } | { table: TableName; op: "insert"; rows: Row[] } | { table: TableName; op: "update"; patch: Row; matched: number };

export interface Violation {
  table: TableName;
  op: "insert" | "update";
  error: PostgrestError;
  row: Row;
}

/** Thrown for anything the fake does not model (unsupported builder calls, unknown columns, not-null violations). */
export class FakeSupabaseError extends Error {
  constructor(message: string) {
    super(`FakeSupabase: ${message}`);
    this.name = "FakeSupabaseError";
  }
}

// ---------------------------------------------------------------------------
// Schema (mirrors supabase/migrations/0001_init.sql + src/lib/db/types.ts)
// ---------------------------------------------------------------------------

interface TableSpec {
  columns: readonly string[];
  /** NOT NULL columns without a default: inserting null/undefined throws (a service bug). */
  required: readonly string[];
  defaults: (now: string, serial: () => number) => Row;
  unique: ReadonlyArray<{ columns: readonly string[]; partial?: (row: Row) => boolean }>;
  touchUpdatedAt: boolean;
}

const TABLES: Record<TableName, TableSpec> = {
  workspaces: {
    columns: ["id", "slug", "name", "settings", "created_at"],
    required: ["slug", "name"],
    defaults: (now) => ({ id: randomUUID(), settings: {}, created_at: now }),
    unique: [{ columns: ["slug"] }],
    touchUpdatedAt: false,
  },
  workspace_members: {
    columns: ["workspace_id", "user_id", "role", "created_at"],
    required: ["workspace_id", "user_id"],
    defaults: (now) => ({ role: "member", created_at: now }),
    unique: [{ columns: ["workspace_id", "user_id"] }],
    touchUpdatedAt: false,
  },
  profiles: {
    columns: ["id", "email", "display_name", "avatar_url", "created_at"],
    required: ["id"],
    defaults: (now) => ({ email: null, display_name: null, avatar_url: null, created_at: now }),
    unique: [{ columns: ["id"] }],
    touchUpdatedAt: false,
  },
  media_assets: {
    columns: ["id", "workspace_id", "created_by", "kind", "origin", "status", "bucket", "object_path", "content_type", "bytes", "width", "height", "duration_seconds", "sha256", "source_url", "source_job_id", "poster_asset_id", "title", "prompt", "model_id", "metadata", "created_at", "updated_at"],
    required: ["workspace_id", "kind", "origin"],
    defaults: (now) => ({
      id: randomUUID(),
      created_by: null,
      status: "pending",
      bucket: "media",
      object_path: null,
      content_type: null,
      bytes: null,
      width: null,
      height: null,
      duration_seconds: null,
      sha256: null,
      source_url: null,
      source_job_id: null,
      poster_asset_id: null,
      title: null,
      prompt: null,
      model_id: null,
      metadata: {},
      created_at: now,
      updated_at: now,
    }),
    unique: [],
    touchUpdatedAt: true,
  },
  generations: {
    columns: [
      "id",
      "workspace_id",
      "created_by",
      "api_key_id",
      "model_id",
      "output_type",
      "provider",
      "provider_endpoint",
      "provider_job_id",
      "provider_ref",
      "provider_input",
      "request",
      "adjustments",
      "state",
      "progress",
      "queue_position",
      "error",
      "attempt",
      "idempotency_key",
      "webhook_received_at",
      "webhook_verified",
      "last_polled_at",
      "next_poll_at",
      "started_at",
      "finished_at",
      "cost_estimate_usd",
      "cost_actual_usd",
      "cost_native",
      "batch_id",
      "parent_id",
      "folder_id",
      "tags",
      "app_version",
      "created_at",
      "updated_at",
    ],
    required: ["workspace_id", "model_id", "output_type", "request"],
    defaults: (now) => ({
      id: randomUUID(),
      created_by: null,
      api_key_id: null,
      provider: null,
      provider_endpoint: null,
      provider_job_id: null,
      provider_ref: null,
      provider_input: null,
      adjustments: [],
      state: "pending",
      progress: null,
      queue_position: null,
      error: null,
      attempt: 1,
      idempotency_key: null,
      webhook_received_at: null,
      webhook_verified: null,
      last_polled_at: null,
      next_poll_at: null,
      started_at: null,
      finished_at: null,
      cost_estimate_usd: null,
      cost_actual_usd: null,
      cost_native: null,
      batch_id: null,
      parent_id: null,
      folder_id: null,
      tags: [],
      app_version: null,
      created_at: now,
      updated_at: now,
    }),
    unique: [
      { columns: ["workspace_id", "idempotency_key"], partial: (row) => row.idempotency_key !== null },
      { columns: ["provider", "provider_job_id"], partial: (row) => row.provider_job_id !== null },
    ],
    touchUpdatedAt: true,
  },
  generation_outputs: {
    columns: ["id", "generation_id", "index", "asset_id", "provider_url", "kind", "seed", "metadata", "created_at"],
    required: ["generation_id", "kind"],
    defaults: (now) => ({ id: randomUUID(), index: 0, asset_id: null, provider_url: null, seed: null, metadata: {}, created_at: now }),
    unique: [{ columns: ["generation_id", "index"] }],
    touchUpdatedAt: false,
  },
  api_keys: {
    columns: ["id", "workspace_id", "user_id", "name", "prefix", "key_hash", "scopes", "last_used_at", "expires_at", "revoked_at", "created_at"],
    required: ["workspace_id", "user_id", "name", "prefix", "key_hash"],
    defaults: (now) => ({ id: randomUUID(), scopes: [], last_used_at: null, expires_at: null, revoked_at: null, created_at: now }),
    unique: [{ columns: ["key_hash"] }],
    touchUpdatedAt: false,
  },
  ledger_entries: {
    columns: ["id", "workspace_id", "generation_id", "provider", "entry_type", "amount_usd", "amount_native", "native_unit", "note", "created_at"],
    required: ["workspace_id", "entry_type", "amount_usd"],
    defaults: (now, serial) => ({ id: serial(), generation_id: null, provider: null, amount_native: null, native_unit: null, note: null, created_at: now }),
    unique: [],
    touchUpdatedAt: false,
  },
  provider_events: {
    columns: ["id", "provider", "provider_job_id", "generation_id", "kind", "verified", "state", "http_status", "payload", "created_at"],
    required: ["provider", "kind"],
    defaults: (now, serial) => ({ id: serial(), provider_job_id: null, generation_id: null, verified: null, state: null, http_status: null, payload: null, created_at: now }),
    unique: [],
    touchUpdatedAt: false,
  },
  shares: {
    columns: ["id", "workspace_id", "generation_id", "output_index", "token", "title", "show_prompt", "show_model", "show_cost", "show_inputs", "in_gallery", "challenge", "poster_asset_id", "created_by", "created_at", "updated_at", "expires_at", "revoked_at"],
    required: ["workspace_id", "generation_id", "token"],
    defaults: (now) => ({
      id: randomUUID(),
      output_index: null,
      title: null,
      show_prompt: true,
      show_model: true,
      show_cost: false,
      show_inputs: false,
      in_gallery: false,
      challenge: null,
      poster_asset_id: null,
      created_by: null,
      created_at: now,
      updated_at: now,
      expires_at: null,
      revoked_at: null,
    }),
    unique: [
      { columns: ["token"] },
      // shares_one_active_idx: one active share per (generation, output); null output_index means "all outputs".
      { columns: ["generation_id", "output_index_key"], partial: (row) => row.revoked_at === null || row.revoked_at === undefined },
    ],
    touchUpdatedAt: true,
  },
};

/** Computed unique-key columns (expression indexes in SQL). */
const UNIQUE_EXPRESSIONS: Record<string, (row: Row) => unknown> = {
  output_index_key: (row) => (row.output_index === null || row.output_index === undefined ? -1 : row.output_index),
};

const VIEW_COLUMNS: Record<ViewName, readonly string[]> = {
  ledger_balances: ["workspace_id", "spent_usd", "reserved_usd", "budget_usd", "settled_count"],
};

const FOREIGN_KEYS: ReadonlyArray<{ table: TableName; column: string; ref: TableName }> = [
  { table: "media_assets", column: "workspace_id", ref: "workspaces" },
  { table: "media_assets", column: "source_job_id", ref: "generations" },
  { table: "media_assets", column: "poster_asset_id", ref: "media_assets" },
  { table: "generations", column: "workspace_id", ref: "workspaces" },
  { table: "generations", column: "parent_id", ref: "generations" },
  { table: "generation_outputs", column: "generation_id", ref: "generations" },
  { table: "generation_outputs", column: "asset_id", ref: "media_assets" },
  { table: "api_keys", column: "workspace_id", ref: "workspaces" },
  { table: "ledger_entries", column: "workspace_id", ref: "workspaces" },
  { table: "ledger_entries", column: "generation_id", ref: "generations" },
  { table: "provider_events", column: "generation_id", ref: "generations" },
  { table: "workspace_members", column: "workspace_id", ref: "workspaces" },
  { table: "shares", column: "workspace_id", ref: "workspaces" },
  { table: "shares", column: "generation_id", ref: "generations" },
  { table: "shares", column: "poster_asset_id", ref: "media_assets" },
];

/** Embedded resources supported in `select("..., relation(cols)")`: child table -> relation name -> parent. */
const RELATIONSHIPS: Partial<Record<TableName, Record<string, { table: TableName; localColumn: string }>>> = {
  generation_outputs: {
    generations: { table: "generations", localColumn: "generation_id" },
    media_assets: { table: "media_assets", localColumn: "asset_id" },
  },
  generations: { workspaces: { table: "workspaces", localColumn: "workspace_id" } },
  media_assets: { workspaces: { table: "workspaces", localColumn: "workspace_id" } },
  workspace_members: { workspaces: { table: "workspaces", localColumn: "workspace_id" } },
  shares: {
    generations: { table: "generations", localColumn: "generation_id" },
    workspaces: { table: "workspaces", localColumn: "workspace_id" },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** PostgREST serialises rows as JSON: drops `undefined`, stringifies Dates. */
function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}

/** SQL-ish comparison: numbers numerically, timestamps by instant, everything else as strings. */
function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number" && typeof b === "string" && b.trim() !== "" && Number.isFinite(Number(b))) return a - Number(b);
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "" && Number.isFinite(Number(a))) return Number(a) - b;
  const ta = timestamp(a);
  const tb = timestamp(b);
  if (ta !== undefined && tb !== undefined) return ta - tb;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

function equalsValue(a: unknown, b: unknown): boolean {
  if (isNullish(a) || isNullish(b)) return false;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  return compare(a, b) === 0;
}

function pgError(code: string, message: string, details: string | null = null): PostgrestError {
  return { message, code, details, hint: null };
}

const PROBE_KEYS = new Set(["then", "catch", "finally", "toJSON", "constructor", "$$typeof", "nodeType", "asymmetricMatch", "inspect", "toString", "valueOf", "hasOwnProperty", "length"]);

/** Wrap an object so that reading a property it does not have throws instead of yielding `undefined`. */
function strict<T extends object>(target: T, label: string): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === "symbol" || prop in t || PROBE_KEYS.has(prop)) return Reflect.get(t, prop, receiver);
      throw new FakeSupabaseError(`unsupported call ${label}.${String(prop)}()`);
    },
  });
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Same normalisation as public.sync_allowed_emails(): trimmed, lower-cased, de-duplicated, must contain "@" (unless keepInvalid). */
function normalizeEmails(value: unknown, options: { keepInvalid?: boolean } = {}): string[] {
  const list = Array.isArray(value) ? value : [];
  const out = new Set<string>();
  for (const item of list) {
    const email = String(item ?? "").trim().toLowerCase();
    if (email === "") continue;
    if (!options.keepInvalid && email.indexOf("@") < 1) continue;
    out.add(email);
  }
  return [...out];
}

export interface FakeAuthUser {
  id: string;
  email: string;
  created_at: string;
  email_confirmed_at: string | null;
}

export type FakeReconcileState = Omit<ReconcileConfig, "app_base_url_matches" | "reconcile_secret_matches"> & {
  /** Vault copy of app_base_url, compared with p_expected_base_url. */
  vault_app_base_url?: string;
  /** sha256 hex of the vault reconcile_secret, compared with p_expected_secret_sha256. */
  vault_reconcile_secret_sha256?: string;
};

// ---------------------------------------------------------------------------
// Select projection parsing
// ---------------------------------------------------------------------------

interface Projection {
  all: boolean;
  columns: string[];
  joins: Array<{ relation: string; inner: boolean; columns: string[]; all: boolean }>;
}

function splitTopLevel(spec: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of spec) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

function parseSelect(spec: string, table: RelationName): Projection {
  const projection: Projection = { all: false, columns: [], joins: [] };
  for (const part of splitTopLevel(spec.replace(/\s+/g, " "))) {
    if (part === "*") {
      projection.all = true;
      continue;
    }
    const join = /^([a-z_]+)(!inner)?\s*\((.*)\)$/i.exec(part);
    if (join) {
      const inner = join[3]?.trim() ?? "";
      const cols = inner === "*" ? [] : inner.split(",").map((c) => c.trim()).filter(Boolean);
      if (cols.some((c) => !/^[a-z_]+$/i.test(c))) throw new FakeSupabaseError(`unsupported embedded select "${part}" on ${table}`);
      projection.joins.push({ relation: join[1] ?? "", inner: Boolean(join[2]), columns: cols, all: inner === "*" });
      continue;
    }
    if (/^[a-z_]+$/i.test(part)) {
      projection.columns.push(part);
      continue;
    }
    throw new FakeSupabaseError(`unsupported select expression "${part}" on ${table} (aliases, casts and aggregates are not modelled)`);
  }
  return projection;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export class FakeDatabase {
  readonly tables: Record<TableName, Row[]> = {
    workspaces: [],
    workspace_members: [],
    profiles: [],
    media_assets: [],
    generations: [],
    generation_outputs: [],
    api_keys: [],
    ledger_entries: [],
    provider_events: [],
    shares: [],
  };
  /** Every insert/update/select the service issued, in order. */
  readonly log: FakeOp[] = [];
  /** Unique / foreign-key violations that were returned as `{ error }` (and therefore dropped, as in the real DB). */
  readonly violations: Violation[] = [];
  private serialCounter = 0;

  // ----- state behind rpc() and auth.admin (migration 0007 objects) ----------

  /** private.allowed_emails: the BEFORE INSERT trigger on auth.users rejects addresses not in here. */
  readonly allowedEmails = new Set<string>();
  /** auth.users stand-in. */
  readonly users: FakeAuthUser[] = [];
  /** Value returned by studio_schema_version(); null makes the function "missing" (migrations not applied). */
  schemaVersion: number | null = 8;
  /** Flags returned by studio_reconcile_config(); the *_matches fields are computed from the expectations passed in. */
  reconcileConfig: FakeReconcileState = {
    vault: true,
    pg_cron: true,
    pg_net: true,
    app_base_url: false,
    reconcile_secret: false,
    cron_job: true,
    retention_job: true,
  };
  /** Functions that answer with PostgREST's PGRST202 "not found" (simulates an older schema). */
  readonly missingFunctions = new Set<string>();
  /** Every rpc() call in order. */
  readonly rpcLog: Array<{ fn: string; args: Row }> = [];

  constructor(readonly now: () => Date) {}

  /** Execute a database function the way PostgREST's /rpc endpoint would. */
  rpc(fn: string, args: Row = {}): { data: unknown; error: PostgrestError | null } {
    this.rpcLog.push({ fn, args: jsonClone(args) });
    const missing = () => ({ data: null, error: pgError("PGRST202", `Could not find the function public.${fn} in the schema cache`) });
    if (this.missingFunctions.has(fn)) return missing();
    switch (fn) {
      case "month_to_date_spend":
        return { data: [this.monthToDateSpend(String(args.p_workspace_id), args.p_month_start as string | null | undefined)], error: null };
      case "reserve_budget":
        return this.reserveBudget(args);
      case "sync_allowed_emails": {
        const emails = normalizeEmails(args.p_emails);
        this.allowedEmails.clear();
        for (const email of emails) this.allowedEmails.add(email);
        return { data: emails.length, error: null };
      }
      case "studio_allowlist_status": {
        const missingEmails = normalizeEmails(args.p_emails, { keepInvalid: true }).filter((e) => !this.allowedEmails.has(e));
        const status: AllowlistStatus = { allowed_count: this.allowedEmails.size, missing: missingEmails };
        return { data: status, error: null };
      }
      case "studio_schema_version":
        return this.schemaVersion === null ? missing() : { data: this.schemaVersion, error: null };
      case "studio_reconcile_config": {
        const { vault_app_base_url, vault_reconcile_secret_sha256, ...flags } = this.reconcileConfig;
        const expectedBase = args.p_expected_base_url as string | null | undefined;
        const expectedSha = args.p_expected_secret_sha256 as string | null | undefined;
        const config: ReconcileConfig = {
          ...flags,
          app_base_url_matches: !expectedBase || !flags.app_base_url ? null : (vault_app_base_url ?? "").replace(/\/+$/, "") === expectedBase.replace(/\/+$/, ""),
          reconcile_secret_matches: !expectedSha || !flags.reconcile_secret ? null : (vault_reconcile_secret_sha256 ?? "") === expectedSha.toLowerCase(),
        };
        return { data: config, error: null };
      }
      case "prune_provider_events": {
        const keepDays = Math.max(Number(args.p_keep_days ?? 30), 1);
        const cutoff = this.now().getTime() - keepDays * 86_400_000;
        const before = this.tables.provider_events.length;
        this.tables.provider_events = this.tables.provider_events.filter((row) => (timestamp(row.created_at) ?? 0) >= cutoff);
        return { data: before - this.tables.provider_events.length, error: null };
      }
      default:
        throw new FakeSupabaseError(`rpc("${fn}") is not modelled`);
    }
  }

  /** Same numbers as public.month_to_date_spend(): settlements, plus reservations and releases (clamped at 0), since the month start. */
  monthToDateSpend(workspaceId: string, monthStart?: string | null): { settled_usd: number; reserved_usd: number } {
    const now = this.now();
    const start = monthStart ? Date.parse(monthStart) : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    let settled = 0;
    let reserved = 0;
    for (const entry of this.tables.ledger_entries) {
      if (entry.workspace_id !== workspaceId || (timestamp(entry.created_at) ?? 0) < start) continue;
      if (entry.entry_type === "settlement") settled += Number(entry.amount_usd);
      else if (entry.entry_type === "reservation" || entry.entry_type === "release") reserved += Number(entry.amount_usd);
    }
    return { settled_usd: round6(settled), reserved_usd: round6(Math.max(0, reserved)) };
  }

  /** public.reserve_budget(): check the cap and insert the reservation in one step (the fake is single-threaded, so it is atomic). */
  private reserveBudget(args: Row): { data: unknown; error: PostgrestError | null } {
    const workspaceId = String(args.p_workspace_id);
    const generationId = (args.p_generation_id as string | null | undefined) ?? null;
    if (generationId !== null && !this.tables.generations.some((g) => g.id === generationId && g.workspace_id === workspaceId)) {
      return { data: null, error: pgError("22023", `generation ${generationId} does not belong to workspace ${workspaceId}`) };
    }
    const amount = round6(Math.max(Number(args.p_amount_usd ?? 0), 0));
    const cap = Number(args.p_cap_usd ?? 0);
    const spend = this.monthToDateSpend(workspaceId, args.p_month_start as string | null | undefined);
    if (cap > 0 && spend.settled_usd + spend.reserved_usd + amount > cap) {
      return { data: [{ ok: false, ...spend, ledger_entry_id: null }], error: null };
    }
    let ledgerEntryId: number | null = null;
    if (amount > 0) {
      const inserted = this.insertRows("ledger_entries", [
        { workspace_id: workspaceId, generation_id: generationId, provider: args.p_provider ?? null, entry_type: "reservation", amount_usd: amount, note: args.p_note ?? "highest known candidate estimate including fallback" },
      ]);
      if (inserted.error) return { data: null, error: inserted.error };
      ledgerEntryId = Number(inserted.data[0]?.id);
    }
    return { data: [{ ok: true, ...spend, ledger_entry_id: ledgerEntryId }], error: null };
  }

  /**
   * auth.users insert: the reflow_enforce_allowed_email BEFORE trigger, then the
   * handle_new_user AFTER trigger (profile + membership of the 'default'
   * workspace, owner when it has no members yet).
   */
  createAuthUser(input: { email: string; emailConfirmed?: boolean }): { user: FakeAuthUser | null; error: { message: string; status: number; code: string } | null } {
    const email = input.email.trim().toLowerCase();
    if (!this.allowedEmails.has(email)) return { user: null, error: { message: "Database error creating new user", status: 500, code: "unexpected_failure" } };
    if (this.users.some((u) => u.email === email)) return { user: null, error: { message: "A user with this email address has already been registered", status: 422, code: "email_exists" } };
    const nowIso = this.now().toISOString();
    const user: FakeAuthUser = { id: randomUUID(), email, created_at: nowIso, email_confirmed_at: input.emailConfirmed ? nowIso : null };
    this.users.push(user);
    this.seed("profiles", { id: user.id, email, display_name: email.split("@")[0] ?? null });
    const workspace = this.tables.workspaces.find((w) => w.slug === "default") ?? (this.seed("workspaces", { slug: "default", name: "Reflow Studio" }) as unknown as Row);
    const hasMembers = this.tables.workspace_members.some((m) => m.workspace_id === workspace.id);
    this.seed("workspace_members", { workspace_id: String(workspace.id), user_id: user.id, role: hasMembers ? "member" : "owner" });
    return { user, error: null };
  }

  // ----- typed test-side helpers -------------------------------------------

  /** Snapshot (deep copy) of a table. */
  rows<T extends TableName>(table: T): TableRows[T][] {
    return this.tables[table].map((row) => structuredClone(row)) as TableRows[T][];
  }

  find<T extends TableName>(table: T, id: string | number): TableRows[T] | undefined {
    const row = this.tables[table].find((r) => r.id === id);
    return row ? (structuredClone(row) as TableRows[T]) : undefined;
  }

  /** Insert a row applying DB defaults; throws on any constraint problem (tests should seed valid data). */
  seed<T extends TableName>(table: T, row: Partial<TableRows[T]>): TableRows[T] {
    const result = this.insertRows(table, [row as Row]);
    if (result.error) throw new FakeSupabaseError(`seed ${table}: ${result.error.message}`);
    return result.data[0] as TableRows[T];
  }

  /** Patch a row by id bypassing the service; throws when the row is missing or a constraint fails. */
  patch<T extends TableName>(table: T, id: string | number, patch: Partial<TableRows[T]>): TableRows[T] {
    const result = this.updateRows(table, patch as Row, [(row) => row.id === id]);
    if (result.error) throw new FakeSupabaseError(`patch ${table}: ${result.error.message}`);
    const [updated] = result.data;
    if (!updated) throw new FakeSupabaseError(`patch ${table}: no row with id ${String(id)}`);
    return updated as TableRows[T];
  }

  // ----- internals used by the query builder --------------------------------

  spec(relation: RelationName): { columns: readonly string[]; table: TableSpec | undefined } {
    if (relation in TABLES) return { columns: TABLES[relation as TableName].columns, table: TABLES[relation as TableName] };
    if (relation in VIEW_COLUMNS) return { columns: VIEW_COLUMNS[relation as ViewName], table: undefined };
    throw new FakeSupabaseError(`unknown relation "${relation}"`);
  }

  assertColumn(relation: RelationName, column: string, context: string): void {
    if (!this.spec(relation).columns.includes(column)) throw new FakeSupabaseError(`${context}: unknown column "${column}" on ${relation}`);
  }

  /** Live rows of a relation (views are computed). Never hand these to callers without cloning. */
  read(relation: RelationName): Row[] {
    if (relation === "ledger_balances") return this.ledgerBalances();
    return this.tables[relation];
  }

  insertRows(table: TableName, values: Row[]): { data: Row[]; error: null } | { data: null; error: PostgrestError } {
    const spec = TABLES[table];
    const nowIso = this.now().toISOString();
    const prepared: Row[] = [];
    for (const value of values) {
      for (const column of Object.keys(value)) this.assertColumn(table, column, `insert into ${table}`);
      const full: Row = { ...spec.defaults(nowIso, () => ++this.serialCounter), ...jsonClone(value) };
      for (const column of spec.required) {
        if (isNullish(full[column])) throw new FakeSupabaseError(`insert into ${table}: null value in column "${column}" violates not-null constraint`);
      }
      const violation = this.checkConstraints(table, full, prepared);
      if (violation) {
        this.violations.push({ table, op: "insert", error: violation, row: full });
        return { data: null, error: violation };
      }
      prepared.push(full);
    }
    this.tables[table].push(...prepared);
    this.log.push({ table, op: "insert", rows: prepared.map((r) => structuredClone(r)) });
    return { data: prepared.map((r) => structuredClone(r)), error: null };
  }

  updateRows(table: TableName, patch: Row, filters: Array<(row: Row) => boolean>): { data: Row[]; error: null } | { data: null; error: PostgrestError } {
    const spec = TABLES[table];
    for (const column of Object.keys(patch)) this.assertColumn(table, column, `update ${table}`);
    const clean = jsonClone(patch);
    const matched = this.tables[table].filter((row) => filters.every((f) => f(row)));
    const next: Row[] = matched.map((row) => ({ ...row, ...clean, ...(spec.touchUpdatedAt ? { updated_at: this.now().toISOString() } : {}) }));
    for (const [i, candidate] of next.entries()) {
      for (const column of spec.required) {
        if (isNullish(candidate[column])) throw new FakeSupabaseError(`update ${table}: null value in column "${column}" violates not-null constraint`);
      }
      const violation = this.checkConstraints(table, candidate, next.slice(0, i), matched[i]);
      if (violation) {
        this.violations.push({ table, op: "update", error: violation, row: candidate });
        return { data: null, error: violation };
      }
    }
    for (const [i, row] of matched.entries()) Object.assign(row, next[i]);
    this.log.push({ table, op: "update", patch: clean, matched: matched.length });
    return { data: matched.map((r) => structuredClone(r)), error: null };
  }

  private checkConstraints(table: TableName, candidate: Row, pendingSiblings: Row[], self?: Row): PostgrestError | undefined {
    const spec = TABLES[table];
    const others = [...this.tables[table].filter((row) => row !== self), ...pendingSiblings];
    const key = (row: Row, column: string): unknown => (UNIQUE_EXPRESSIONS[column] ? UNIQUE_EXPRESSIONS[column](row) : row[column]);
    for (const unique of spec.unique) {
      if (unique.partial && !unique.partial(candidate)) continue;
      if (unique.columns.some((c) => isNullish(key(candidate, c)))) continue;
      const clash = others.find((row) => (!unique.partial || unique.partial(row)) && unique.columns.every((c) => equalsValue(key(row, c), key(candidate, c))));
      if (clash) return pgError("23505", `duplicate key value violates unique constraint on ${table}(${unique.columns.join(", ")})`, `Key (${unique.columns.map((c) => String(key(candidate, c))).join(", ")}) already exists.`);
    }
    for (const fk of FOREIGN_KEYS) {
      if (fk.table !== table || isNullish(candidate[fk.column])) continue;
      const parent = fk.ref === table ? [...this.tables[fk.ref], ...pendingSiblings] : this.tables[fk.ref];
      if (!parent.some((row) => row.id === candidate[fk.column])) {
        return pgError("23503", `insert or update on table "${table}" violates foreign key constraint on column "${fk.column}"`, `Key (${fk.column})=(${String(candidate[fk.column])}) is not present in table "${fk.ref}".`);
      }
    }
    return undefined;
  }

  private ledgerBalances(): Row[] {
    const groups = new Map<string, LedgerBalanceRow>();
    for (const entry of this.tables.ledger_entries) {
      const workspaceId = String(entry.workspace_id);
      const group = groups.get(workspaceId) ?? { workspace_id: workspaceId, spent_usd: 0, reserved_usd: 0, budget_usd: 0, settled_count: 0 };
      const amount = Number(entry.amount_usd);
      if (entry.entry_type === "settlement") {
        group.spent_usd += amount;
        group.settled_count += 1;
      } else if (entry.entry_type === "reservation" || entry.entry_type === "release") group.reserved_usd += amount;
      else if (entry.entry_type === "topup") group.budget_usd -= amount;
      groups.set(workspaceId, group);
    }
    return [...groups.values()].map((g) => ({ ...g }));
  }
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

type Filter = (row: Row) => boolean;

interface Ordering {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
}

class FakeQueryBuilder implements PromiseLike<QueryResult<unknown>> {
  private mode: "select" | "insert" | "update" | "upsert" = "select";
  private upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } | undefined = undefined;
  private payload: Row[] | Row | undefined = undefined;
  private readonly filters: Filter[] = [];
  private readonly ordering: Ordering[] = [];
  private limitCount: number | undefined = undefined;
  private projection: Projection | undefined = undefined;
  private shape: "single" | "maybeSingle" | undefined = undefined;

  constructor(
    private readonly db: FakeDatabase,
    private readonly relation: RelationName,
  ) {}

  // ----- verbs ---------------------------------------------------------------

  select(columns = "*"): this {
    if (this.projection) throw new FakeSupabaseError(`select() called twice on ${this.relation}`);
    this.projection = parseSelect(columns, this.relation);
    return this;
  }

  insert(values: Row | Row[]): this {
    this.assertTable("insert");
    this.assertFresh("insert");
    this.mode = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  update(patch: Row): this {
    this.assertTable("update");
    this.assertFresh("update");
    this.mode = "update";
    this.payload = patch;
    return this;
  }

  /** INSERT ... ON CONFLICT (onConflict columns) DO NOTHING | DO UPDATE. Rows skipped by ignoreDuplicates are not returned (PostgREST semantics). */
  upsert(values: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.assertTable("upsert");
    this.assertFresh("upsert");
    this.mode = "upsert";
    this.payload = Array.isArray(values) ? values : [values];
    this.upsertOptions = options;
    return this;
  }

  // ----- filters -------------------------------------------------------------

  eq(column: string, value: unknown): this {
    this.addFilter(column, "eq", (row) => equalsValue(row[column], value));
    return this;
  }

  lt(column: string, value: unknown): this {
    this.addFilter(column, "lt", (row) => !isNullish(row[column]) && compare(row[column], value) < 0);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.addFilter(column, "gte", (row) => !isNullish(row[column]) && compare(row[column], value) >= 0);
    return this;
  }

  /** PostgREST `is`: null, true or false. */
  is(column: string, value: null | boolean): this {
    if (value !== null && typeof value !== "boolean") throw new FakeSupabaseError(`is(${column}) expects null, true or false`);
    this.addFilter(column, "is", (row) => (value === null ? isNullish(row[column]) : row[column] === value));
    return this;
  }

  in(column: string, values: unknown[]): this {
    if (!Array.isArray(values)) throw new FakeSupabaseError(`in(${column}) expects an array`);
    this.addFilter(column, "in", (row) => values.some((v) => equalsValue(row[column], v)));
    return this;
  }

  /** PostgREST `or` filter: comma-separated `column.operator.value` clauses (no nesting). */
  or(expression: string): this {
    if (/[()]/.test(expression)) throw new FakeSupabaseError(`or("${expression}"): nested and/or groups are not modelled`);
    const clauses = expression.split(",").map((clause) => {
      const [column, operator, ...rest] = clause.split(".");
      const value = rest.join(".");
      if (!column || !operator) throw new FakeSupabaseError(`or("${expression}"): malformed clause "${clause}"`);
      this.db.assertColumn(this.relation, column, `or("${expression}")`);
      switch (operator) {
        case "is": {
          if (value === "null") return (row: Row) => row[column] === null;
          if (value === "true" || value === "false") return (row: Row) => row[column] === (value === "true");
          throw new FakeSupabaseError(`or("${expression}"): is.${value} is not modelled`);
        }
        case "eq":
          return (row: Row) => equalsValue(row[column], value);
        case "neq":
          return (row: Row) => !isNullish(row[column]) && !equalsValue(row[column], value);
        case "lt":
          return (row: Row) => !isNullish(row[column]) && compare(row[column], value) < 0;
        case "lte":
          return (row: Row) => !isNullish(row[column]) && compare(row[column], value) <= 0;
        case "gt":
          return (row: Row) => !isNullish(row[column]) && compare(row[column], value) > 0;
        case "gte":
          return (row: Row) => !isNullish(row[column]) && compare(row[column], value) >= 0;
        case "ilike": {
          // PostgREST pattern: % = any run of characters, _ = one character; case-insensitive.
          const pattern = new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "is");
          return (row: Row) => typeof row[column] === "string" && pattern.test(row[column] as string);
        }
        default:
          throw new FakeSupabaseError(`or("${expression}"): operator "${operator}" is not modelled`);
      }
    });
    this.assertNotTerminal("or");
    this.filters.push((row) => clauses.some((clause) => clause(row)));
    return this;
  }

  // ----- modifiers -----------------------------------------------------------

  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string; referencedTable?: string } = {}): this {
    this.assertNotTerminal("order");
    if (options.foreignTable || options.referencedTable) throw new FakeSupabaseError(`order(${column}) on an embedded resource is not modelled`);
    this.db.assertColumn(this.relation, column, "order()");
    const ascending = options.ascending ?? true;
    // Postgres defaults: ASC NULLS LAST, DESC NULLS FIRST.
    this.ordering.push({ column, ascending, nullsFirst: options.nullsFirst ?? !ascending });
    return this;
  }

  limit(count: number): this {
    this.assertNotTerminal("limit");
    if (!Number.isInteger(count) || count < 0) throw new FakeSupabaseError(`limit(${String(count)}) must be a non-negative integer`);
    this.limitCount = count;
    return this;
  }

  single(): this {
    this.assertNotTerminal("single");
    this.shape = "single";
    return this;
  }

  maybeSingle(): this {
    this.assertNotTerminal("maybeSingle");
    this.shape = "maybeSingle";
    return this;
  }

  // ----- execution -------------------------------------------------------------

  then<TResult1 = QueryResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return new Promise<QueryResult<unknown>>((resolve, reject) => {
      try {
        resolve(this.execute());
      } catch (err) {
        reject(err);
      }
    }).then(onfulfilled, onrejected);
  }

  private execute(): QueryResult<unknown> {
    switch (this.mode) {
      case "select": {
        if (!this.projection) throw new FakeSupabaseError(`query on ${this.relation} awaited without select()/insert()/update()`);
        const filtered = this.db.read(this.relation).filter((row) => this.filters.every((f) => f(row)));
        const joined = this.attachJoins(filtered);
        const ordered = this.applyOrder(joined);
        const limited = this.limitCount === undefined ? ordered : ordered.slice(0, this.limitCount);
        this.db.log.push({ table: this.relation, op: "select", rows: limited.length });
        return this.finish(limited.map((entry) => this.project(entry.raw, entry.embedded)));
      }
      case "insert": {
        if (this.filters.length > 0 || this.ordering.length > 0 || this.limitCount !== undefined) throw new FakeSupabaseError(`filters/order/limit on insert into ${this.relation} are not modelled`);
        const result = this.db.insertRows(this.relation as TableName, this.payload as Row[]);
        if (result.error) return { data: null, error: result.error, count: null, status: 409, statusText: "Conflict" };
        if (!this.projection) return this.ok(null);
        return this.finish(result.data.map((row) => this.project(row, {})));
      }
      case "upsert": {
        if (this.filters.length > 0 || this.ordering.length > 0 || this.limitCount !== undefined) throw new FakeSupabaseError(`filters/order/limit on upsert into ${this.relation} are not modelled`);
        const conflictColumns = (this.upsertOptions?.onConflict ?? "id").split(",").map((c) => c.trim());
        const affected: Row[] = [];
        for (const value of this.payload as Row[]) {
          const existing = this.db.read(this.relation).find((row) => conflictColumns.every((c) => row[c] === value[c]));
          if (existing) {
            if (this.upsertOptions?.ignoreDuplicates) continue;
            const updated = this.db.updateRows(this.relation as TableName, value, [(row) => conflictColumns.every((c) => row[c] === value[c])]);
            if (updated.error) return { data: null, error: updated.error, count: null, status: 409, statusText: "Conflict" };
            affected.push(...updated.data);
            continue;
          }
          const inserted = this.db.insertRows(this.relation as TableName, [value]);
          if (inserted.error) return { data: null, error: inserted.error, count: null, status: 409, statusText: "Conflict" };
          affected.push(...inserted.data);
        }
        if (!this.projection) return this.ok(null);
        return this.finish(affected.map((row) => this.project(row, {})));
      }
      case "update": {
        if (this.ordering.length > 0 || this.limitCount !== undefined) throw new FakeSupabaseError(`order/limit on update ${this.relation} are not modelled`);
        const result = this.db.updateRows(this.relation as TableName, this.payload as Row, this.filters);
        if (result.error) return { data: null, error: result.error, count: null, status: 409, statusText: "Conflict" };
        if (!this.projection) return this.ok(null);
        return this.finish(result.data.map((row) => this.project(row, {})));
      }
    }
  }

  private finish(rows: Row[]): QueryResult<unknown> {
    if (this.shape === "single") {
      if (rows.length !== 1) return { data: null, error: pgError("PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${rows.length} rows`), count: null, status: 406, statusText: "Not Acceptable" };
      return this.ok(rows[0]);
    }
    if (this.shape === "maybeSingle") {
      if (rows.length > 1) return { data: null, error: pgError("PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${rows.length} rows`), count: null, status: 406, statusText: "Not Acceptable" };
      return this.ok(rows[0] ?? null);
    }
    return this.ok(rows);
  }

  private ok(data: unknown): QueryResult<unknown> {
    return { data, error: null, count: null, status: 200, statusText: "OK" };
  }

  private attachJoins(rows: Row[]): Array<{ raw: Row; embedded: Row }> {
    const projection = this.projection;
    if (!projection) return rows.map((raw) => ({ raw, embedded: {} }));
    const relationships = RELATIONSHIPS[this.relation as TableName] ?? {};
    const out: Array<{ raw: Row; embedded: Row }> = [];
    for (const raw of rows) {
      const embedded: Row = {};
      let drop = false;
      for (const join of projection.joins) {
        const rel = relationships[join.relation];
        if (!rel) throw new FakeSupabaseError(`select on ${this.relation}: embedded resource "${join.relation}" is not modelled`);
        const parent = this.db.read(rel.table).find((p) => p.id === raw[rel.localColumn]);
        if (!parent) {
          if (join.inner) {
            drop = true;
            break;
          }
          embedded[join.relation] = null;
          continue;
        }
        for (const column of join.columns) this.db.assertColumn(rel.table, column, `select ${join.relation}(...)`);
        embedded[join.relation] = join.all ? structuredClone(parent) : Object.fromEntries(join.columns.map((c) => [c, structuredClone(parent[c])]));
      }
      if (!drop) out.push({ raw, embedded });
    }
    return out;
  }

  private applyOrder<T extends { raw: Row }>(rows: T[]): T[] {
    if (this.ordering.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const { column, ascending, nullsFirst } of this.ordering) {
        const va = a.raw[column];
        const vb = b.raw[column];
        const na = isNullish(va);
        const nb = isNullish(vb);
        if (na && nb) continue;
        if (na) return nullsFirst ? -1 : 1;
        if (nb) return nullsFirst ? 1 : -1;
        const diff = compare(va, vb);
        if (diff !== 0) return ascending ? diff : -diff;
      }
      return 0;
    });
  }

  private project(raw: Row, embedded: Row): Row {
    const projection = this.projection;
    if (!projection) return structuredClone(raw);
    const out: Row = {};
    if (projection.all) Object.assign(out, structuredClone(raw));
    for (const column of projection.columns) {
      this.db.assertColumn(this.relation, column, "select()");
      out[column] = structuredClone(raw[column]);
    }
    Object.assign(out, embedded);
    return out;
  }

  // ----- guards ----------------------------------------------------------------

  private addFilter(column: string, op: string, filter: Filter): void {
    this.assertNotTerminal(op);
    this.db.assertColumn(this.relation, column, `${op}()`);
    this.filters.push(filter);
  }

  private assertTable(op: string): void {
    if (!(this.relation in TABLES)) throw new FakeSupabaseError(`${op} on view ${this.relation} is not allowed`);
  }

  private assertFresh(op: string): void {
    if (this.mode !== "select" || this.projection || this.filters.length > 0) throw new FakeSupabaseError(`${op}() must be the first call on ${this.relation}`);
  }

  private assertNotTerminal(op: string): void {
    if (this.shape) throw new FakeSupabaseError(`${op}() after single()/maybeSingle() on ${this.relation}`);
  }
}

// ---------------------------------------------------------------------------
// rpc()
// ---------------------------------------------------------------------------

class FakeRpcBuilder implements PromiseLike<QueryResult<unknown>> {
  private shape: "single" | "maybeSingle" | undefined = undefined;

  constructor(
    private readonly db: FakeDatabase,
    private readonly fn: string,
    private readonly args: Row,
  ) {}

  single(): this {
    this.shape = "single";
    return this;
  }

  maybeSingle(): this {
    this.shape = "maybeSingle";
    return this;
  }

  /** Accepted and ignored (the fake never hangs). */
  abortSignal(signal: AbortSignal): this {
    void signal;
    return this;
  }

  then<TResult1 = QueryResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return new Promise<QueryResult<unknown>>((resolve, reject) => {
      try {
        resolve(this.execute());
      } catch (err) {
        reject(err);
      }
    }).then(onfulfilled, onrejected);
  }

  private execute(): QueryResult<unknown> {
    const { data, error } = this.db.rpc(this.fn, this.args);
    if (error) return { data: null, error, count: null, status: error.code === "PGRST202" ? 404 : 400, statusText: "Error" };
    if (this.shape && Array.isArray(data)) {
      if (data.length > 1 || (this.shape === "single" && data.length === 0)) {
        return { data: null, error: pgError("PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${data.length} rows`), count: null, status: 406, statusText: "Not Acceptable" };
      }
      return { data: data[0] ?? null, error: null, count: null, status: 200, statusText: "OK" };
    }
    return { data, error: null, count: null, status: 200, statusText: "OK" };
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorageFileObject {
  name: string;
  id: string;
  updated_at: string;
  created_at: string;
  last_accessed_at: string;
  metadata: { size: number; mimetype: string };
}

export const FAKE_STORAGE_ORIGIN = "https://fake.supabase.local";

function toBytes(body: unknown, context: string): Uint8Array {
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  throw new FakeSupabaseError(`${context}: only Uint8Array / ArrayBuffer bodies are modelled`);
}

export class FakeStorage {
  readonly buckets = new Map<string, Map<string, StoredObject>>();
  private signedCounter = 0;

  constructor(readonly now: () => Date) {}

  /** Test helper: simulate a client PUT to a signed upload URL (or seed a ready object). */
  put(bucket: string, path: string, bytes: Uint8Array, contentType = "application/octet-stream"): StoredObject {
    const nowIso = this.now().toISOString();
    const object: StoredObject = { bytes: new Uint8Array(bytes), contentType, createdAt: nowIso, updatedAt: nowIso };
    this.bucket(bucket).set(path, object);
    return object;
  }

  get(bucket: string, path: string): StoredObject | undefined {
    return this.buckets.get(bucket)?.get(path);
  }

  has(bucket: string, path: string): boolean {
    return this.get(bucket, path) !== undefined;
  }

  paths(bucket: string): string[] {
    return [...this.bucket(bucket).keys()];
  }

  from(bucket: string) {
    const objects = this.bucket(bucket);
    const api = {
      upload: async (path: string, body: unknown, options: { contentType?: string; upsert?: boolean } = {}) => {
        if (objects.has(path) && !options.upsert) return { data: null, error: { message: "The resource already exists", statusCode: "409", error: "Duplicate" } };
        const existing = objects.get(path);
        const nowIso = this.now().toISOString();
        objects.set(path, { bytes: toBytes(body, `storage.upload(${path})`), contentType: options.contentType ?? "text/plain;charset=UTF-8", createdAt: existing?.createdAt ?? nowIso, updatedAt: nowIso });
        return { data: { id: randomUUID(), path, fullPath: `${bucket}/${path}` }, error: null };
      },
      createSignedUrl: async (path: string, expiresIn: number) => {
        if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new FakeSupabaseError(`createSignedUrl(${path}): expiresIn must be a positive number of seconds`);
        if (!objects.has(path)) return { data: null, error: { message: "Object not found", statusCode: "404", error: "not_found" } };
        const token = `sig-${++this.signedCounter}`;
        return { data: { signedUrl: `${FAKE_STORAGE_ORIGIN}/storage/v1/object/sign/${bucket}/${path}?token=${token}&expires_in=${expiresIn}` }, error: null };
      },
      createSignedUploadUrl: async (path: string) => {
        const token = `upload-${++this.signedCounter}`;
        return { data: { signedUrl: `${FAKE_STORAGE_ORIGIN}/storage/v1/object/upload/sign/${bucket}/${path}?token=${token}`, token, path }, error: null };
      },
      list: async (folder = "", options: { search?: string; limit?: number; offset?: number } = {}) => {
        const prefix = folder === "" ? "" : `${folder.replace(/\/+$/, "")}/`;
        const search = options.search?.toLowerCase();
        const files: StorageFileObject[] = [];
        for (const [path, object] of objects) {
          if (!path.startsWith(prefix)) continue;
          const name = path.slice(prefix.length);
          if (name.includes("/")) continue; // only direct children, like the real API
          if (search && !name.toLowerCase().includes(search)) continue;
          files.push({ name, id: randomUUID(), updated_at: object.updatedAt, created_at: object.createdAt, last_accessed_at: object.updatedAt, metadata: { size: object.bytes.byteLength, mimetype: object.contentType } });
        }
        files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        return { data: files.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 100)), error: null };
      },
    };
    return strict(api, `storage.from("${bucket}")`);
  }

  private bucket(name: string): Map<string, StoredObject> {
    let objects = this.buckets.get(name);
    if (!objects) {
      objects = new Map();
      this.buckets.set(name, objects);
    }
    return objects;
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface FakeSupabase {
  /** Pass this to `StudioService`; it is a `SupabaseClient` only for the subset described above. */
  client: SupabaseClient<Database>;
  db: FakeDatabase;
  storage: FakeStorage;
}

export function createFakeSupabase(options: { now?: () => Date } = {}): FakeSupabase {
  const now = options.now ?? (() => new Date());
  const db = new FakeDatabase(now);
  const storage = new FakeStorage(now);
  const toUser = (u: FakeAuthUser) => ({ id: u.id, email: u.email, created_at: u.created_at, email_confirmed_at: u.email_confirmed_at, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} });
  const admin = strict(
    {
      getUserById: async (id: string) => {
        const user = db.users.find((u) => u.id === id);
        return user ? { data: { user: toUser(user) }, error: null } : { data: { user: null }, error: { message: "User not found", status: 404, code: "user_not_found" } };
      },
      listUsers: async (params: { page?: number; perPage?: number } = {}) => {
        const perPage = params.perPage ?? 50;
        const page = Math.max(params.page ?? 1, 1);
        const users = db.users.slice((page - 1) * perPage, page * perPage).map(toUser);
        return { data: { users, aud: "authenticated", nextPage: db.users.length > page * perPage ? page + 1 : null, lastPage: Math.max(Math.ceil(db.users.length / perPage), 1), total: db.users.length }, error: null };
      },
      createUser: async (attributes: { email?: string; password?: string; email_confirm?: boolean }) => {
        if (!attributes.email) return { data: { user: null }, error: { message: "email is required", status: 400, code: "validation_failed" } };
        if (!attributes.password || attributes.password.length < 6) return { data: { user: null }, error: { message: "Password should be at least 6 characters.", status: 422, code: "weak_password" } };
        const { user, error } = db.createAuthUser({ email: attributes.email, emailConfirmed: attributes.email_confirm });
        return user ? { data: { user: toUser(user) }, error: null } : { data: { user: null }, error };
      },
    },
    "auth.admin",
  );
  const client = strict(
    {
      from(relation: string) {
        db.spec(relation as RelationName);
        return strict(new FakeQueryBuilder(db, relation as RelationName), `from("${relation}")`);
      },
      rpc(fn: string, args: Row = {}) {
        return strict(new FakeRpcBuilder(db, fn, args), `rpc("${fn}")`);
      },
      auth: strict({ admin }, "auth"),
      storage: strict({ from: (bucket: string) => storage.from(bucket) }, "storage"),
    },
    "client",
  );
  return { client: client as unknown as SupabaseClient<Database>, db, storage };
}
