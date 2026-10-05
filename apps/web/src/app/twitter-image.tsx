import { OG_ALT, OG_SIZE, brandCardImage } from "@/components/brand/og-card";

// Same card as opengraph-image; X/Twitter reads its own tags.
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function TwitterImage() {
  return brandCardImage();
}
