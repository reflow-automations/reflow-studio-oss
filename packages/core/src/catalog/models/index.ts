import type { ModelDefinition } from "../types";
import { IMAGE_MODELS } from "./image";
import { UTILITY_MODELS } from "./utility";
import { VIDEO_MODELS } from "./video";

export { IMAGE_MODELS } from "./image";
export { UTILITY_MODELS } from "./utility";
export { VIDEO_MODELS } from "./video";

/** The seed catalog. Order = display order (images, videos, utilities). */
export const SEED_MODELS: ModelDefinition[] = [...IMAGE_MODELS, ...VIDEO_MODELS, ...UTILITY_MODELS];

/** Number of models in the seed catalog. */
export const SEED_MODEL_COUNT: number = SEED_MODELS.length;
