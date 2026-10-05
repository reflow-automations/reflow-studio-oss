export type StudioErrorCode =
  | "model_not_found"
  | "invalid_request"
  | "provider_unavailable"
  | "provider_error"
  | "provider_rate_limited"
  | "insufficient_credits"
  | "webhook_signature_invalid"
  | "not_found"
  | "unauthorized"
  | "media_unresolved";

/**
 * What a failed `submit()` tells the caller about the provider side:
 *  - "rejected": the provider definitely did not start a job (auth, credits,
 *    rate limit, validation, missing key, explicit rejection envelope). Another
 *    provider may be tried.
 *  - "unknown": the provider may have accepted (and will bill) the job, e.g. a
 *    transport timeout, a gateway 500/502/504 or a 2xx without a job id.
 *    Submitting the same request elsewhere risks paying twice.
 */
export type SubmissionOutcome = "unknown" | "rejected";

export interface StudioErrorOptions {
  status?: number;
  details?: unknown;
  retryable?: boolean;
  cause?: unknown;
  submissionOutcome?: SubmissionOutcome;
}

/** Error type shared by the core, the HTTP API and the MCP tools. */
export class StudioError extends Error {
  readonly code: StudioErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly retryable: boolean;
  /** Only set on errors raised by `ProviderAdapter.submit()`; see `SubmissionOutcome`. */
  readonly submissionOutcome: SubmissionOutcome | undefined;

  constructor(code: StudioErrorCode, message: string, options: StudioErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "StudioError";
    this.code = code;
    this.status = options.status ?? defaultStatus(code);
    this.submissionOutcome = options.submissionOutcome ?? outcomeFromDetails(options.details);
    // Older consumers read `details.submissionOutcome === "unknown"`; keep that shape for ambiguous errors.
    this.details = this.submissionOutcome === "unknown" ? withOutcome(options.details) : options.details;
    this.retryable = options.retryable ?? (this.submissionOutcome === "unknown" ? false : code === "provider_rate_limited" || code === "provider_unavailable");
  }

  toJSON(): { code: StudioErrorCode; message: string; details?: unknown; retryable: boolean; submission_outcome?: SubmissionOutcome } {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      ...(this.submissionOutcome ? { submission_outcome: this.submissionOutcome } : {}),
    };
  }
}

function defaultStatus(code: StudioErrorCode): number {
  switch (code) {
    case "model_not_found":
    case "not_found":
      return 404;
    case "invalid_request":
    case "media_unresolved":
      return 400;
    case "unauthorized":
    case "webhook_signature_invalid":
      return 401;
    case "insufficient_credits":
      return 402;
    case "provider_rate_limited":
      return 429;
    case "provider_unavailable":
      return 503;
    case "provider_error":
    default:
      return 502;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function outcomeFromDetails(details: unknown): SubmissionOutcome | undefined {
  const outcome = isPlainObject(details) ? details.submissionOutcome : undefined;
  return outcome === "unknown" || outcome === "rejected" ? outcome : undefined;
}

function withOutcome(details: unknown): Record<string, unknown> {
  if (isPlainObject(details) && details.submissionOutcome === "unknown") return details;
  if (details === undefined) return { submissionOutcome: "unknown" };
  return { submissionOutcome: "unknown", response: details };
}

export function isStudioError(error: unknown): error is StudioError {
  return error instanceof StudioError;
}

/**
 * Error for a submit whose outcome at the provider is unknown (the job may be
 * queued and billed). Never retried automatically and never a reason to try
 * another provider.
 */
export function ambiguousSubmit(code: StudioErrorCode, message: string, options: Omit<StudioErrorOptions, "submissionOutcome" | "retryable"> = {}): StudioError {
  return new StudioError(code, message, { ...options, retryable: false, submissionOutcome: "unknown" });
}

/** Error for a submit the provider definitely refused (no job exists at the provider). */
export function rejectedSubmit(code: StudioErrorCode, message: string, options: Omit<StudioErrorOptions, "submissionOutcome"> = {}): StudioError {
  return new StudioError(code, message, { ...options, submissionOutcome: "rejected" });
}

/**
 * Tag an error raised during `submit()` with a submission outcome unless it
 * already carries one. Non-StudioErrors (programming errors) are wrapped as an
 * ambiguous `provider_error` only when `outcome` is "unknown".
 */
export function withSubmissionOutcome(error: unknown, outcome: SubmissionOutcome): unknown {
  if (error instanceof StudioError) {
    if (error.submissionOutcome) return error;
    return new StudioError(error.code, error.message, { status: error.status, details: error.details, retryable: outcome === "unknown" ? false : error.retryable, cause: error.cause, submissionOutcome: outcome });
  }
  if (outcome === "unknown") return ambiguousSubmit("provider_error", error instanceof Error ? error.message : String(error), { cause: error });
  return error;
}

/**
 * HTTP statuses on a submit POST after which the job may still exist at the
 * provider: a 500 or a gateway 502/504 (or a Cloudflare 52x) can come back
 * after the request was already queued. 501, 503 and 505 mean the request
 * was not taken.
 */
export function isAmbiguousSubmitStatus(status: number): boolean {
  return status >= 500 && status !== 501 && status !== 503 && status !== 505;
}

/** True when the provider may have accepted the job (see `SubmissionOutcome`). */
export function isAmbiguousSubmission(error: unknown): boolean {
  return error instanceof StudioError && error.submissionOutcome === "unknown";
}

const FALLBACK_SAFE_CODES: ReadonlySet<StudioErrorCode> = new Set(["unauthorized", "insufficient_credits", "provider_rate_limited"]);

/**
 * Whether a failed submit may be retried at the next provider candidate.
 * Fails closed: only errors that are known to happen before the provider
 * accepted anything qualify (auth, credits, rate limit, or an adapter that
 * explicitly reported `submissionOutcome: "rejected"`). Input errors
 * (`invalid_request`) would fail everywhere and ambiguous errors could bill
 * twice, so neither falls back.
 */
export function isSafeToFallBack(error: unknown): boolean {
  if (!(error instanceof StudioError)) return false;
  if (error.submissionOutcome === "unknown") return false;
  if (error.code === "invalid_request") return false;
  return FALLBACK_SAFE_CODES.has(error.code) || error.submissionOutcome === "rejected";
}
