import { Geist_Mono, Inter } from "next/font/google";

/**
 * App fonts, shared by the root layout and app/global-error.tsx (which renders
 * its own <html>). Inter with the optical-size axis so headings get display
 * proportions automatically; Geist Mono for ids, keys and code.
 */
export const fontSans = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  display: "swap",
});

export const fontMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

/** Class list for <html>: exposes both font variables to globals.css. */
export const fontVariables = `${fontSans.variable} ${fontMono.variable}`;
