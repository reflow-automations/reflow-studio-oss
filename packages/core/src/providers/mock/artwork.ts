import { toDataUrl } from "../../util/data-url";

/**
 * Deterministic placeholder artwork for the offline mock provider: layered
 * gradients, a glowing orb, drifting particles and rolling hills, coloured
 * from a seed (the prompt), with only a tiny "demo" label. Pure string
 * building, so it runs anywhere the core runs and never touches the network.
 */

export interface MockArtworkOptions {
  /** Seed that picks the palette and the layout (same seed, same picture). */
  seed: number;
  width: number;
  height: number;
  /** Video placeholder: adds a play button and a slow pulse. */
  video?: boolean;
  /** Corner label (default "demo"; empty string hides it). */
  label?: string;
}

/** SVG markup for the placeholder. */
export function mockArtworkSvg(options: MockArtworkOptions): string {
  const w = Math.max(16, Math.round(options.width));
  const h = Math.max(16, Math.round(options.height));
  const rand = mulberry32(options.seed);
  const min = Math.min(w, h);
  const hue = rand() * 360;
  const accent = hue + 150 + rand() * 60;
  const warm = hue + 40 + rand() * 30;
  const color = (hDeg: number, s: number, l: number) => hslToHex(hDeg, s, l);
  const n = (value: number) => Math.round(value * 10) / 10;

  const blobs = Array.from({ length: 4 }, (_, i) => `<circle cx="${n(rand() * w)}" cy="${n(rand() * h * 0.8)}" r="${n(min * (0.35 + rand() * 0.4))}" fill="url(#g${i})"/>`);
  const blobGradients = [accent, warm, hue - 35, accent + 40].map(
    (tint, i) => `<radialGradient id="g${i}"><stop offset="0" stop-color="${color(tint, 85, 62)}" stop-opacity="${n(0.55 + rand() * 0.3)}"/><stop offset="1" stop-color="${color(tint, 85, 62)}" stop-opacity="0"/></radialGradient>`,
  );

  const orbX = n(w * (0.2 + rand() * 0.6));
  const orbY = n(h * (0.18 + rand() * 0.3));
  const orbR = n(min * (0.1 + rand() * 0.08));
  const pulse = options.video ? `<animate attributeName="r" values="${orbR};${n(orbR * 1.08)};${orbR}" dur="4s" repeatCount="indefinite"/>` : "";

  const particles = Array.from({ length: 18 }, () => {
    const r = n(min * (0.002 + rand() * 0.006));
    return `<circle cx="${n(rand() * w)}" cy="${n(rand() * h * 0.7)}" r="${r}" fill="#ffffff" fill-opacity="${n(0.2 + rand() * 0.5)}"/>`;
  });

  const hills = [0, 1, 2].map((layer) => {
    const base = h * (0.62 + layer * 0.12 + rand() * 0.05);
    const amp = h * (0.05 + rand() * 0.06);
    const d = `M0 ${n(base)} C${n(w * 0.25)} ${n(base - amp)} ${n(w * 0.45)} ${n(base + amp)} ${n(w * 0.7)} ${n(base - amp * 0.4)} S${n(w * 0.92)} ${n(base - amp)} ${w} ${n(base + amp * 0.3)} L${w} ${h} L0 ${h}Z`;
    return `<path d="${d}" fill="${color(hue + layer * 12, 55 - layer * 8, 22 - layer * 6)}" fill-opacity="${n(0.55 + layer * 0.2)}"/>`;
  });

  const label = options.label ?? "demo";
  const labelSize = n(Math.max(10, min * 0.022));
  const labelSvg = label
    ? `<text x="${w - labelSize}" y="${n(h - labelSize * 0.9)}" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="${labelSize}" letter-spacing="1" fill="#ffffff" fill-opacity="0.6" text-anchor="end">${escapeXml(label)}</text>`
    : "";

  const playR = n(min * 0.085);
  const cx = n(w / 2);
  const cy = n(h / 2);
  const play = options.video
    ? `<circle cx="${cx}" cy="${cy}" r="${playR}" fill="#ffffff" fill-opacity="0.16" stroke="#ffffff" stroke-opacity="0.55" stroke-width="${n(min * 0.004)}"/><path d="M${n(cx - playR * 0.32)} ${n(cy - playR * 0.45)} L${n(cx + playR * 0.5)} ${cy} L${n(cx - playR * 0.32)} ${n(cy + playR * 0.45)}Z" fill="#ffffff" fill-opacity="0.85"/>`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<defs>`,
    `<linearGradient id="bg" x1="0" y1="0" x2="${n(0.4 + rand() * 0.6)}" y2="1"><stop offset="0" stop-color="${color(hue, 62, 16)}"/><stop offset="0.55" stop-color="${color(hue + 25, 58, 30)}"/><stop offset="1" stop-color="${color(warm, 70, 48)}"/></linearGradient>`,
    `<radialGradient id="orb"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="0.35" stop-color="${color(warm + 10, 90, 78)}" stop-opacity="0.9"/><stop offset="1" stop-color="${color(warm, 90, 60)}" stop-opacity="0"/></radialGradient>`,
    ...blobGradients,
    `</defs>`,
    `<rect width="${w}" height="${h}" fill="url(#bg)"/>`,
    ...blobs,
    ...particles,
    `<circle cx="${orbX}" cy="${orbY}" r="${n(orbR * 2.4)}" fill="url(#orb)">${pulse}</circle>`,
    `<circle cx="${orbX}" cy="${orbY}" r="${n(orbR * 1.6)}" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="${n(min * 0.003)}"/>`,
    ...hills,
    play,
    labelSvg,
    `</svg>`,
  ].join("");
}

/** The placeholder as a `data:image/svg+xml;base64,...` URL. */
export function mockArtworkDataUrl(options: MockArtworkOptions): string {
  return toDataUrl("image/svg+xml", mockArtworkSvg(options));
}

/** 32-bit FNV-1a hash, used to turn a prompt into a seed. */
export function seedFromText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small deterministic PRNG (mulberry32): same seed, same sequence in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** HSL (degrees, percent, percent) to #rrggbb, so every SVG renderer understands the colour. */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = Math.min(100, Math.max(0, saturation)) / 100;
  const l = Math.min(100, Math.max(0, lightness)) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    const v = x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(h + 1 / 3)}${channel(h)}${channel(h - 1 / 3)}`;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
}
