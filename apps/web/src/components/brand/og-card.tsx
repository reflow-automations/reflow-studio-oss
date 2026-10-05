import { ImageResponse } from "next/og";
import { LOGO_GEOMETRY } from "@/components/brand/logo";
import { BRAND, STUDIO_HEADLINE, STUDIO_NAME } from "@/components/brand/site";
import { loadGoogleFont } from "@/components/brand/og-fonts";

/**
 * Default social card (Open Graph and Twitter) for the whole app, rendered with
 * next/og at build time. Share pages override it with their own image.
 * Satori only supports flexbox and inline styles, so this file is all style
 * objects; every element with more than one child needs display: flex.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_ALT = `${STUDIO_NAME}: ${STUDIO_HEADLINE} Bring your own keys.`;

const SUBLINE = "Bring your own keys.";
const PROVIDERS = ["fal.ai", "Kie.ai", "Higgsfield"];
const RENDER_LABEL = "Generating";

interface Frame {
  ratio: string;
  rendering?: boolean;
  tint: string;
}

const FRAME_WIDTH = 176;

/** Three columns of output frames in common aspect ratios; one is mid-render. */
const COLUMNS: Frame[][] = [
  [
    { ratio: "1:1", tint: "linear-gradient(160deg, #1A2335 0%, #121826 100%)" },
    { ratio: "9:16", tint: "linear-gradient(200deg, #1C2740 0%, #141B2B 60%, #201E2C 100%)" },
    { ratio: "16:9", tint: "linear-gradient(180deg, #172033 0%, #111723 100%)" },
  ],
  [
    { ratio: "16:9", tint: "linear-gradient(180deg, #172033 0%, #111723 100%)" },
    { ratio: "4:5", rendering: true, tint: "linear-gradient(180deg, rgba(247,149,29,0.26) 0%, rgba(247,149,29,0.05) 100%)" },
    { ratio: "1:1", tint: "linear-gradient(140deg, #1B2233 0%, #10151F 100%)" },
  ],
  [
    { ratio: "3:4", tint: "linear-gradient(170deg, #1A2132 0%, #131A28 100%)" },
    { ratio: "16:9", tint: "linear-gradient(200deg, #1D2538 0%, #121825 100%)" },
    { ratio: "4:5", tint: "linear-gradient(160deg, #182033 0%, #0F141F 100%)" },
  ],
];

/** Column offsets so the wall reads as a staggered gallery, bleeding off the card edges. */
const COLUMN_OFFSETS = [-40, -150, -70];

function frameHeight(ratio: string): number {
  const [w, h] = ratio.split(":").map(Number);
  return Math.round((FRAME_WIDTH * h) / w);
}

/** Every character the card renders, used to subset the web font request. */
export function ogCardText(): string {
  const text = [STUDIO_NAME, STUDIO_HEADLINE, SUBLINE, RENDER_LABEL, ...PROVIDERS, ...COLUMNS.flat().map((f) => f.ratio)].join("");
  return Array.from(new Set(text)).join("");
}

async function cardFonts(): Promise<Array<{ name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" }>> {
  const text = ogCardText();
  const [regular, semibold] = await Promise.all([loadGoogleFont("Inter", 400, text), loadGoogleFont("Inter", 600, text)]);
  const fonts: Array<{ name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" }> = [];
  if (regular) fonts.push({ name: "Inter", data: regular, weight: 400, style: "normal" });
  if (semibold) fonts.push({ name: "Inter", data: semibold, weight: 600, style: "normal" });
  return fonts;
}

function Mark({ size, rounded = true }: { size: number; rounded?: boolean }) {
  return (
    <svg width={size} height={size} viewBox={LOGO_GEOMETRY.viewBox}>
      <rect width="32" height="32" rx={rounded ? LOGO_GEOMETRY.tileRadius : 0} fill={BRAND.accent} />
      <path d={LOGO_GEOMETRY.body} fill={BRAND.ink} fillRule="evenodd" />
      <path d={LOGO_GEOMETRY.leg} fill="none" stroke={BRAND.ink} strokeWidth={LOGO_GEOMETRY.legWidth} strokeLinecap="round" />
    </svg>
  );
}

function FrameTile({ frame }: { frame: Frame }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        width: FRAME_WIDTH,
        height: frameHeight(frame.ratio),
        borderRadius: 18,
        border: `2px solid ${frame.rendering ? BRAND.accent : BRAND.border}`,
        backgroundImage: frame.tint,
        padding: 16,
        position: "relative",
      }}
    >
      {frame.rendering ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", fontSize: 20, color: BRAND.fg, fontWeight: 600 }}>{RENDER_LABEL}</div>
          <div style={{ display: "flex", width: "100%", height: 6, borderRadius: 3, backgroundColor: "rgba(244,244,245,0.14)" }}>
            <div style={{ display: "flex", width: "62%", height: 6, borderRadius: 3, backgroundColor: BRAND.accent }} />
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", fontSize: 18, color: BRAND.subtle }}>{frame.ratio}</div>
      )}
    </div>
  );
}

/** Square app icon: the mark full-bleed (iOS applies its own mask). */
export function appIconImage(size: number): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", backgroundColor: BRAND.accent }}>
        <Mark size={size} rounded={false} />
      </div>
    ),
    { width: size, height: size },
  );
}

/** The 1200 x 630 brand card. */
export async function brandCardImage(): Promise<ImageResponse> {
  const fonts = await cardFonts();
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          backgroundColor: BRAND.bg,
          fontFamily: fonts.length > 0 ? "Inter" : undefined,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 690, display: "flex", gap: 20, paddingLeft: 24 }}>
          {COLUMNS.map((column, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: COLUMN_OFFSETS[i] }}>
              {column.map((frame, j) => (
                <FrameTile key={j} frame={frame} />
              ))}
            </div>
          ))}
        </div>
        {/* Fade the wall into the text side so the headline keeps full contrast. */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 650, width: 150, display: "flex", backgroundImage: `linear-gradient(90deg, ${BRAND.bg} 0%, rgba(10,13,20,0) 100%)` }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 700, height: "100%", padding: "64px 0 64px 72px", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Mark size={56} />
            <div style={{ display: "flex", fontSize: 32, fontWeight: 600, color: BRAND.fg, letterSpacing: -0.5 }}>{STUDIO_NAME}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", fontSize: 64, lineHeight: 1.05, fontWeight: 600, color: BRAND.fg, letterSpacing: -2.2, maxWidth: 580 }}>{STUDIO_HEADLINE}</div>
            <div style={{ display: "flex", fontSize: 34, color: BRAND.muted, letterSpacing: -0.4 }}>{SUBLINE}</div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {PROVIDERS.map((provider) => (
              <div key={provider} style={{ display: "flex", alignItems: "center", height: 44, padding: "0 18px", borderRadius: 12, border: `2px solid ${BRAND.borderStrong}`, fontSize: 22, color: BRAND.fg2 }}>
                {provider}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
