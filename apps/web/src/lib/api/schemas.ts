import { PROVIDER_IDS } from "@reflow/core";
import { z } from "zod";

export const mediaRoleSchema = z.enum(["image", "image_references", "start_image", "end_image", "mask", "video", "video_references", "audio", "audio_references"]);

export const mediaInputSchema = z.object({
  role: mediaRoleSchema.describe("Role of the media for this model (see models_explore → medias[].role)."),
  value: z.string().min(1).describe("Asset id (from media_upload/media_import_url), a previous generation id, or an https URL."),
});

export const generateRequestSchema = z.object({
  model: z.string().min(1).describe("Model id from the catalog (models_explore)."),
  prompt: z.string().max(20_000).optional(),
  negative_prompt: z.string().max(5_000).optional(),
  aspect_ratio: z.string().max(10).optional().describe('e.g. "16:9", "9:16", "1:1"'),
  duration: z.number().min(1).max(60).optional().describe("Video duration in seconds (clamped to the model's range)."),
  count: z.number().int().min(1).max(4).optional().describe("Number of variants (1-4)."),
  medias: z.array(mediaInputSchema).max(20).optional(),
  params: z.record(z.string(), z.unknown()).optional().describe("Model-specific parameters (see models_explore → parameters)."),
});

export const createGenerationBodySchema = generateRequestSchema.extend({
  provider: z.enum(PROVIDER_IDS).optional().describe("Force a provider; otherwise the router decides."),
  idempotency_key: z.string().max(200).optional(),
  folder_id: z.string().uuid().optional(),
  get_cost: z.boolean().optional().describe("If true, return the cost estimate without submitting a job."),
});

export const waitBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(12),
  timeout_seconds: z.number().int().min(0).max(25).optional(),
});

/** Body of POST /api/v1/generations/delete and /api/v1/media/delete. */
export const deleteBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export const importMediaSchema = z.object({
  url: z.string().url(),
  type: z.enum(["image", "video", "audio"]).optional(),
});

export const uploadTargetSchema = z.object({
  filename: z.string().min(1).max(200),
  content_type: z.string().min(3).max(100),
});

export const listGenerationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.string().optional(),
  state: z.enum(["pending", "queued", "running", "succeeded", "failed", "cancelled"]).optional(),
  type: z.enum(["image", "video", "audio", "3d"]).optional(),
  batch_id: z.string().uuid().optional(),
});

export type CreateGenerationBody = z.infer<typeof createGenerationBodySchema>;
