/**
 * Font loading for next/og images. Satori cannot read woff2, so this asks the
 * Google Fonts css2 API for a subset of exactly the characters on the card
 * and picks a TTF/OTF/WOFF source from the returned CSS.
 */

/** Extracts the first TTF/OTF/WOFF source from a Google Fonts css2 response, or null when there is none. */
export function fontUrlFromCss(css: string): string | null {
  const match = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"](opentype|truetype|woff)['"]\)/);
  return match ? match[1].replace(/^['"]|['"]$/g, "") : null;
}

/** css2 API URL for one family and weight, subset to `text`. */
export function googleFontCssUrl(family: string, weight: number, text: string): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`;
}

/**
 * Fetches a Google font subset. Returns null on any failure (offline build,
 * blocked network, unexpected CSS), in which case next/og falls back to its
 * bundled font: the image still renders, just not in the brand font.
 */
export async function loadGoogleFont(family: string, weight: number, text: string, fetcher: typeof fetch = fetch): Promise<ArrayBuffer | null> {
  try {
    const cssResponse = await fetcher(googleFontCssUrl(family, weight, text), { signal: AbortSignal.timeout(4000) });
    if (!cssResponse.ok) return null;
    const url = fontUrlFromCss(await cssResponse.text());
    if (!url) return null;
    const fontResponse = await fetcher(url, { signal: AbortSignal.timeout(4000) });
    return fontResponse.ok ? await fontResponse.arrayBuffer() : null;
  } catch {
    return null;
  }
}
