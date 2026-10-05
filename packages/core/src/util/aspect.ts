/** Aspect-ratio helpers shared by normalisation, cost estimation and mappings. */

export interface Dimensions {
  width: number;
  height: number;
}

const RATIO_RE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;

/** Parse "16:9" into a numeric ratio (width / height). Returns undefined for "auto" or invalid input. */
export function parseAspectRatio(ratio: string | undefined): number | undefined {
  if (!ratio) return undefined;
  const match = RATIO_RE.exec(ratio.trim());
  if (!match) return undefined;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return undefined;
  return w / h;
}

/** Pick the supported ratio closest to the requested one (by log-ratio distance). */
export function nearestAspectRatio(requested: string, supported: readonly string[]): string | undefined {
  const target = parseAspectRatio(requested);
  if (target === undefined) return undefined;
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of supported) {
    const value = parseAspectRatio(candidate);
    if (value === undefined) continue;
    const distance = Math.abs(Math.log(value) - Math.log(target));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * Compute pixel dimensions for an aspect ratio at a resolution tier.
 * Tier is interpreted as the length of the longer side (1K = 1024, 2K = 2048,
 * 4K = 4096); dimensions are rounded to multiples of 16 as most diffusion
 * models require.
 */
export function dimensionsFor(ratio: string, tier: "1k" | "2k" | "4k" | number = "1k"): Dimensions {
  const longSide = typeof tier === "number" ? tier : { "1k": 1024, "2k": 2048, "4k": 4096 }[tier];
  const value = parseAspectRatio(ratio) ?? 1;
  const round16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  if (value >= 1) return { width: round16(longSide), height: round16(longSide / value) };
  return { width: round16(longSide * value), height: round16(longSide) };
}

/** Megapixels for a set of dimensions, rounded up to 3 decimals. */
export function megapixels(dimensions: Dimensions): number {
  return Math.ceil(((dimensions.width * dimensions.height) / 1_000_000) * 1000) / 1000;
}
