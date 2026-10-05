/**
 * Model catalog types.
 *
 * The shape deliberately mirrors what Higgsfield's `models_explore` tool
 * returns (id, name, provider_name, output_type, parameters[], medias[].roles,
 * aspect_ratios, durations, tags) so that the web UI, the REST API and the MCP
 * tools can expose the same self-describing catalog. On top of that, every
 * model carries one or more *provider bindings*: declarative descriptions of
 * how to call the model at fal.ai, Kie.ai, the Higgsfield API (or the offline
 * mock) and how to read the result back.
 */

export type OutputType = "image" | "video" | "audio" | "3d";

/**
 * Every provider id the core knows. This is the single source of truth: the
 * `ProviderId` type, zod enums, webhook routes and preference lists should all
 * be derived from it. Adding a provider = one adapter under `providers/<id>/`,
 * one entry here and in `PROVIDER_INFO` (providers/info.ts), plus the DB enum
 * migration.
 */
export const PROVIDER_IDS = ["fal", "kie", "higgsfield", "mock"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Providers that bill real money (everything except the offline mock). */
export const PAID_PROVIDER_IDS = ["fal", "kie", "higgsfield"] as const satisfies readonly ProviderId[];

export type PaidProviderId = (typeof PAID_PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

export function isPaidProviderId(value: unknown): value is PaidProviderId {
  return typeof value === "string" && (PAID_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Normalised reference-media roles (superset of Higgsfield's roles). */
export type MediaRole =
  | "image" // single reference image (identity / subject / source for utilities)
  | "image_references" // multiple reference images
  | "start_image"
  | "end_image"
  | "mask"
  | "video" // single source/driving video
  | "video_references"
  | "audio"
  | "audio_references";

/** Kinds a stored media asset can have (mirrors the `media_kind` DB enum). */
export type MediaKind = "image" | "video" | "audio" | "model" | "file";

export type Capability =
  | "text-to-image"
  | "image-to-image"
  | "image-edit"
  | "inpaint"
  | "outpaint"
  | "upscale-image"
  | "background-removal"
  | "text-to-video"
  | "image-to-video"
  | "first-last-frame-to-video"
  | "reference-to-video"
  | "video-to-video"
  | "video-edit"
  | "video-extension"
  | "motion-control"
  | "lipsync"
  | "upscale-video"
  | "reframe-video"
  | "video-background-removal"
  | "text-to-speech"
  | "voice-clone"
  | "text-to-music"
  | "text-to-sfx"
  | "image-to-3d"
  | "text-to-3d";

export type ParameterType = "string" | "number" | "integer" | "boolean" | "string_array" | "object";

export interface ModelParameter {
  name: string;
  type: ParameterType;
  required: boolean;
  description: string;
  default?: unknown;
  options?: ReadonlyArray<string | number>;
  min?: number;
  max?: number;
  /** Cost multiplier hint for the UI (e.g. "4k" doubles the price). */
  affects_cost?: boolean;
}

export interface MediaSlot {
  role: MediaRole;
  kind: MediaKind;
  description: string;
  required?: boolean;
  /** Maximum number of media items for this role (default 1 for singular roles). */
  max?: number;
  /** Another role that must be present when this one is (e.g. end_image requires start_image). */
  requires?: MediaRole;
}

export type PricingUnit =
  | "image" // per output image
  | "megapixel" // per output megapixel (input megapixels may be added by the provider)
  | "second" // per second of output video/audio
  | "generation" // flat per call
  | "thousand_chars" // per 1,000 input characters (TTS)
  | "minute"; // per minute of output audio/video

export interface PriceModifier {
  /**
   * Equality conditions that must all hold for this modifier to apply. Keys are
   * parameter names or one of the request fields `duration`, `aspect_ratio`
   * and `count` (e.g. a 10 s clip billed at a different per-second rate).
   */
  when: Record<string, string | number | boolean>;
  usd: number;
}

export interface Pricing {
  unit: PricingUnit;
  /** Base price in USD per unit (for tiered megapixel pricing: each unit after the first). */
  usd: number;
  /** Tiered pricing: price of the first unit per output when it differs ("first MP $0.03, then $0.015"). */
  first_unit_usd?: number;
  /**
   * Multiply the quantity by a numeric parameter raised to `exponent` (default 1).
   * Upscalers bill output megapixels: `{ name: "upscale_factor", exponent: 2 }`.
   */
  scale_param?: { name: string; exponent?: number };
  /**
   * The billed quantity follows the input media (driving video, source clip),
   * so the request duration is only a hint. Estimates are marked unverified.
   */
  input_dependent?: boolean;
  /** Overrides by parameter values (first match wins, evaluated in order). */
  modifiers?: PriceModifier[];
  /** Human-readable caveats (e.g. "audio doubles the price"). */
  notes?: string;
  /** Where the price came from and when it was last checked (ISO date). */
  source?: string;
  verified_at?: string;
  /** False when the price is reconstructed from secondary sources. */
  verified?: boolean;
}

/**
 * Declarative description of how a normalised request becomes a provider
 * request body. Kept as data so the catalog can be audited against provider
 * OpenAPI schemas without running code.
 */
export interface InputMappingSpec {
  /** Field for the text prompt (dot path). `null` = model has no prompt. Default "prompt". */
  prompt?: string | null;
  negative_prompt?: string | null;
  /**
   * Aspect-ratio handling. Either write the ratio string into a field
   * (optionally translating values), or translate the ratio into a provider
   * size enum/dimension object, or ignore it (`null`).
   */
  aspect_ratio?:
    | { field: string; values?: Record<string, string> }
    | {
        size_field: string;
        sizes: Record<string, string | { width: number; height: number }>;
        /** Ratio actually rendered when a size preset only approximates the request (e.g. 3:2 -> "4:3"). */
        rendered?: Record<string, string>;
      }
    | null;
  /**
   * Duration handling: field name plus optional formatting (e.g. Veo wants "8s",
   * Kling wants "5") and an optional clamp for endpoints whose range is narrower
   * than the model's (e.g. Wan reference-to-video caps at 10 s).
   */
  duration?: { field: string; format?: "number" | "string" | "seconds_suffix"; min?: number; max?: number } | null;
  /** Number-of-outputs field (e.g. num_images). `null` = one output per job. */
  count?: { field: string; max?: number } | null;
  /**
   * Media roles -> provider fields. A trailing "[]" means an array field; the
   * first item is used for singular fields. Missing roles are ignored.
   */
  roles?: Partial<Record<MediaRole, string>>;
  /**
   * Parameter renames and value translations. Keys are our parameter names;
   * a string value is the provider field name, an object allows value maps.
   * Parameters not listed here are passed through under their own name unless
   * `strictParams` is true.
   */
  params?: Record<string, string | { field: string; values?: Record<string, unknown>; omit?: boolean }>;
  /** Only send parameters that are listed in `params`. */
  strictParams?: boolean;
  /** Constant fields always included in the provider body. */
  constants?: Record<string, unknown>;
  /**
   * Per-input-mode tweaks, resolved from the media roles present in the request
   * exactly like `ProviderBinding.endpointByMode` (`first_last` falls back to
   * `image`). Top-level keys replace the base value (`aspect_ratio: null` drops
   * the ratio for that mode), `constants` and `params` are merged over the base.
   * Typical uses: "send aspect_ratio 'adaptive' when a start frame is present",
   * "text-to-video calls the ratio field `ratio`", "duration is a string on the
   * image-to-video slug only".
   */
  byMode?: Partial<Record<EndpointMode, InputMappingOverride>>;
}

/** The subset of `InputMappingSpec` that a `byMode` entry may override. */
export type InputMappingOverride = Pick<InputMappingSpec, "prompt" | "negative_prompt" | "aspect_ratio" | "duration" | "count" | "constants" | "params">;

export type OutputKind = "image" | "video" | "audio" | "model" | "file";

export interface OutputMappingSpec {
  /** Paths (see util/path) that resolve to output URLs or objects containing a `url`. */
  outputs: Array<{
    path: string;
    kind: OutputKind;
    /** Path *relative to the matched item* for the URL when the item is an object. Default "url". */
    url_path?: string;
    content_type_path?: string;
    width_path?: string;
    height_path?: string;
    /** Path relative to the item for the output duration in seconds. Default "duration". */
    duration_path?: string;
  }>;
  seed_path?: string;
  /** Optional path to a provider-reported cost (USD for fal usage, credits for Kie). */
  cost_path?: string;
}

/** Kie.ai exposes several endpoint families with different envelopes. */
export type KieFamily = "jobs" | "veo";

/**
 * Input mode of a request, derived from the media roles that are present
 * (see `resolveEndpointMode` in mapping.ts):
 *   - "first_last": start_image AND end_image
 *   - "image":      start_image only
 *   - "reference":  any other media (image, image_references, video, video_references, audio, audio_references, mask)
 *   - "text":       no media at all
 */
export type EndpointMode = "text" | "image" | "first_last" | "reference";

export interface ProviderBinding {
  provider: ProviderId;
  /** Only route request modes whose provider endpoint and mapping are wired. */
  supportedModes?: EndpointMode[];
  /** Values this provider can accept for parameters when the shared model supports more (hard filter). */
  supportedParamValues?: Record<string, ReadonlyArray<string | number | boolean>>;
  /**
   * Values this binding always renders with, whatever the request asks for
   * (e.g. an endpoint fixed at the pro / 1080p tier). The router ranks bindings
   * that honour the requested value first; a pinned binding is still used when
   * nothing else can serve the request, and then reports an adjustment and
   * prices the pinned value.
   */
  pinnedParams?: Record<string, string | number | boolean>;
  /**
   * Media roles the model declares that this binding drops on purpose. Without
   * an entry here the router never sends a request whose media this binding
   * cannot map (so reference media are never silently lost).
   */
  ignoredRoles?: MediaRole[];
  /**
   * Clip length the endpoint always renders when it has no duration field
   * (`input.duration: null`), e.g. Veo on Kie is fixed at 8 s. Reported as an
   * adjustment and used for per-second estimates.
   */
  fixedDuration?: number;
  /**
   * Only route here when no other binding can serve the request (or when its
   * provider is requested explicitly). Used by the synthesized mock bindings so
   * an instance with real keys never falls back to placeholder media.
   */
  lastResort?: boolean;
  /** fal endpoint id (e.g. "fal-ai/flux-2-pro") or Kie model slug (e.g. "kling-3.0/video"). */
  endpoint: string;
  /**
   * Optional per-mode endpoint overrides for providers that expose one endpoint per
   * input mode: fal's `.../text-to-video`, `.../image-to-video`,
   * `.../first-last-frame-to-video`, `.../reference-to-video` families and the `/edit`
   * variants of image models; Kie's `*-text-to-image` vs `*-image-to-image` slugs.
   *
   * The app resolves the mode from the media roles present in the request with
   * `resolveEndpoint(binding, medias)` (mapping.ts) and falls back along
   * `first_last` -> `image` -> `endpoint`, `reference` -> `endpoint`, `text` -> `endpoint`.
   * `endpoint` therefore stays the default (and the endpoint shown in `PublicModel`).
   * The `input` mapping is shared by every mode: only the roles that are present are
   * written to the body, so one roles map serves all endpoint variants of a family.
   */
  endpointByMode?: Partial<Record<EndpointMode, string>>;
  /** Kie only: which API family the endpoint belongs to. Default "jobs". */
  family?: KieFamily;
  input: InputMappingSpec;
  output: OutputMappingSpec;
  pricing?: Pricing;
  /** Lower number = preferred when several bindings are available. */
  priority?: number;
  /** Free-form notes (verification status, quirks). */
  notes?: string;
  /** False when the request schema has not been verified against the provider's OpenAPI. */
  verified?: boolean;
}

export type ModelStatus = "active" | "beta" | "deprecated";

export interface ModelDefinition {
  /** Stable catalog id, snake_case (e.g. "nano_banana_pro"). */
  id: string;
  name: string;
  /** Upstream vendor (Google, ByteDance, Kling, ...). */
  vendor: string;
  description: string;
  output_type: OutputType;
  capabilities: Capability[];
  parameters: ModelParameter[];
  medias: MediaSlot[];
  aspect_ratios: string[];
  /** Optional allowed resolution tiers for aspect ratios with provider-specific limits. */
  aspect_ratio_resolution_limits?: Record<string, readonly string[]>;
  /** Either an enumerated list of supported durations or an inclusive range. */
  durations?: number[];
  duration_range?: { min: number; max: number };
  default_duration?: number;
  /** Maximum `count` (variants) per request. Default 4. */
  max_count?: number;
  tags: string[];
  bindings: ProviderBinding[];
  status: ModelStatus;
  /** Ids in Higgsfield's catalog that this model replaces (for the migration matrix). */
  higgsfield_ids?: string[];
}

/** Binding summary exposed to API/MCP consumers. */
export interface PublicBinding {
  provider: ProviderId;
  endpoint: string;
  pricing?: Pricing;
  verified?: boolean;
  /** Input modes this binding serves (absent = all modes the model supports). */
  supportedModes?: EndpointMode[];
  /** Parameter values this binding accepts when the model allows more. */
  supportedParamValues?: Record<string, ReadonlyArray<string | number | boolean>>;
  /** Parameter values this binding always renders with. */
  pinnedParams?: Record<string, string | number | boolean>;
  /** Clip length this binding always renders, whatever duration is requested. */
  fixedDuration?: number;
}

/** A catalog entry as exposed to API/MCP consumers (bindings summarised). */
export interface PublicModel extends Omit<ModelDefinition, "bindings"> {
  providers: PublicBinding[];
}

export function toPublicModel(model: ModelDefinition): PublicModel {
  const { bindings, ...rest } = model;
  return {
    ...rest,
    providers: bindings.map((b) => ({
      provider: b.provider,
      endpoint: b.endpoint,
      pricing: b.pricing,
      verified: b.verified,
      ...(b.supportedModes ? { supportedModes: b.supportedModes } : {}),
      ...(b.supportedParamValues ? { supportedParamValues: b.supportedParamValues } : {}),
      ...(b.pinnedParams ? { pinnedParams: b.pinnedParams } : {}),
      ...(b.fixedDuration !== undefined ? { fixedDuration: b.fixedDuration } : {}),
    })),
  };
}
