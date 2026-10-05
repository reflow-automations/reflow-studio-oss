import { appIconImage } from "@/components/brand/og-card";

// Home-screen icon for iOS (and Safari, which ignores SVG favicons).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return appIconImage(size.width);
}
