import "server-only";
import { z } from "zod";
import { LEGACY_SECRET_MIN_LENGTH, looksLikePlaceholder, REFLOW_SECRET_MIN_LENGTH, resolveSecrets, type ResolvedSecrets } from "@/lib/secrets";

/**
 * Server-side environment. Parsed lazily so `next build` does not require
 * every secret; missing values surface as clear errors at first use.
 *
 * - Empty values count as unset (`.env` lines like `R2_PUBLIC_URL=` load as "").
 * - The Vercel Supabase integration names (`SUPABASE_URL`,
 *   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`,
 *   `SUPABASE_SECRET_KEY`) are accepted as fallbacks; the explicit names win.
 * - One `REFLOW_SECRET` replaces the three older secrets (lib/secrets.ts); the
 *   resolved `WEBHOOK_SECRET`, `RECONCILE_SECRET` and `KEY_ENCRYPTION_SECRET`
 *   below are the effective values whichever way they were configured.
 * - Values still holding a `.env.example` placeholder are rejected by name.
 */

const secret = (name: string, min: number) =>
  z
    .string()
    .min(min, `${name} must be at least ${min} characters`)
    .refine((v) => !looksLikePlaceholder(v), `${name} still holds a placeholder; generate a random value (see .env.example)`);

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10).refine((v) => !looksLikePlaceholder(v), "still holds a placeholder"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10).refine((v) => !looksLikePlaceholder(v), "still holds a placeholder"),
  /** Public base URL of this deployment, used to build webhook URLs (e.g. https://studio.your-domain.com). */
  APP_BASE_URL: z.string().url().optional(),
  /** One random secret (>= 32 chars) from which the webhook, reconcile and key-encryption secrets are derived. */
  REFLOW_SECRET: secret("REFLOW_SECRET", REFLOW_SECRET_MIN_LENGTH).optional(),
  /** Legacy: secret for webhook URL tokens (?t=...). Wins over the REFLOW_SECRET derivation. */
  WEBHOOK_SECRET: secret("WEBHOOK_SECRET", LEGACY_SECRET_MIN_LENGTH).optional(),
  /** Legacy: bearer secret for /api/internal/reconcile. Wins over the REFLOW_SECRET derivation. */
  RECONCILE_SECRET: secret("RECONCILE_SECRET", LEGACY_SECRET_MIN_LENGTH).optional(),
  FAL_KEY: z.string().optional(),
  KIE_API_KEY: z.string().optional(),
  HIGGSFIELD_API_CREDENTIAL: z.string().optional(),
  KIE_WEBHOOK_SECRET: z.string().optional(),
  /** Enable the in-memory mock provider (local development without provider keys). */
  ENABLE_MOCK_PROVIDER: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  /** Routing strategy: preferred | cheapest | quality (default preferred). */
  PROVIDER_STRATEGY: z.enum(["preferred", "cheapest", "quality"]).optional(),
  /** Comma-separated provider preference order, e.g. "kie,fal". */
  PROVIDER_PREFERENCE: z.string().optional(),
  /** Hard monthly spend cap in USD (0 = unlimited). */
  MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().optional(),
  /** Legacy: encrypts provider keys stored in the database. 32 bytes of base64 is used as-is; anything else (>= 32 chars) is HKDF-derived. */
  KEY_ENCRYPTION_SECRET: secret("KEY_ENCRYPTION_SECRET", 32).optional(),
  /** Comma-separated e-mail allowlist. When set, only these accounts may use the app (sessions and API keys). */
  OWNER_EMAILS: z.string().optional(),
  /** Show the "Create account" tab on the login page even when OWNER_EMAILS is set. */
  ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  /** Cloudflare R2 (S3 API). All four required to enable R2; otherwise Supabase Storage is used. */
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  /** Public base URL of the bucket (custom domain). Optional: without it presigned URLs are issued. */
  R2_PUBLIC_URL: z.string().url().optional(),
});

type RawEnv = z.infer<typeof schema>;

export type Env = Omit<RawEnv, "WEBHOOK_SECRET" | "RECONCILE_SECRET" | "KEY_ENCRYPTION_SECRET"> & {
  /** Effective webhook HMAC key (explicit WEBHOOK_SECRET or derived from REFLOW_SECRET). */
  WEBHOOK_SECRET: string;
  /** Effective reconcile bearer secret (RECONCILE_SECRET, derived from REFLOW_SECRET, or WEBHOOK_SECRET). */
  RECONCILE_SECRET: string;
  /** Effective provider-key encryption secret, or undefined when neither it nor REFLOW_SECRET is set. */
  KEY_ENCRYPTION_SECRET: string | undefined;
  /** Where each secret came from (never the values). */
  secretSources: ResolvedSecrets["sources"];
};

export interface EnvIssue {
  /** Variable name; never the value. */
  variable: string;
  message: string;
}

export type EnvSource = Record<string, string | undefined>;

/** Copy of `source` with empty / whitespace-only values removed. */
export function withoutEmpty(source: EnvSource): EnvSource {
  return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== ""));
}

/** Fill the canonical Supabase names from the Vercel integration names when the explicit ones are absent. */
export function withSupabaseFallbacks(source: EnvSource): EnvSource {
  return {
    ...source,
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL ?? source.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? source.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY ?? source.SUPABASE_SECRET_KEY,
  };
}

/** `example.com`-style hosts and addresses from the docs; only rejected in production. */
function isExampleValue(value: string): boolean {
  return /(^|[.@/])example\.(com|org|net)\b/i.test(value) || /[<>]/.test(value);
}

export type ParsedEnv = { ok: true; env: Env } | { ok: false; issues: EnvIssue[] };

/** Validate an environment without throwing (the /setup checklist uses the issues). */
export function parseEnv(source: EnvSource = process.env): ParsedEnv {
  const cleaned = withSupabaseFallbacks(withoutEmpty(source));
  const issues: EnvIssue[] = [];
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) issues.push({ variable: issue.path.join(".") || "(root)", message: issue.message });
  }
  if (!cleaned.REFLOW_SECRET && !cleaned.WEBHOOK_SECRET) {
    issues.push({ variable: "REFLOW_SECRET", message: `REFLOW_SECRET is not set (any random string of at least ${REFLOW_SECRET_MIN_LENGTH} characters)` });
  }
  if (source.NODE_ENV === "production") {
    for (const name of ["APP_BASE_URL", "OWNER_EMAILS"] as const) {
      const value = cleaned[name];
      if (value && isExampleValue(value)) issues.push({ variable: name, message: `${name} still holds the .env.example placeholder` });
    }
  }
  if (!parsed.success || issues.length > 0) return { ok: false, issues };

  const secrets = resolveSecrets(parsed.data);
  return {
    ok: true,
    env: {
      ...parsed.data,
      // Both checked above: an explicit WEBHOOK_SECRET or a REFLOW_SECRET to derive from.
      WEBHOOK_SECRET: secrets.webhookSecret!,
      RECONCILE_SECRET: secrets.reconcileSecret!,
      KEY_ENCRYPTION_SECRET: secrets.keyEncryptionSecret,
      secretSources: secrets.sources,
    },
  };
}

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = parseEnv(process.env);
  if (!parsed.ok) {
    const issues = parsed.issues.map((i) => `${i.variable}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.env;
  return cached;
}

/** Forget the parsed environment (tests that change process.env). */
export function resetEnvCache(): void {
  cached = undefined;
}

/** Resolve the public base URL (APP_BASE_URL > VERCEL_PROJECT_PRODUCTION_URL > VERCEL_URL > localhost). */
export function appBaseUrl(source: EnvSource = process.env): string {
  const explicit = source.APP_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const prod = source.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod}`;
  const preview = source.VERCEL_URL?.trim();
  if (preview) return `https://${preview}`;
  return "http://localhost:3000";
}
