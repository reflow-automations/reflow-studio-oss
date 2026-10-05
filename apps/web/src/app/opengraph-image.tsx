import { OG_ALT, OG_SIZE, brandCardImage } from "@/components/brand/og-card";

// Default Open Graph card for every route; share pages define their own.
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return brandCardImage();
}
