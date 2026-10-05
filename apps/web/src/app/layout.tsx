import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/components/brand/fonts";
import { BRAND, STUDIO_DESCRIPTION, STUDIO_NAME, STUDIO_TAGLINE, siteBaseUrl } from "@/components/brand/site";
import "./globals.css";

export const metadata: Metadata = {
  // Absolute base for OG/Twitter image URLs: APP_BASE_URL, else the Vercel production URL.
  metadataBase: siteBaseUrl(),
  applicationName: STUDIO_NAME,
  title: { default: STUDIO_NAME, template: `%s | ${STUDIO_NAME}` },
  description: STUDIO_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: STUDIO_NAME,
    title: STUDIO_NAME,
    description: STUDIO_TAGLINE,
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: STUDIO_NAME, description: STUDIO_TAGLINE },
  // Private by default. Public pages (share links, gallery) opt in with their own `robots`.
  robots: { index: false, follow: false },
  appleWebApp: { title: STUDIO_NAME, statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: BRAND.bg,
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Lets the mobile tab bar pad itself with env(safe-area-inset-bottom).
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontVariables} h-full`}>
      <body className="flex min-h-dvh flex-col bg-bg font-sans text-fg antialiased">{children}</body>
    </html>
  );
}
