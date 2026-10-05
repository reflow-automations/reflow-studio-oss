import type { MetadataRoute } from "next";
import { BRAND, STUDIO_DESCRIPTION, STUDIO_NAME, shortStudioName } from "@/components/brand/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: STUDIO_NAME,
    short_name: shortStudioName(STUDIO_NAME),
    description: STUDIO_DESCRIPTION,
    start_url: "/create/image",
    scope: "/",
    display: "standalone",
    background_color: BRAND.bg,
    theme_color: BRAND.bg,
    categories: ["photo", "graphics", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
