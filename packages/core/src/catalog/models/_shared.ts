import type { MediaSlot, ModelParameter, OutputMappingSpec } from "../types";

/** Aspect-ratio sets shared by many models. */
export const AR_IMAGE_COMMON = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
export const AR_IMAGE_WIDE = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"] as const;
/** Ratios every provider in a binding pair accepts (GPT Image 2, Z-Image, Grok Image on Kie). */
export const AR_IMAGE_BASIC = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
export const AR_VIDEO_COMMON = ["16:9", "9:16", "1:1"] as const;
export const AR_VIDEO_WIDE = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;
export const AR_VIDEO_VEO = ["16:9", "9:16"] as const;
export const AR_VIDEO_WAN = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
/** Ratios both fal and Kie accept for xAI Grok Imagine (image 2.0 and video). */
export const AR_GROK = ["1:1", "16:9", "9:16", "3:2", "2:3"] as const;

/** fal `image_size` enum values for models that take a size preset instead of an aspect ratio. */
export const FAL_IMAGE_SIZE_BY_RATIO: Record<string, string> = {
  "1:1": "square_hd",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "3:2": "landscape_4_3",
  "2:3": "portrait_4_3",
  "21:9": "landscape_16_9",
  "4:5": "portrait_4_3",
  "5:4": "landscape_4_3",
};

/** Ratios the fal presets above only approximate, and the ratio they actually render. */
export const FAL_IMAGE_SIZE_RENDERED: Record<string, string> = {
  "3:2": "4:3",
  "2:3": "3:4",
  "21:9": "16:9",
  "4:5": "3:4",
  "5:4": "4:3",
};

/** `aspect_ratio` mapping for fal endpoints that take an `image_size` preset (snaps are reported as adjustments). */
export const FAL_IMAGE_SIZE = { size_field: "image_size", sizes: FAL_IMAGE_SIZE_BY_RATIO, rendered: FAL_IMAGE_SIZE_RENDERED };

/** Date the seed ids/prices were last reconciled with the research fact-checks. */
export const CHECKED_AT = "2026-09-05";

/**
 * Note for bindings whose request shape was matched field by field against a
 * production integration that calls these endpoints (Sep 2026). Only bindings
 * whose default body matches that shape carry `verified: true`; the catalog
 * test requires every verified binding to say what it was verified against
 * and when, in the form "verified against <what> (<YYYY-MM[-DD]>)".
 */
export const SHAPE_VERIFIED = "request shape verified against a production integration (2026-09)";
/** Price source suffix for values checked against the provider's price page. */
export const PRICES_CHECKED = "price page checked 2026-09-04";

/** Verification note in the form the catalog test expects, for bindings verified some other way (live probe, OpenAPI). */
export const verifiedNote = (against: string, date: string): string => `verified against ${against} (${date})`;

/* ---------- Output mappings shared by provider families ---------- */

/** fal image models: `{ images: [{ url, width, height, content_type }], seed }`. */
export const FAL_IMAGES_OUTPUT: OutputMappingSpec = { outputs: [{ path: "images[]", kind: "image" }], seed_path: "seed" };
/** fal image utilities (upscalers, background removal): `{ image: { url, ... } }`. */
export const FAL_IMAGE_OUTPUT: OutputMappingSpec = { outputs: [{ path: "image", kind: "image" }] };
/** fal video models: `{ video: { url, ... }, seed? }`. */
export const FAL_VIDEO_OUTPUT: OutputMappingSpec = { outputs: [{ path: "video", kind: "video" }], seed_path: "seed" };
/** Kie jobs family after `resultJson` is parsed: `{ resultUrls: [...] }` (Veo: `response.resultUrls`). */
export const KIE_IMAGE_OUTPUT: OutputMappingSpec = { outputs: [{ path: "resultUrls[]", kind: "image" }] };
export const KIE_VIDEO_OUTPUT: OutputMappingSpec = { outputs: [{ path: "resultUrls[]", kind: "video" }] };

/** `params` entry that drops one of our parameters for a provider without an equivalent field. */
export const omit = (field: string): { field: string; omit: true } => ({ field, omit: true });

/* ---------- Parameters ---------- */

export const resolutionParam = (options: readonly string[], def: string, description = "Output resolution tier."): ModelParameter => ({
  name: "resolution",
  type: "string",
  required: false,
  description,
  default: def,
  options,
  affects_cost: true,
});

export const qualityParam = (options: readonly string[], def: string, description = "Quality / output-size tier."): ModelParameter => ({
  name: "quality",
  type: "string",
  required: false,
  description,
  default: def,
  options,
  affects_cost: true,
});

export const modeParam = (options: readonly string[], def: string, description: string): ModelParameter => ({
  name: "mode",
  type: "string",
  required: false,
  description,
  default: def,
  options,
  affects_cost: true,
});

export const seedParam: ModelParameter = { name: "seed", type: "integer", required: false, description: "Random seed for reproducible results.", min: 0 };

export const outputFormatParam = (options: readonly string[] = ["png", "jpeg"], def = "png"): ModelParameter => ({
  name: "output_format",
  type: "string",
  required: false,
  description: "Output file format.",
  default: def,
  options,
});

/** No default on purpose: the provider default is on, and the field is only sent when a caller sets it. */
export const safetyParam: ModelParameter = {
  name: "enable_safety_checker",
  type: "boolean",
  required: false,
  description: "Run the provider's safety checker on outputs (provider default: on).",
};

export const generateAudioParam = (def = true): ModelParameter => ({
  name: "generate_audio",
  type: "boolean",
  required: false,
  description: "Generate a native audio track with the video (affects price on most models).",
  default: def,
  affects_cost: true,
});

export const multiPromptParam: ModelParameter = {
  name: "multi_prompt",
  type: "object",
  required: false,
  description: "Multi-shot storyboard: array of { prompt, duration } shots (Kling 3.0: up to 5 shots of 1-12 s, total <= 15 s). Passed through untranslated.",
};

export const elementsParam: ModelParameter = {
  name: "elements",
  type: "object",
  required: false,
  description:
    "Kling character/object elements referenced from the prompt. Provider-specific shape: fal `[{ frontal_image_url, reference_image_urls[] }]` addressed as @Element1..; Kie `[{ name, description, element_input_urls[] }]` addressed as @name. Passed through untranslated.",
};

export const shotTypeParam: ModelParameter = {
  name: "shot_type",
  type: "string",
  required: false,
  description: "fal Kling multi-shot control: `customize` (use multi_prompt) or `intelligent` (model splits the shots).",
  options: ["customize", "intelligent"],
};

export const cfgScaleParam: ModelParameter = { name: "cfg_scale", type: "number", required: false, description: "Prompt adherence (Kling, 0-1).", min: 0, max: 1 };

export const characterOrientationParam: ModelParameter = {
  name: "character_orientation",
  type: "string",
  required: false,
  description: "Motion control: keep the orientation of the driving `video` (driver <= 30 s) or of the `image` subject (driver <= 10 s).",
  default: "video",
  options: ["video", "image"],
};

export const promptOptimizerParam: ModelParameter = { name: "prompt_optimizer", type: "boolean", required: false, description: "Let the provider rewrite/expand the prompt.", default: true };

/** No default on purpose: only sent when a caller asks for the frame (provider default: off). */
export const returnLastFrameParam: ModelParameter = {
  name: "return_last_frame",
  type: "boolean",
  required: false,
  description: "Also return the last frame as an image so the clip can be chained/extended (provider default: off).",
};

export const upscaleFactorParam = (options: readonly number[], def: number): ModelParameter => ({
  name: "upscale_factor",
  type: "integer",
  required: false,
  description: "Upscale multiplier.",
  default: def,
  options,
  affects_cost: true,
});

/* ---------- Media slots ---------- */

export const imageRefsSlot = (max: number, description = "Reference images (identity, style, product)."): MediaSlot => ({
  role: "image_references",
  kind: "image",
  description,
  max,
});

export const videoRefsSlot = (max: number, description = "Reference video clips (motion, style, source footage to edit)."): MediaSlot => ({
  role: "video_references",
  kind: "video",
  description,
  max,
});

export const audioRefsSlot = (max: number, description = "Reference audio clips (voice, music, sound)."): MediaSlot => ({
  role: "audio_references",
  kind: "audio",
  description,
  max,
});

export const startImageSlot: MediaSlot = { role: "start_image", kind: "image", description: "First frame / source image for image-to-video." };
export const endImageSlot: MediaSlot = { role: "end_image", kind: "image", description: "Last frame for first-last-frame animation (needs a start_image).", requires: "start_image" };
export const sourceImageSlot: MediaSlot = { role: "image", kind: "image", description: "Source image.", required: true };
export const sourceVideoSlot: MediaSlot = { role: "video", kind: "video", description: "Source video.", required: true };
export const referenceImageSlot: MediaSlot = { role: "image", kind: "image", description: "Reference image of the character / subject to animate.", required: true };
export const drivingVideoSlot: MediaSlot = { role: "video", kind: "video", description: "Driving video whose motion is transferred (3-30 s).", required: true };
